/**
 * CEM 2.0 — Connect vendor mapping interface (stub).
 * Project.vendorMappings hold intent; this module projects proposals for export review.
 * No live vendor writes — proposals only (P6 Connect honesty).
 */

import { loadProject } from "../model/store.js";
import { loadTagMap } from "./tag_mapping.js";

/**
 * @param {string} projectId
 * @returns {{ ok: boolean, projectId: string, mappings: object[], tagMapProposals: object[], mode: string }}
 */
export function buildVendorMappingExport(projectId) {
  const project = loadProject(projectId);
  if (!project) throw new Error("Project not found");

  const fromModel = (project.vendorMappings || []).map((m) => ({
    ...m,
    source: "canonical.model",
    status: m.status || "proposed"
  }));

  const tagMap = loadTagMap(projectId);
  const fromTags = (tagMap.mappings || []).map((m) => ({
    id: m.id,
    vendor: "ignition",
    p6Signal: m.p6Signal,
    vendorPath: m.ignitionTagPath,
    direction: m.direction,
    status: m.connectionStatus || "proposed",
    source: "tag_maps.sidecar"
  }));

  return {
    ok: true,
    projectId,
    mode: "PROPOSAL_ONLY",
    mappings: fromModel,
    tagMapProposals: fromTags,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Merge model vendor mapping records (does not persist tag_maps — use tag_mapping.saveTagMap for that).
 */
export function listVendorMappingStubs(projectId) {
  const project = loadProject(projectId);
  if (!project) return [];
  return project.vendorMappings || [];
}
