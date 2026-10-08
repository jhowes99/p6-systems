/**
 * Phase 8 — promote reviewed extraction candidates into the canonical model.
 * Never silent: caller must pass explicit approvals.
 */

import {
  DataClass,
  DataType,
  SignalDirection,
  createEquipment,
  createSignal,
  createDocument
} from "./schema.js";
import { loadProject, saveProject, getActiveProject, createProject } from "./store.js";

/**
 * @param {{
 *   projectId?: string,
 *   documentName?: string,
 *   equipment?: Array<{ tag: string, type?: string, description?: string }>,
 *   signals?: Array<{ tag: string, address?: string, direction?: string, dataType?: string }>,
 *   approveAll?: boolean
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

  const created = { equipment: [], signals: [] };
  const equipment = body.equipment || [];
  for (const e of equipment) {
    if (!e?.tag) continue;
    const tag = String(e.tag).trim().toUpperCase();
    if (project.equipment.some((x) => x.tag === tag)) continue;
    const eq = createEquipment({
      projectId: project.id,
      tag,
      type: e.type || "equipment",
      description: e.description || "",
      dataClass: body.approveAll ? DataClass.ENGINEER_APPROVED : DataClass.ENGINEERING_INFERENCE,
      sourceDocumentIds: [doc.id]
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

  project = saveProject(project, { bumpVersion: true });
  return { project, document: doc, created };
}
