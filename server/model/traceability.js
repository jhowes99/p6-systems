/**
 * Phase 13 — engineering traceability chain.
 * SOURCE DOC → EQUIPMENT → SIGNAL → LOGIC → SIMULATION → TEST → EVIDENCE
 */

import { loadProject, getActiveProject } from "./store.js";

export function traceFromTestFailure({ projectId, testResult, assertionName } = {}) {
  const project = projectId ? loadProject(projectId) : getActiveProject();
  if (!project) throw new Error("No project");

  const assertion = (testResult?.assertions || []).find((a) => a.name === assertionName)
    || (testResult?.assertions || []).find((a) => !a.pass)
    || null;

  const failedVars = assertion?.diffs?.map((d) => d.var) || [];
  const signals = project.signals.filter((s) =>
    failedVars.includes(s.tag) || failedVars.includes(s.address) || failedVars.some((v) => s.tag.includes(v))
  );

  // Also map known Water Transfer addresses
  const addrToTag = Object.fromEntries(
    (project.signals || []).filter((s) => s.address).map((s) => [s.address, s.tag])
  );
  for (const v of failedVars) {
    if (addrToTag[v]) {
      const s = project.signals.find((x) => x.tag === addrToTag[v]);
      if (s && !signals.find((x) => x.id === s.id)) signals.push(s);
    }
  }

  const equipmentIds = new Set(signals.map((s) => s.equipmentId).filter(Boolean));
  const equipment = project.equipment.filter((e) => equipmentIds.has(e.id));
  const docIds = new Set(equipment.flatMap((e) => e.sourceDocumentIds || []));
  const documents = project.documents.filter((d) => docIds.has(d.id));

  const interlocks = project.interlocks.filter((ilk) =>
    (ilk.conditionSignalIds || []).some((id) => signals.some((s) => s.id === id))
    || (ilk.inhibitsEquipmentIds || []).some((id) => equipmentIds.has(id))
  );

  const logic = project.controlLogic || [];
  const tests = project.testCases.filter((t) =>
    !testResult?.testId || t.name === testResult.testId || t.id === testResult.testId
  );

  return {
    ok: true,
    chain: {
      documents,
      equipment,
      signals,
      interlocks,
      controlLogic: logic,
      simulationModels: project.simulationModels || [],
      testCases: tests,
      assertion,
      failedVars
    },
    path: [
      "SOURCE DOCUMENT",
      "ENGINEERING EQUIPMENT",
      "I/O SIGNAL",
      "CONTROL LOGIC / INTERLOCK",
      "SIMULATION",
      "VERIFICATION TEST",
      "EVIDENCE REPORT"
    ],
    projectId: project.id,
    modelVersion: project.modelVersion
  };
}

export function traceFromSignal(projectId, signalTag) {
  const project = projectId ? loadProject(projectId) : getActiveProject();
  if (!project) throw new Error("No project");
  const signal = project.signals.find((s) => s.tag === signalTag);
  if (!signal) throw new Error(`Signal not found: ${signalTag}`);
  const equipment = project.equipment.find((e) => e.id === signal.equipmentId) || null;
  const documents = equipment
    ? project.documents.filter((d) => (equipment.sourceDocumentIds || []).includes(d.id))
    : [];
  const interlocks = project.interlocks.filter((ilk) =>
    (ilk.conditionSignalIds || []).includes(signal.id)
    || (equipment && (ilk.inhibitsEquipmentIds || []).includes(equipment.id))
  );
  const relatedTests = project.testCases.filter((t) =>
    JSON.stringify(t).includes(signal.tag) || JSON.stringify(t).includes(signal.address || "___")
  );
  return {
    ok: true,
    signal,
    equipment,
    documents,
    interlocks,
    relatedTests,
    path: ["DOCUMENT", "EQUIPMENT", "SIGNAL", "INTERLOCK", "TEST"]
  };
}
