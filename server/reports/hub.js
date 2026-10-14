/**
 * Phase 19 — reports hub summaries.
 */

import { listProjects, loadProject, getActiveProject } from "../model/store.js";
import { listEquipmentTypes } from "../plc/equipment/library.js";

export function buildPlatformReport() {
  const projects = listProjects();
  const active = getActiveProject();
  const full = active ? loadProject(active.id) : null;
  return {
    generatedAt: new Date().toISOString(),
    product: "P6 Systems",
    projects,
    activeProject: full
      ? {
          id: full.id,
          name: full.name,
          modelVersion: full.modelVersion,
          equipment: full.equipment.map((e) => ({ tag: e.tag, type: e.type, state: e.operatingState })),
          signals: full.signals.length,
          testCases: full.testCases.map((t) => t.name),
          interlocks: full.interlocks.map((i) => i.name)
        }
      : null,
    equipmentLibrary: listEquipmentTypes().map((t) => t.name),
    disclaimer: "Verification evidence for simulated systems does not certify physical safety functions."
  };
}
