/**
 * CEM 2.0 — impact analysis for engineering changes.
 * Extended for P6 Engineer: logic, I/O proposals, HMI hints, sim, tests, docs.
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
  const VERIFY_CATALOG_IDS = new Set([
    "P101_ESTOP_SHUTDOWN",
    "P101_START_VALID",
    "P101_START_BLOCKED_LSH",
    "P101_INTERLOCK_STOP_LSH",
    "XV101_VALVE_TRAVEL_FAIL",
    "P101_MOTOR_FAULT_ALARM",
    "LSH101_BLOCKS_TRANSFER"
  ]);

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
      tagMappings: [],
      /** P6 Engineer extensions */
      logic: [],
      ioProposals: [],
      hmi: [],
      simulation: [],
      docs: [],
      controlModules: [],
      templateApplications: []
    },
    regenerateAfterApproval: {
      recommended: true,
      steps: [
        "Re-run GET /api/engineer/io/:projectId",
        "Re-run POST /api/engineer/st/generate",
        "Re-run strategy suggestions",
        "Re-run validation + Verify FATs for affected tags"
      ],
      note: "Regeneration requires engineer gate — approved manual ST is not silently overwritten."
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

  // Engineer / logic / I/O / sim / docs — only when change scope is known
  const scoped = !!(equipmentId || signalId || entityType === "interlock");
  if (scoped) {
    const eqTags = new Set(result.affected.equipment || []);
    const sigTags = new Set(result.affected.signals || []);

    result.affected.logic = (project.controlLogic || [])
      .filter((c) => {
        const text = String(c.sourceText || c.name || "");
        if (!eqTags.size && !sigTags.size) return true;
        return [...eqTags].some((t) => text.includes(t)) || [...sigTags].some((t) => text.includes(t));
      })
      .map((c) => ({ id: c.id, name: c.name, language: c.language, status: c.status, dataClass: c.dataClass }))
      .slice(0, 20);

    if (project.engineer?.logicArtifacts?.length) {
      const arts = project.engineer.logicArtifacts.filter((a) => {
        const tags = a.traceability?.equipmentTags || [];
        if (!eqTags.size) return true;
        return tags.some((t) => eqTags.has(t));
      });
      for (const a of arts) {
        if (!result.affected.logic.some((x) => x.id === a.id)) {
          result.affected.logic.push({
            id: a.id,
            name: `ST ${a.id}`,
            language: a.language || "st",
            status: a.status,
            dataClass: a.dataClass
          });
        }
      }
    }

    if (project.engineer?.lastIoProposal) {
      result.affected.ioProposals = [
        {
          id: project.engineer.lastIoProposal.id,
          status: project.engineer.lastIoProposal.status,
          unassigned: project.engineer.lastIoProposal.counts?.unassignedHardware ?? null
        }
      ];
    } else if (project.engineer?.ioProposals?.length) {
      result.affected.ioProposals = project.engineer.ioProposals.slice(-3);
    }

    result.affected.hmi = (result.affected.signals || []).filter((t) =>
      /Command|Feedback|Healthy|Level|Open|Running|Energize/i.test(t)
    );

    result.affected.simulation = (project.simulationModels || [])
      .filter((m) => !equipmentId || (m.equipmentIds || []).includes(equipmentId))
      .map((m) => m.name);

    const docIds = new Set(
      (project.equipment || [])
        .filter((e) => !equipmentId || e.id === equipmentId)
        .flatMap((e) => e.sourceDocumentIds || e.sourceDocumentRefs || [])
    );
    result.affected.docs = (project.documents || [])
      .filter((d) => !docIds.size || docIds.has(d.id))
      .map((d) => d.name)
      .slice(0, 10);

    result.affected.controlModules = (project.controlModules || [])
      .filter((cm) => !equipmentId || (cm.equipmentIds || []).includes(equipmentId))
      .map((cm) => cm.name);

    result.affected.templateApplications = (project.engineer?.templateApplications || [])
      .filter((a) => !equipmentId || a.equipmentId === equipmentId)
      .map((a) => ({ id: a.id, templateId: a.templateId, equipmentTag: a.equipmentTag, status: a.status }));

    result.hint =
      "Re-run validation, Engineer I/O + ST generation (after approval), and Verify FATs after changing approved engineering data; Runtime rebinds on model save.";
  }

  return result;
}
