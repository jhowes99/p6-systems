/**
 * Promote reviewed extraction candidates into the canonical model.
 * Never silent: caller must pass explicit equipment/signal lists.
 * Optionally lays out new equipment on the Studio graph for immediate visibility.
 */

import {
  DataClass,
  DataType,
  SignalDirection,
  createEquipment,
  createSignal,
  createDocument,
  createInterlock
} from "./schema.js";
import { loadProject, saveProject, getActiveProject, createProject } from "./store.js";
import { attachLastValidation } from "./validate.js";

/** Draft interlocks from ingested safety/level tags so Studio can show the inside after OCR promote. */
function inferDraftInterlocks(project, createdEquipment, dataClass) {
  const created = [];
  const pumpsMotors = project.equipment.filter((e) => /pump|motor/i.test(e.type));
  const inhibitIds = pumpsMotors.map((e) => e.id);
  if (!inhibitIds.length) return created;

  for (const eq of createdEquipment) {
    if (/emergency_stop/i.test(eq.type) || /ESD|ESTOP/i.test(eq.tag)) {
      let sig = project.signals.find((s) => s.tag === `${eq.tag}.Healthy`);
      if (!sig) {
        sig = createSignal({
          projectId: project.id,
          tag: `${eq.tag}.Healthy`,
          equipmentId: eq.id,
          direction: SignalDirection.INPUT,
          dataType: DataType.BOOL,
          dataClass,
          source: "p6.ingest.interlock"
        });
        project.signals.push(sig);
      }
      const name = `${eq.tag.replace(/[^A-Z0-9]/gi, "")}_SHUTDOWN`;
      if (project.interlocks.some((i) => i.name === name)) continue;
      const ilk = createInterlock({
        projectId: project.id,
        name,
        conditionSignalIds: [sig.id],
        actionDescription: `Inferred from ingest: when ${eq.tag}.Healthy is false, inhibit pumps/motors (ENGINEERING_INFERENCE — review required). Simulated only.`,
        inhibitsEquipmentIds: inhibitIds,
        dataClass
      });
      project.interlocks.push(ilk);
      created.push(ilk);
    }
    if (/level_transmitter/i.test(eq.type) || /^LSH|^LT/i.test(eq.tag)) {
      let sig = project.signals.find((s) => s.tag === `${eq.tag}.High`);
      if (!sig) {
        sig = createSignal({
          projectId: project.id,
          tag: `${eq.tag}.High`,
          equipmentId: eq.id,
          direction: SignalDirection.INPUT,
          dataType: DataType.BOOL,
          dataClass,
          source: "p6.ingest.interlock"
        });
        project.signals.push(sig);
      }
      const name = `${eq.tag.replace(/[^A-Z0-9]/gi, "")}_HIGH_SHUTDOWN`;
      if (project.interlocks.some((i) => i.name === name)) continue;
      const ilk = createInterlock({
        projectId: project.id,
        name,
        conditionSignalIds: [sig.id],
        actionDescription: `Inferred from ingest: high level on ${eq.tag} inhibits transfer equipment (ENGINEERING_INFERENCE — review required).`,
        inhibitsEquipmentIds: inhibitIds,
        dataClass
      });
      project.interlocks.push(ilk);
      created.push(ilk);
    }
  }
  return created;
}

export function inferEquipmentType(tag, hinted) {
  const hint = String(hinted || "").toLowerCase();
  if (hint && hint !== "equipment" && hint !== "sensor") return hint;
  const t = String(tag || "").toUpperCase();
  if (/ESTOP|ESD|E-STOP/.test(t)) return "emergency_stop_input";
  if (/^TANK|^TK[-_]?|^T[-_]?\d/.test(t)) return "tank";
  if (/^PUMP|^P[-_]?\d|^P\d/.test(t)) return "pump";
  if (/^MOTOR|^M[-_]?\d|^M\d/.test(t)) return "motor";
  if (/^XV|^HV|^FV|^CV|^VALVE|^V[-_]?\d/.test(t)) return "valve";
  if (/^FIT|^FT[-_]?|^FE[-_]?/.test(t)) return "flow_transmitter";
  if (/^PT[-_]?|^PI[-_]?/.test(t)) return "pressure_transmitter";
  if (/^TT[-_]?|^TI[-_]?/.test(t)) return "temperature_transmitter";
  if (/^LT|^LSH|^LSL|^LI[-_]?/.test(t)) return "level_transmitter";
  return hint || "equipment";
}

function layoutNewEquipment(project, createdEquipment) {
  if (!createdEquipment.length) return;
  if (!project.ui) project.ui = {};
  if (!project.ui.graph) project.ui.graph = { nodes: {}, updatedAt: null };
  const nodes = { ...(project.ui.graph.nodes || {}) };
  const existing = Object.values(nodes);
  let baseX = 120;
  let baseY = 100;
  if (existing.length) {
    const maxY = Math.max(...existing.map((n) => Number(n.y) || 0));
    baseY = maxY + 160;
  }
  createdEquipment.forEach((eq, i) => {
    if (nodes[eq.id]) return;
    const col = i % 4;
    const row = Math.floor(i / 4);
    const isTank = /tank/i.test(eq.type);
    nodes[eq.id] = {
      x: baseX + col * 220,
      y: baseY + row * 150,
      w: isTank ? 160 : 140,
      h: isTank ? 100 : 80,
      locked: false
    };
  });
  project.ui.graph = { nodes, updatedAt: new Date().toISOString() };
}

/**
 * @param {{
 *   projectId?: string,
 *   projectName?: string,
 *   documentName?: string,
 *   format?: string,
 *   equipment?: Array<{ tag: string, type?: string, description?: string }>,
 *   signals?: Array<{ tag: string, address?: string, direction?: string, dataType?: string }>,
 *   approveAll?: boolean,
 *   placeOnCanvas?: boolean
 * }} body
 */
export function promoteExtractions(body = {}) {
  let project = body.projectId ? loadProject(body.projectId) : getActiveProject();
  if (!project) {
    project = createProject({
      name: body.projectName || "Imported Project",
      description: "Created from document ingestion promote"
    });
  }

  const doc = createDocument({
    projectId: project.id,
    name: body.documentName || "Uploaded engineering document",
    format: body.format || "pdf",
    dataClass: DataClass.EXTRACTED_FACT
  });
  project.documents.push(doc);

  const created = { equipment: [], signals: [], interlocks: [] };
  const equipment = body.equipment || [];
  for (const e of equipment) {
    if (!e?.tag) continue;
    const tag = String(e.tag).trim().toUpperCase();
    if (project.equipment.some((x) => x.tag === tag)) continue;
    const type = inferEquipmentType(tag, e.type);
    const eq = createEquipment({
      projectId: project.id,
      tag,
      type,
      description: e.description || `Ingested from ${doc.name}`,
      dataClass: body.approveAll ? DataClass.ENGINEER_APPROVED : DataClass.ENGINEERING_INFERENCE,
      sourceDocumentIds: [doc.id],
      initialState: /tank/i.test(type) ? "ready" : /valve/i.test(type) ? "closed" : "stopped",
      properties: /tank/i.test(type)
        ? { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 50, highAlarmPct: 90 }
        : undefined
    });
    project.equipment.push(eq);
    created.equipment.push(eq);
  }

  const signals = body.signals || [];
  for (const s of signals) {
    if (!s?.tag) continue;
    const tag = String(s.tag).trim();
    if (project.signals.some((x) => x.tag === tag)) continue;
    const sig = createSignal({
      projectId: project.id,
      tag,
      address: s.address || null,
      direction: s.direction || SignalDirection.INTERNAL,
      dataType: s.dataType || DataType.BOOL,
      dataClass: body.approveAll ? DataClass.ENGINEER_APPROVED : DataClass.ENGINEERING_INFERENCE,
      source: "p6.ingest"
    });
    project.signals.push(sig);
    created.signals.push(sig);
  }

  if (body.placeOnCanvas !== false) {
    layoutNewEquipment(project, created.equipment);
  }

  const dc = body.approveAll ? DataClass.ENGINEER_APPROVED : DataClass.ENGINEERING_INFERENCE;
  created.interlocks = inferDraftInterlocks(project, created.equipment, dc);

  attachLastValidation(project);
  project = saveProject(project, { bumpVersion: true });
  return {
    project,
    document: doc,
    created,
    validation: project.lastValidation || null,
    note:
      "Candidates remain ENGINEERING_INFERENCE until approved unless approveAll was set. " +
      "Draft interlocks from ESD/level tags are inference-only — open Studio Interlocks to review the inside."
  };
}
