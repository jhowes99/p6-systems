/**
 * CEM 2.0 — minimal impact analysis for engineering changes.
 */

import { loadProject, getActiveProject } from "./store.js";
import {
  getSignalsForEquipment,
  getInterlocksForEquipment,
  getRelatedTestCases
} from "./model_adapter.js";
import { loadTagMap } from "../connect/tag_mapping.js";

export function analyzeImpact(projectId, { entityType, entityId, tag = null } = {}) {
  const project = projectId ? loadProject(projectId) : getActiveProject();
  if (!project) throw new Error("Project not found");

  /** Real Verify catalog ids present in this deployment (do not invent FATs). */
  const VERIFY_CATALOG_IDS = new Set(["P101_ESTOP_SHUTDOWN"]);

  const result = {
    ok: true,
    projectId: project.id,
    modelVersion: project.modelVersion,
    entityType: entityType || null,
    entityId: entityId || null,
    affected: {
      equipment: [],
      signals: [],
      interlocks: [],
      testCases: [],
      verifyCatalogRefs: [],
      connections: [],
      vendorMappings: [],
      tagMappings: []
    }
  };

  let equipmentId = null;
  let signalId = null;

  if (entityType === "equipment" && entityId) {
    equipmentId = entityId;
    const eq = project.equipment.find((e) => e.id === entityId);
    if (eq) result.affected.equipment = [eq.tag];
    result.affected.signals = getSignalsForEquipment(project, entityId).map((s) => s.tag);
    result.affected.interlocks = getInterlocksForEquipment(project, entityId).map((i) => i.name);
    result.affected.testCases = getRelatedTestCases(project, { equipmentId }).map((t) => t.name);
    result.affected.connections = (project.connections || [])
      .filter((c) => c.fromEquipmentId === entityId || c.toEquipmentId === entityId)
      .map((c) => c.id);
    if (eq) {
      result.affected.vendorMappings = (project.vendorMappings || [])
        .filter((m) => m.p6Tag === eq.tag || m.equipmentId === eq.id)
        .map((m) => m.id);
    }
  } else if (entityType === "signal" && entityId) {
    const sig = project.signals.find((s) => s.id === entityId);
    signalId = entityId;
    if (sig) {
      result.affected.signals = [sig.tag];
      equipmentId = sig.equipmentId;
      const parent = equipmentId ? project.equipment.find((e) => e.id === equipmentId) : null;
      if (parent) result.affected.equipment = [parent.tag];
      result.affected.interlocks = (project.interlocks || [])
        .filter((ilk) => (ilk.conditionSignalIds || []).includes(sig.id))
        .map((i) => i.name);
      result.affected.testCases = getRelatedTestCases(project, { signalTag: sig.tag }).map((t) => t.name);
      result.affected.vendorMappings = (project.vendorMappings || [])
        .filter((m) => m.p6Signal === sig.tag || m.signalId === sig.id)
        .map((m) => m.id);
    }
  } else if (entityType === "interlock" && entityId) {
    const ilk = project.interlocks.find((i) => i.id === entityId);
    if (ilk) {
      result.affected.interlocks = [ilk.name];
      const sigs = (project.signals || []).filter((s) => (ilk.conditionSignalIds || []).includes(s.id));
      result.affected.signals = sigs.map((s) => s.tag);
      result.affected.equipment = (ilk.inhibitsEquipmentIds || [])
        .map((eid) => project.equipment.find((e) => e.id === eid)?.tag)
        .filter(Boolean);
      const inhId = (ilk.inhibitsEquipmentIds || [])[0];
      result.affected.testCases = [
        ...getRelatedTestCases(project, { signalTag: sigs[0]?.tag }),
        ...(inhId ? getRelatedTestCases(project, { equipmentId: inhId }) : [])
      ]
        .map((t) => t.name)
        .filter((n, i, a) => a.indexOf(n) === i);
    }
  } else if (tag) {
    const eq = project.equipment.find((e) => e.tag === String(tag).toUpperCase());
    const sig = project.signals.find((s) => s.tag === tag);
    if (eq) return analyzeImpact(project.id, { entityType: "equipment", entityId: eq.id });
    if (sig) return analyzeImpact(project.id, { entityType: "signal", entityId: sig.id });
  }

  result.affected.verifyCatalogRefs = (result.affected.testCases || []).filter((n) =>
    VERIFY_CATALOG_IDS.has(String(n))
  );

  try {
    const tagMap = loadTagMap(project.id);
    const tags = new Set(result.affected.signals);
    result.affected.tagMappings = (tagMap.mappings || [])
      .filter((m) => tags.has(m.p6Signal))
      .map((m) => m.p6Signal);
  } catch {
    result.affected.tagMappings = [];
  }

  if (signalId || equipmentId) {
    result.hint =
      "Re-run validation and Verify FATs after changing approved engineering data; Runtime rebinds on model save.";
  }

  return result;
}
