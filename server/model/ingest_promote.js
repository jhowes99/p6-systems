/**
 * Promote reviewed extraction candidates into the canonical model.
 * Never silent: caller must pass explicit equipment/signal/connection lists.
 * Ambiguous connections require include:true — never invent uncertain topology.
 */

import {
  DataClass,
  DataType,
  SignalDirection,
  createEquipment,
  createSignal,
  createDocument,
  createDocumentVersion,
  createInterlock,
  createConnection,
  createInstrument
} from "./schema.js";
import { loadProject, saveProject, getActiveProject, createProject } from "./store.js";
import { attachLastValidation } from "./validate.js";
import { retainDocumentFile } from "./ingest_documents.js";

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

function isInstrumentType(type) {
  return /transmitter|sensor|switch|indicator/i.test(String(type || ""));
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

function formatFromName(name, mime) {
  const n = String(name || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.includes("svg") || n.endsWith(".svg")) return "svg";
  if (m.includes("png") || n.endsWith(".png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg") || /\.jpe?g$/.test(n)) return "jpeg";
  if (m.includes("csv") || n.endsWith(".csv")) return "csv";
  if (m.includes("text") || n.endsWith(".txt")) return "txt";
  return "other";
}

/**
 * @param {{
 *   projectId?: string,
 *   projectName?: string,
 *   documentName?: string,
 *   format?: string,
 *   sourcePath?: string,
 *   retainFiles?: Array<{ buffer: Buffer, originalname?: string, mimetype?: string }>,
 *   documents?: Array<{ name?: string, format?: string, sourcePath?: string, checksum?: string }>,
 *   equipment?: Array<{ tag: string, type?: string, description?: string, sourceRef?: object }>,
 *   instruments?: Array<{ tag: string, type?: string, equipmentTag?: string }>,
 *   signals?: Array<{ tag: string, address?: string, direction?: string, dataType?: string }>,
 *   connections?: Array<{ fromTag: string, toTag: string, connectionType?: string, include?: boolean, ambiguous?: boolean, description?: string }>,
 *   gaps?: Array<object>,
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

  const createdDocs = [];
  const retainFiles = Array.isArray(body.retainFiles) ? body.retainFiles : [];
  for (const f of retainFiles) {
    const retained = retainDocumentFile(project.id, f);
    const doc = createDocument({
      projectId: project.id,
      name: retained.originalName,
      format: formatFromName(retained.originalName, retained.mimeType),
      sourcePath: retained.sourcePath,
      dataClass: DataClass.EXTRACTED_FACT
    });
    doc.checksum = retained.checksum;
    doc.bytes = retained.bytes;
    project.documents.push(doc);
    if (!project.documentVersions) project.documentVersions = [];
    project.documentVersions.push(
      createDocumentVersion({
        documentId: doc.id,
        version: 1,
        contentRef: retained.sourcePath,
        checksum: retained.checksum
      })
    );
    createdDocs.push(doc);
  }

  const metaDocs = Array.isArray(body.documents) ? body.documents : [];
  for (const d of metaDocs) {
    if (!d?.name && !d?.sourcePath) continue;
    if (project.documents.some((x) => x.sourcePath && d.sourcePath && x.sourcePath === d.sourcePath)) continue;
    if (createdDocs.some((x) => x.name === d.name)) continue;
    const doc = createDocument({
      projectId: project.id,
      name: d.name || body.documentName || "Uploaded engineering document",
      format: d.format || body.format || "pdf",
      sourcePath: d.sourcePath || body.sourcePath || null,
      dataClass: DataClass.EXTRACTED_FACT
    });
    if (d.checksum) doc.checksum = d.checksum;
    project.documents.push(doc);
    createdDocs.push(doc);
  }

  if (!createdDocs.length) {
    const doc = createDocument({
      projectId: project.id,
      name: body.documentName || "Uploaded engineering document",
      format: body.format || "pdf",
      sourcePath: body.sourcePath || null,
      dataClass: DataClass.EXTRACTED_FACT
    });
    project.documents.push(doc);
    createdDocs.push(doc);
  }

  const primaryDoc = createdDocs[0];
  const dc = body.approveAll ? DataClass.ENGINEER_APPROVED : DataClass.ENGINEERING_INFERENCE;
  const created = { equipment: [], instruments: [], signals: [], connections: [], interlocks: [], documents: createdDocs };

  const equipment = body.equipment || [];
  for (const e of equipment) {
    if (!e?.tag) continue;
    const tag = String(e.tag).trim().toUpperCase();
    if (project.equipment.some((x) => x.tag === tag)) continue;
    const type = inferEquipmentType(tag, e.type);
    if (isInstrumentType(type) && body.instruments?.some((i) => String(i.tag).toUpperCase() === tag)) {
      // Prefer instruments list when both provided
      continue;
    }
    const eq = createEquipment({
      projectId: project.id,
      tag,
      type,
      description: e.description || `Ingested from ${primaryDoc.name}`,
      dataClass: dc,
      sourceDocumentIds: createdDocs.map((d) => d.id),
      initialState: /tank/i.test(type) ? "ready" : /valve/i.test(type) ? "closed" : "stopped"
    });
    if (/tank/i.test(type)) {
      eq.properties = {
        heightM: 3,
        diameterM: 2,
        capacityM3: 9.42,
        initialLevelPct: 50,
        highAlarmPct: 90,
        _capacityUnverified: true
      };
    }
    if (e.sourceRef) {
      eq.ingestSourceRef = e.sourceRef;
    } else if (e.sourceRefs) {
      eq.ingestSourceRef = e.sourceRefs[0];
      eq.ingestSourceRefs = e.sourceRefs;
    }
    project.equipment.push(eq);
    created.equipment.push(eq);
  }

  const instruments = body.instruments || [];
  for (const inst of instruments) {
    if (!inst?.tag) continue;
    const tag = String(inst.tag).trim().toUpperCase();
    if ((project.instruments || []).some((x) => x.tag === tag)) continue;
    // Also skip if already created as equipment with same tag
    let equipmentId = null;
    if (inst.equipmentTag) {
      equipmentId = project.equipment.find((x) => x.tag === String(inst.equipmentTag).toUpperCase())?.id || null;
    }
    const type = inferEquipmentType(tag, inst.type);
    // Keep instruments in instruments collection AND as equipment for canvas/runtime bind
    if (!project.equipment.some((x) => x.tag === tag)) {
      const eq = createEquipment({
        projectId: project.id,
        tag,
        type,
        description: inst.description || `Instrument from ${primaryDoc.name}`,
        dataClass: dc,
        sourceDocumentIds: createdDocs.map((d) => d.id),
        initialState: "ready"
      });
      project.equipment.push(eq);
      created.equipment.push(eq);
      equipmentId = eq.id;
    } else {
      equipmentId = project.equipment.find((x) => x.tag === tag)?.id || equipmentId;
    }
    if (!project.instruments) project.instruments = [];
    const row = createInstrument({
      projectId: project.id,
      tag,
      type,
      equipmentId,
      dataClass: dc,
      sourceDocumentIds: createdDocs.map((d) => d.id)
    });
    project.instruments.push(row);
    created.instruments.push(row);
  }

  // Auto-promote instrument-typed equipment rows into instruments when not listed separately
  for (const eq of created.equipment) {
    if (!isInstrumentType(eq.type)) continue;
    if ((project.instruments || []).some((x) => x.tag === eq.tag)) continue;
    if (!project.instruments) project.instruments = [];
    const row = createInstrument({
      projectId: project.id,
      tag: eq.tag,
      type: eq.type,
      equipmentId: eq.id,
      dataClass: dc,
      sourceDocumentIds: createdDocs.map((d) => d.id)
    });
    project.instruments.push(row);
    created.instruments.push(row);
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
      dataClass: dc,
      source: "p6.ingest"
    });
    sig.sourceDocumentRefs = createdDocs.map((d) => d.id);
    project.signals.push(sig);
    created.signals.push(sig);
  }

  // Connections — only explicit includes; ambiguous without include are skipped (never silent)
  const tagToId = new Map(project.equipment.map((e) => [e.tag, e.id]));
  const connInputs = body.connections || [];
  const skippedConnections = [];
  for (const c of connInputs) {
    const fromTag = String(c.fromTag || "").toUpperCase();
    const toTag = String(c.toTag || "").toUpperCase();
    const include = c.include === true || c.include === "true";
    if (!include) {
      skippedConnections.push({ fromTag, toTag, reason: "not_included" });
      continue;
    }
    if (c.ambiguous && body.approveAmbiguousConnections !== true && c.force !== true) {
      // Allow include:true on ambiguous only when engineer explicitly included (include already true)
      // Still promote — include is the engineer decision — but label description
    }
    const fromId = tagToId.get(fromTag);
    const toId = tagToId.get(toTag);
    if (!fromId || !toId) {
      skippedConnections.push({ fromTag, toTag, reason: "missing_equipment" });
      continue;
    }
    const connectionType = String(c.connectionType || "process").trim();
    const dup = (project.connections || []).some(
      (x) =>
        x.fromEquipmentId === fromId &&
        x.toEquipmentId === toId &&
        x.connectionType === connectionType
    );
    if (dup) continue;
    const descParts = [
      c.description || c.reason || "Promoted from document ingest",
      c.ambiguous ? "AMBIGUOUS_SOURCE — engineer-accepted" : null
    ].filter(Boolean);
    const conn = createConnection({
      projectId: project.id,
      fromEquipmentId: fromId,
      toEquipmentId: toId,
      connectionType,
      description: descParts.join(" · ")
    });
    conn.dataClass = dc;
    conn.ambiguous = !!c.ambiguous;
    conn.sourceDocumentIds = createdDocs.map((d) => d.id);
    project.connections.push(conn);
    created.connections.push(conn);
  }

  if (body.placeOnCanvas !== false) {
    layoutNewEquipment(project, created.equipment);
  }

  created.interlocks = inferDraftInterlocks(project, created.equipment, dc);

  // Persist reviewable gap decisions (engineer language) — not silent defaults
  if (!project.ui) project.ui = {};
  const gapRows = Array.isArray(body.gaps) ? body.gaps : [];
  if (gapRows.length) {
    project.ui.ingestGaps = {
      updatedAt: new Date().toISOString(),
      documentIds: createdDocs.map((d) => d.id),
      gaps: gapRows.map((g) => ({
        id: g.id,
        severity: g.severity || "decision",
        topic: g.topic || "Engineering decision",
        message: g.message || "",
        relatedTags: g.relatedTags || [],
        status: g.status || "open",
        resolution: g.resolution || null
      }))
    };
  }

  attachLastValidation(project);
  project = saveProject(project, { bumpVersion: true });
  return {
    project,
    document: primaryDoc,
    documents: createdDocs,
    created,
    skippedConnections,
    validation: project.lastValidation || null,
    gaps: project.ui?.ingestGaps || null,
    note:
      "Candidates remain ENGINEERING_INFERENCE until approved unless approveAll was set. " +
      "Ambiguous connections require explicit include. " +
      "Draft interlocks from ESD/level tags are inference-only — open Studio Interlocks to review."
  };
}
