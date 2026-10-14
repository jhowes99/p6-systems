/**
 * IEC 61131-3 Structured Text generation from CEM model (templates, interlocks, permissives).
 * Preliminary / readable / documented / traceable — NOT claimed deployable to every PLC.
 */

import { DataClass } from "../model/schema.js";
import { emptyEngineerState } from "./apply_template.js";
import { ladderIRToST } from "../plc/st_export.js";

function sanitizeIdent(tag) {
  return String(tag || "X")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^([^A-Za-z_])/, "_$1");
}

function findSignal(project, tag) {
  return (project.signals || []).find((s) => s.tag === tag);
}

function boolVar(tag) {
  return sanitizeIdent(tag);
}

/**
 * Build transferable permissive expression for water-transfer style trains.
 */
function buildTransferPermissives(project) {
  const lines = [];
  const notes = [];
  const estop = (project.signals || []).find((s) => /\.Healthy$/i.test(s.tag) && /ESTOP|ESD/i.test(s.tag));
  const high = (project.signals || []).find(
    (s) => (/\.High$/i.test(s.tag) && /LSH|LT/i.test(s.tag)) || /\.HighAlarm$/i.test(s.tag)
  );
  const valveOpen = (project.signals || []).find((s) => /\.OpenedFeedback$/i.test(s.tag));
  const pumpFault = (project.signals || []).find((s) => /\.Fault$/i.test(s.tag) && /^P\d+/i.test(s.tag));
  const motorFault = (project.signals || []).find((s) => /\.Fault$/i.test(s.tag) && /^M\d+/i.test(s.tag));

  const parts = [];
  if (estop) {
    parts.push(boolVar(estop.tag));
    notes.push(`Permissive: ${estop.tag} must be TRUE (healthy)`);
  } else {
    notes.push("MISSING permissive: E-stop healthy signal");
  }
  if (high) {
    parts.push(`NOT ${boolVar(high.tag)}`);
    notes.push(`Inhibit: ${high.tag} must be FALSE`);
  } else {
    notes.push("MISSING inhibit: high level signal");
  }
  if (valveOpen) {
    parts.push(boolVar(valveOpen.tag));
    notes.push(`Permissive: ${valveOpen.tag} valve open feedback`);
  }
  if (pumpFault) {
    parts.push(`NOT ${boolVar(pumpFault.tag)}`);
    notes.push(`Permissive: NOT ${pumpFault.tag}`);
  }
  if (motorFault) {
    parts.push(`NOT ${boolVar(motorFault.tag)}`);
    notes.push(`Permissive: NOT ${motorFault.tag}`);
  }

  const expr = parts.length ? parts.join(" AND ") : "FALSE (* incomplete permissives *)";
  lines.push(`  TransferPermissive := ${expr};`);
  return { lines, notes, expr, signals: { estop, high, valveOpen, pumpFault, motorFault } };
}

/**
 * Generate ST program text from project model.
 */
export function generateStructuredText(project, { includeLegacyLadder = true, vendor = "iec61131-3" } = {}) {
  if (!project) throw new Error("Project required");
  const generatedAt = new Date().toISOString();
  const header = [
    "(* ============================================================",
    "   P6 Systems — Preliminary IEC 61131-3 Structured Text",
    `   Project: ${project.name}`,
    `   ProjectId: ${project.id}`,
    `   ModelVersion: ${project.modelVersion}`,
    `   GeneratedAt: ${generatedAt}`,
    `   VendorTarget: ${vendor}`,
    "   Classification: ENGINEERING_INFERENCE (preliminary)",
    "   ----------------------------------------------------------",
    "   HONESTY:",
    "   - Not claimed deployable to every PLC vendor/runtime.",
    "   - Requires engineer review/approval before any plant use.",
    "   - Physical I/O addresses are NOT assigned here.",
    "   - Simulated E-stop is model behavior only — not certified safety.",
    "   - Safety / SIL functions are NOT inferred from drawing geometry.",
    "   ============================================================ *)",
    ""
  ];

  const varDecls = new Set();
  for (const s of project.signals || []) {
    const id = boolVar(s.tag);
    const dt =
      s.dataType === "REAL" ? "REAL" : s.dataType === "INT" ? "INT" : s.dataType === "STRING" ? "STRING" : "BOOL";
    const init =
      dt === "BOOL" ? (s.initialValue ? "TRUE" : "FALSE") : dt === "STRING" ? "''" : String(s.initialValue ?? 0);
    varDecls.add(`  ${id} : ${dt} := ${init}; (* ${s.tag} · ${s.dataClass} · addr=${s.address ?? "UNASSIGNED"} *)`);
  }
  varDecls.add("  TransferPermissive : BOOL := FALSE;");
  varDecls.add("  TransferRunning : BOOL := FALSE;");
  varDecls.add("  OperatorStart : BOOL := FALSE; (* HMI / command — bind in Runtime or vendor HMI *)");
  varDecls.add("  OperatorStop : BOOL := FALSE;");
  varDecls.add("  SystemReset : BOOL := FALSE;");

  const body = [];
  body.push("(* --- Interlocks from CEM (traceable by name) --- *)");
  for (const ilk of project.interlocks || []) {
    const condSigs = (ilk.conditionSignalIds || [])
      .map((id) => (project.signals || []).find((s) => s.id === id))
      .filter(Boolean);
    const inhibits = (ilk.inhibitsEquipmentIds || [])
      .map((id) => (project.equipment || []).find((e) => e.id === id))
      .filter(Boolean);
    body.push(`(* INTERLOCK ${ilk.name}: ${ilk.actionDescription || ""} *)`);
    body.push(`(* dataClass=${ilk.dataClass} inhibits=${inhibits.map((e) => e.tag).join(",") || "none"} *)`);
    if (/ESTOP/i.test(ilk.name)) {
      const healthy = condSigs.find((s) => /Healthy/i.test(s.tag));
      if (healthy) {
        body.push(`IF NOT ${boolVar(healthy.tag)} THEN`);
        for (const eq of inhibits) {
          const energize = findSignal(project, `${eq.tag}.Energize`);
          const run = findSignal(project, `${eq.tag}.RunCommand`);
          const open = findSignal(project, `${eq.tag}.OpenCommand`);
          if (energize) body.push(`  ${boolVar(energize.tag)} := FALSE;`);
          if (run) body.push(`  ${boolVar(run.tag)} := FALSE;`);
          if (open) body.push(`  ${boolVar(open.tag)} := FALSE;`);
          const safe = findSignal(project, `${eq.tag}.SafeState`);
          if (safe) body.push(`  ${boolVar(safe.tag)} := TRUE;`);
        }
        body.push("  TransferRunning := FALSE;");
        body.push("END_IF;");
      }
    } else if (/LSH|HIGH|LEVEL/i.test(ilk.name)) {
      const high = condSigs[0];
      if (high) {
        body.push(`IF ${boolVar(high.tag)} THEN`);
        body.push("  (* High level inhibit — reject / abort transfer *)");
        body.push("  TransferRunning := FALSE;");
        for (const eq of inhibits) {
          const run = findSignal(project, `${eq.tag}.RunCommand`);
          const energize = findSignal(project, `${eq.tag}.Energize`);
          if (run) body.push(`  ${boolVar(run.tag)} := FALSE;`);
          if (energize) body.push(`  ${boolVar(energize.tag)} := FALSE;`);
        }
        body.push("END_IF;");
      }
    } else {
      body.push("(* Generic interlock — engineer to refine condition expression *)");
    }
    body.push("");
  }

  body.push("(* --- Transfer permissives --- *)");
  const perm = buildTransferPermissives(project);
  body.push(...perm.lines);
  for (const n of perm.notes) body.push(`(* ${n} *)`);
  body.push("");

  const pumpRun = (project.signals || []).find((s) => /\.RunCommand$/i.test(s.tag) && /^P/i.test(s.tag));
  const motorEn = (project.signals || []).find((s) => /\.Energize$/i.test(s.tag) && /^M/i.test(s.tag));
  const valveOpenCmd = (project.signals || []).find((s) => /\.OpenCommand$/i.test(s.tag));

  body.push("(* --- Transfer sequence skeleton --- *)");
  body.push("IF OperatorStop OR NOT TransferPermissive THEN");
  body.push("  TransferRunning := FALSE;");
  body.push("ELSIF OperatorStart AND TransferPermissive THEN");
  body.push("  TransferRunning := TRUE;");
  body.push("END_IF;");
  body.push("");
  if (valveOpenCmd) {
    body.push(`${boolVar(valveOpenCmd.tag)} := TransferRunning OR ${boolVar(valveOpenCmd.tag)}; (* hold open while running — refine per site *)`);
  }
  if (pumpRun) {
    body.push(`${boolVar(pumpRun.tag)} := TransferRunning AND TransferPermissive;`);
  }
  if (motorEn) {
    body.push(`${boolVar(motorEn.tag)} := TransferRunning AND TransferPermissive;`);
  }
  body.push("");

  // PID stubs from template applications
  const pidApps = (project.engineer?.templateApplications || []).filter((a) => a.templateId === "pid_loop");
  if (pidApps.length) {
    body.push("(* --- PID placeholders (NOT tuned) --- *)");
    for (const a of pidApps) {
      body.push(`(* PID for equipment ${a.equipmentTag} — gains require engineer approval *)`);
    }
    body.push("");
  }

  let legacyAppendix = "";
  if (includeLegacyLadder && project.legacy?.ladderIR) {
    try {
      legacyAppendix =
        "\n(* --- Appendix: legacy Ladder IR export (existing path) --- *)\n" +
        ladderIRToST(project.legacy.ladderIR);
    } catch {
      legacyAppendix = "\n(* Legacy ladder IR present but failed to export *)\n";
    }
  }

  const program = [
    ...header,
    "PROGRAM P6_PreliminaryControls",
    "VAR",
    ...[...varDecls],
    "END_VAR",
    "",
    ...body,
    "END_PROGRAM",
    legacyAppendix
  ].join("\n");

  const artifact = {
    id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    language: "st",
    vendor,
    standard: "IEC 61131-3",
    generatedAt,
    modelVersion: project.modelVersion,
    projectId: project.id,
    status: "proposed",
    dataClass: DataClass.ENGINEERING_INFERENCE,
    source: "p6.engineer.st_generate",
    traceability: {
      interlockNames: (project.interlocks || []).map((i) => i.name),
      signalCount: (project.signals || []).length,
      permissiveNotes: perm.notes,
      equipmentTags: (project.equipment || []).map((e) => e.tag)
    },
    limitations: [
      "Preliminary Structured Text for review — not a certified vendor project package",
      "Not claimed runnable on all PLC platforms without vendor adaptation",
      "Manual engineer edits must be preserved via review API (no silent overwrite when approved)",
      "Safety/SIL not included in this generation path"
    ],
    st: program
  };

  return artifact;
}

/**
 * Persist ST artifact; refuse silent overwrite of engineer-approved logic.
 */
export function persistStArtifact(project, artifact, { force = false } = {}) {
  project.engineer = project.engineer || emptyEngineerState();
  project.engineer.logicArtifacts = project.engineer.logicArtifacts || [];

  const approved = (project.engineer.logicArtifacts || []).filter(
    (a) => a.status === "approved" || a.dataClass === DataClass.ENGINEER_APPROVED
  );
  if (approved.length && !force) {
    return {
      ok: false,
      error:
        "Engineer-approved ST artifact exists — regenerate refused to prevent silent overwrite. Use force:true after explicit review decision, or modify via review API.",
      approvedIds: approved.map((a) => a.id)
    };
  }

  // Store without huge duplication in controlLogic summary
  const slim = { ...artifact };
  project.engineer.logicArtifacts.push(slim);
  project.engineer.lastGenerate = {
    at: artifact.generatedAt,
    artifactId: artifact.id,
    language: "st",
    modelVersion: artifact.modelVersion
  };

  // Mirror into CEM controlLogic for traceability (code stored)
  project.controlLogic = project.controlLogic || [];
  const existingManual = project.controlLogic.find(
    (c) => c.language === "st" && c.dataClass === DataClass.ENGINEER_APPROVED && c.manualEdits
  );
  if (existingManual && !force) {
    return {
      ok: false,
      error: "controlLogic contains engineer-approved manual ST edits — regenerate blocked",
      logicId: existingManual.id
    };
  }

  project.controlLogic.push({
    id: artifact.id,
    projectId: project.id,
    name: `Preliminary ST v${artifact.modelVersion}`,
    language: "st",
    ir: { kind: "st_source", vendor: artifact.vendor, standard: artifact.standard },
    sourceText: artifact.st,
    version: artifact.modelVersion,
    staged: false,
    status: artifact.status,
    dataClass: DataClass.ENGINEERING_INFERENCE,
    createdAt: artifact.generatedAt,
    updatedAt: artifact.generatedAt,
    manualEdits: false,
    traceability: artifact.traceability
  });

  return { ok: true, artifact };
}
