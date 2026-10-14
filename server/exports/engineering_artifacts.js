/**
 * Engineering artifacts from canonical model — emit only where data exists.
 */

import { createWaterTransferLadderIR } from "../plc/equipment/water_transfer.js";
import { exportCodesysST, exportSiemensSCL, exportAllenBradleyPlaceholder } from "../plc/exporters.js";
import { buildVendorMappingExport } from "../connect/vendor_mapping.js";
import { loadTagMap } from "../connect/tag_mapping.js";

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function buildEquipmentList(project) {
  const rows = (project?.equipment || []).map((e) => ({
    tag: e.tag,
    type: e.type,
    description: e.description || "",
    dataClass: e.dataClass || "",
    id: e.id
  }));
  return {
    kind: "equipment_list",
    present: rows.length > 0,
    format: "csv",
    csv: rows.length ? toCsv(rows, ["tag", "type", "description", "dataClass", "id"]) : null,
    json: rows
  };
}

export function buildInstrumentIndex(project) {
  const instrumentTypes = new Set(["sensor", "transmitter", "instrument", "level", "switch", "estop"]);
  const rows = (project?.equipment || [])
    .filter((e) => instrumentTypes.has(String(e.type || "").toLowerCase()) || /^(LT|LSH|FIT|PIT|ESTOP)/i.test(e.tag || ""))
    .map((e) => ({
      tag: e.tag,
      type: e.type,
      description: e.description || "",
      dataClass: e.dataClass || ""
    }));
  // Also include signal-level instruments
  const sigRows = (project?.signals || [])
    .filter((s) => /^(LT|LSH|FIT|PIT|ESTOP)/i.test(s.tag || ""))
    .map((s) => ({
      tag: s.tag,
      type: s.signalType || s.role || "signal",
      description: s.description || "",
      dataClass: s.dataClass || ""
    }));
  const merged = [...rows];
  const seen = new Set(rows.map((r) => r.tag));
  for (const s of sigRows) {
    if (!seen.has(s.tag)) {
      merged.push(s);
      seen.add(s.tag);
    }
  }
  return {
    kind: "instrument_index",
    present: merged.length > 0,
    format: "csv",
    csv: merged.length ? toCsv(merged, ["tag", "type", "description", "dataClass"]) : null,
    json: merged
  };
}

export function buildIoSchedule(project) {
  const rows = (project?.signals || [])
    .filter((s) => s.address)
    .map((s) => ({
      tag: s.tag,
      address: s.address,
      direction: s.direction || "",
      signalType: s.signalType || "",
      equipmentId: s.equipmentId || "",
      dataClass: s.dataClass || ""
    }));
  const legacy = project?.legacy?.ioEntries || [];
  if (!rows.length && legacy.length) {
    for (const e of legacy) {
      rows.push({
        tag: e.tag || e.name || "",
        address: e.address || "",
        direction: e.direction || "",
        signalType: e.type || "",
        equipmentId: "",
        dataClass: ""
      });
    }
  }
  return {
    kind: "io_schedule",
    present: rows.length > 0,
    format: "csv",
    csv: rows.length
      ? toCsv(rows, ["tag", "address", "direction", "signalType", "equipmentId", "dataClass"])
      : null,
    json: rows
  };
}

export function buildControlNarrativeStub(project) {
  const interlocks = (project?.interlocks || []).map((i) => ({
    name: i.name,
    action: i.actionDescription || "",
    dataClass: i.dataClass
  }));
  const modules = (project?.controlModules || []).map((m) => ({
    name: m.name,
    description: m.description || ""
  }));
  const present = interlocks.length > 0 || modules.length > 0 || (project?.equipment || []).length > 0;
  const md = [
    `# Control Narrative (preliminary) — ${project?.name || project?.id || "project"}`,
    "",
    `Model version: ${project?.modelVersion ?? "n/a"}`,
    "",
    "> Preliminary narrative generated from the canonical model. Not a signed control narrative.",
    "",
    "## Control modules",
    ...(modules.length
      ? modules.map((m) => `- **${m.name}**: ${m.description || "(no description)"}`)
      : ["- (none in model)"]),
    "",
    "## Interlocks",
    ...(interlocks.length
      ? interlocks.map((i) => `- **${i.name}** [${i.dataClass}]: ${i.action}`)
      : ["- (none in model)"]),
    "",
    "## Equipment",
    ...((project?.equipment || []).map((e) => `- ${e.tag} (${e.type})`) || ["- (none)"]),
    ""
  ].join("\n");
  return {
    kind: "control_narrative",
    present,
    format: "markdown",
    markdown: present ? md : null,
    json: { interlocks, modules }
  };
}

export function buildStExport(project) {
  const ir =
    project?.legacy?.ladderIR ||
    (project?.equipment?.some((e) => /P101|TANK101/i.test(e.tag))
      ? createWaterTransferLadderIR()
      : null);
  if (!ir) {
    return { kind: "st", present: false, codesys: null, siemens: null, allenBradley: null };
  }
  let codesys = null;
  let siemens = null;
  let allenBradley = null;
  try {
    codesys = exportCodesysST(ir);
  } catch {
    codesys = null;
  }
  try {
    siemens = exportSiemensSCL(ir);
  } catch {
    siemens = null;
  }
  try {
    const ab = exportAllenBradleyPlaceholder(ir);
    if (typeof ab === "string") allenBradley = ab;
    else if (ab && typeof ab === "object") {
      allenBradley = JSON.stringify(ab, null, 2);
    } else {
      allenBradley = "// Allen-Bradley export remains placeholder";
    }
  } catch {
    allenBradley = "// Allen-Bradley export remains placeholder";
  }
  return {
    kind: "st",
    present: !!(codesys || siemens),
    codesys,
    siemens,
    allenBradley,
    warning: "Allen-Bradley export is a placeholder until a real exporter is validated."
  };
}

export function buildSignalMaps(project) {
  let vendor = null;
  let tagMap = null;
  try {
    vendor = buildVendorMappingExport(project.id);
  } catch {
    vendor = null;
  }
  try {
    tagMap = loadTagMap(project.id);
  } catch {
    tagMap = null;
  }
  const legacyMap = project?.legacy?.ioMap || {};
  const present =
    Object.keys(legacyMap).length > 0 ||
    (vendor?.mappings || []).length > 0 ||
    (tagMap?.mappings || []).length > 0;
  return {
    kind: "signal_maps",
    present,
    json: {
      legacyIoMap: legacyMap,
      vendorMappings: vendor?.mappings || [],
      tagMapProposals: tagMap?.mappings || [],
      mode: vendor?.mode || "PROPOSAL_ONLY"
    }
  };
}

export function buildAlarmsList(project) {
  const signals = (project?.signals || []).filter(
    (s) => /fault|alarm|high|trip|estop/i.test(s.tag || "") || /fault|alarm/i.test(s.role || "")
  );
  const rows = signals.map((s) => ({
    tag: s.tag,
    role: s.role || "",
    address: s.address || "",
    description: s.description || ""
  }));
  return {
    kind: "alarms",
    present: rows.length > 0,
    format: "csv",
    csv: rows.length ? toCsv(rows, ["tag", "role", "address", "description"]) : null,
    json: rows,
    note: "Derived from signal tags/roles present in model — not a full alarm database."
  };
}

export function buildInterlockMatrix(project) {
  const eqById = new Map((project?.equipment || []).map((e) => [e.id, e]));
  const sigById = new Map((project?.signals || []).map((s) => [s.id, s]));
  const rows = (project?.interlocks || []).map((i) => ({
    name: i.name,
    conditions: (i.conditionSignalIds || [])
      .map((id) => sigById.get(id)?.tag || id)
      .join("; "),
    inhibits: (i.inhibitsEquipmentIds || [])
      .map((id) => eqById.get(id)?.tag || id)
      .join("; "),
    action: i.actionDescription || "",
    dataClass: i.dataClass || ""
  }));
  return {
    kind: "interlock_matrix",
    present: rows.length > 0,
    format: "csv",
    csv: rows.length
      ? toCsv(rows, ["name", "conditions", "inhibits", "action", "dataClass"])
      : null,
    json: rows
  };
}

/**
 * Collect all artifacts that have data.
 */
export function collectEngineeringArtifacts(project, { verifyReport = null, simResults = null } = {}) {
  const artifacts = [
    buildEquipmentList(project),
    buildInstrumentIndex(project),
    buildIoSchedule(project),
    buildControlNarrativeStub(project),
    buildStExport(project),
    buildSignalMaps(project),
    buildAlarmsList(project),
    buildInterlockMatrix(project)
  ];

  if (verifyReport) {
    artifacts.push({
      kind: "verify_report",
      present: true,
      json: verifyReport,
      evidenceClass: "VIRTUAL"
    });
  }
  if (simResults) {
    artifacts.push({
      kind: "sim_results",
      present: true,
      json: simResults
    });
  }

  return {
    projectId: project?.id || null,
    modelVersion: project?.modelVersion ?? null,
    artifacts,
    presentKinds: artifacts.filter((a) => a.present).map((a) => a.kind),
    missingKinds: artifacts.filter((a) => !a.present).map((a) => a.kind)
  };
}
