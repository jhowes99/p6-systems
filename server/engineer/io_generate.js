/**
 * Generate preliminary I/O lists from approved / templated P6 model.
 * NEVER invents physical PLC addresses — hardware mapping requires engineer approval.
 */

import { DataClass, SignalDirection } from "../model/schema.js";
import { emptyEngineerState } from "./apply_template.js";
import { getTemplate } from "./templates.js";

function classifyIo(signal) {
  if (signal.ioClass) return String(signal.ioClass).toUpperCase();
  const dt = String(signal.dataType || "").toUpperCase();
  const dir = signal.direction;
  if (dir === SignalDirection.INTERNAL) return "INTERNAL";
  if (dir === SignalDirection.INPUT) {
    return dt === "BOOL" ? "DI" : "AI";
  }
  if (dir === SignalDirection.OUTPUT) {
    return dt === "BOOL" ? "DO" : "AO";
  }
  if (dir === SignalDirection.BIDIRECTIONAL) return "INTERNAL";
  return "INTERNAL";
}

function describeSignal(signal, equipment) {
  if (signal.description) return signal.description;
  const role = signal.role || String(signal.tag || "").split(".").pop();
  const eqTag = equipment?.tag || "?";
  return `${eqTag} ${role}`;
}

/**
 * Build DI/DO/AI/AO proposal lists for a project.
 * Existing addresses are reported as "legacy_or_approved" — never newly assigned here.
 */
export function generateIoList(project, { onlyApprovedEquipment = false } = {}) {
  if (!project) throw new Error("Project required");
  const eqById = new Map((project.equipment || []).map((e) => [e.id, e]));
  const instById = new Map((project.instruments || []).map((i) => [i.id, i]));

  const rows = [];
  const warnings = [];

  for (const sig of project.signals || []) {
    const eq = sig.equipmentId ? eqById.get(sig.equipmentId) : null;
    if (onlyApprovedEquipment && eq && eq.dataClass !== DataClass.ENGINEER_APPROVED) continue;

    const ioClass = classifyIo(sig);
    const instrument = sig.instrumentId ? instById.get(sig.instrumentId) : null;
    const hasAddress = sig.address != null && String(sig.address).trim() !== "";

    if (hasAddress && sig.dataClass !== DataClass.ENGINEER_APPROVED) {
      warnings.push({
        code: "ADDRESS_WITHOUT_APPROVAL",
        tag: sig.tag,
        message: `Signal ${sig.tag} has address "${sig.address}" but is not ENGINEER_APPROVED — treat as provisional`
      });
    }

    rows.push({
      tag: sig.tag,
      ioClass,
      dataType: sig.dataType,
      direction: sig.direction,
      description: describeSignal(sig, eq),
      equipmentTag: eq?.tag || null,
      equipmentId: eq?.id || null,
      instrumentTag: instrument?.tag || null,
      /** Physical address: only echoed if already present — never invented */
      plcAddress: hasAddress ? String(sig.address) : null,
      addressStatus: hasAddress
        ? sig.dataClass === DataClass.ENGINEER_APPROVED
          ? "engineer_approved"
          : "provisional_existing"
        : "unassigned_requires_engineer",
      dataClass: sig.dataClass,
      role: sig.role || null
    });
  }

  const buckets = {
    DI: rows.filter((r) => r.ioClass === "DI"),
    DO: rows.filter((r) => r.ioClass === "DO"),
    AI: rows.filter((r) => r.ioClass === "AI"),
    AO: rows.filter((r) => r.ioClass === "AO"),
    INTERNAL: rows.filter((r) => r.ioClass === "INTERNAL")
  };

  const missingRequired = [];
  for (const eq of project.equipment || []) {
    const tid = eq.properties?.controlTemplateId;
    if (!tid) continue;
    const tmpl = getTemplate(tid);
    if (!tmpl) continue;
    for (const rs of tmpl.signals || []) {
      if (!rs.required) continue;
      const tag = `${eq.tag}.${rs.role}`;
      if (!(project.signals || []).some((s) => s.tag === tag)) {
        missingRequired.push({ equipmentTag: eq.tag, templateId: tid, role: rs.role, expectedTag: tag });
      }
    }
  }

  const proposal = {
    id: `iop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: new Date().toISOString(),
    modelVersion: project.modelVersion,
    projectId: project.id,
    status: "proposed",
    dataClass: DataClass.ENGINEERING_INFERENCE,
    counts: {
      DI: buckets.DI.length,
      DO: buckets.DO.length,
      AI: buckets.AI.length,
      AO: buckets.AO.length,
      INTERNAL: buckets.INTERNAL.length,
      unassignedHardware: rows.filter((r) => r.addressStatus === "unassigned_requires_engineer").length
    },
    lists: buckets,
    rows,
    missingRequired,
    warnings,
    honesty: [
      "No physical PLC addresses were invented by this generator.",
      "Hardware channel / card / terminal mapping requires engineer approval.",
      "INTERNAL signals are logic-only and are not field I/O."
    ]
  };

  return proposal;
}

/**
 * Persist latest I/O proposal on project.engineer (does not write addresses onto signals).
 */
export function persistIoProposal(project, proposal) {
  project.engineer = project.engineer || emptyEngineerState();
  project.engineer.ioProposals = project.engineer.ioProposals || [];
  project.engineer.ioProposals.push({
    id: proposal.id,
    generatedAt: proposal.generatedAt,
    modelVersion: proposal.modelVersion,
    status: proposal.status,
    counts: proposal.counts
  });
  // Keep last full snapshot for review UI
  project.engineer.lastIoProposal = proposal;
  return proposal;
}

/**
 * Approve hardware address mapping for specific signals — explicit only.
 */
export function approveIoAddresses(project, mappings = []) {
  const results = [];
  for (const m of mappings) {
    const sig = (project.signals || []).find((s) => s.id === m.signalId || s.tag === m.tag);
    if (!sig) {
      results.push({ ok: false, tag: m.tag || m.signalId, error: "Signal not found" });
      continue;
    }
    if (!m.address || !String(m.address).trim()) {
      results.push({ ok: false, tag: sig.tag, error: "address required for hardware approval" });
      continue;
    }
    if (!m.engineerAcknowledged) {
      results.push({
        ok: false,
        tag: sig.tag,
        error: "engineerAcknowledged:true required — hardware mapping is an engineer decision"
      });
      continue;
    }
    sig.address = String(m.address).trim();
    sig.dataClass = DataClass.ENGINEER_APPROVED;
    sig.updatedAt = new Date().toISOString();
    results.push({ ok: true, tag: sig.tag, address: sig.address });
  }
  return { ok: results.every((r) => r.ok), results };
}
