/**
 * CEM 2.0 — read adapters for Runtime / X-Ray / Verify (no engine rewrite).
 */

import { loadProject, getActiveProject } from "./store.js";

function resolveProject(projectOrId) {
  if (!projectOrId) return getActiveProject();
  if (typeof projectOrId === "string") return loadProject(projectOrId);
  return projectOrId;
}

export function getEquipmentById(projectOrId, equipmentId) {
  const project = resolveProject(projectOrId);
  if (!project) return null;
  return (project.equipment || []).find((e) => e.id === equipmentId) || null;
}

export function getSignalsForEquipment(projectOrId, equipmentId) {
  const project = resolveProject(projectOrId);
  if (!project) return [];
  return (project.signals || []).filter((s) => s.equipmentId === equipmentId);
}

export function getInterlocksForEquipment(projectOrId, equipmentId) {
  const project = resolveProject(projectOrId);
  if (!project || !equipmentId) return [];
  const signalIds = new Set(getSignalsForEquipment(project, equipmentId).map((s) => s.id));
  return (project.interlocks || []).filter(
    (ilk) =>
      (ilk.inhibitsEquipmentIds || []).includes(equipmentId) ||
      (ilk.conditionSignalIds || []).some((sid) => signalIds.has(sid))
  );
}

/** Process/instrument/mechanical neighbors via canonical connections (no invented edges). */
export function getConnectedEquipmentIds(projectOrId, equipmentId) {
  const project = resolveProject(projectOrId);
  if (!project || !equipmentId) return [];
  const ids = new Set();
  for (const c of project.connections || []) {
    if (c.fromEquipmentId === equipmentId) ids.add(c.toEquipmentId);
    if (c.toEquipmentId === equipmentId) ids.add(c.fromEquipmentId);
  }
  return [...ids];
}

/**
 * Merge model signal defs with live runtime snapshots by id then tag.
 * Does not invent signals — returns null when neither model nor live has a match.
 */
export function resolveLiveSignal(projectOrId, liveSignals, signalIdOrTag) {
  const project = resolveProject(projectOrId);
  if (!project || signalIdOrTag == null) return null;
  const key = String(signalIdOrTag);
  const model =
    (project.signals || []).find((s) => s.id === key) ||
    (project.signals || []).find((s) => s.tag === key) ||
    null;
  const liveList = liveSignals || [];
  const live =
    (model && liveList.find((s) => s.id === model.id)) ||
    (model && liveList.find((s) => s.tag === model.tag)) ||
    liveList.find((s) => s.id === key) ||
    liveList.find((s) => s.tag === key) ||
    null;
  if (!model && !live) return null;
  if (model && live) {
    return {
      ...model,
      currentValue: live.currentValue,
      address: live.address || model.address,
      units: live.units || model.units
    };
  }
  return live || model;
}

/**
 * Classify an existing model/live signal tag into an X-Ray role.
 * Classification only — does not create signals.
 */
export function classifySignalRole(tag = "") {
  const t = String(tag || "");
  if (/Healthy|ESTOP|ESD|E-?STOP/i.test(t) && /Healthy|OK|Ok/i.test(t)) return "esd";
  if (/\.High$|High$|LSH.*High/i.test(t)) return "level_high";
  if (/OpenedFeedback|Opened$/i.test(t)) return "valve_open";
  if (/OpenCommand/i.test(t)) return "valve_cmd";
  if (/RunningFeedback/i.test(t)) return "running";
  if (/Energize/i.test(t)) return "motor";
  if (/FlowGpm|FlowRate|\.Flow\b/i.test(t)) return "flow";
  return null;
}

/**
 * Walk equipment + connection neighborhood for role-matched signals that exist in the model.
 * Live values attached when present in liveSignals. Never invents tags.
 */
export function findRoleSignals(projectOrId, equipmentId, liveSignals = []) {
  const project = resolveProject(projectOrId);
  const out = {
    esd: null,
    level_high: null,
    valve_open: null,
    valve_cmd: null,
    running: null,
    motor: null,
    flow: null,
    source: "model"
  };
  if (!project || !equipmentId) return out;

  const eqIds = new Set([equipmentId, ...getConnectedEquipmentIds(project, equipmentId)]);
  // One more hop for instrument → tank → pump trains (still model connections only)
  for (const id of [...eqIds]) {
    for (const n of getConnectedEquipmentIds(project, id)) eqIds.add(n);
  }

  const candidates = (project.signals || []).filter((s) => s.equipmentId && eqIds.has(s.equipmentId));
  for (const s of candidates) {
    const role = classifySignalRole(s.tag);
    if (!role || out[role]) continue;
    out[role] = resolveLiveSignal(project, liveSignals, s.id);
  }

  // Interlock condition signals that inhibit this equipment (may sit on non-neighbor ESD/LT)
  for (const ilk of getInterlocksForEquipment(project, equipmentId)) {
    for (const sid of ilk.conditionSignalIds || []) {
      const live = resolveLiveSignal(project, liveSignals, sid);
      if (!live?.tag) continue;
      const role = classifySignalRole(live.tag);
      if (role && !out[role]) out[role] = live;
    }
  }

  return out;
}

export function getRelatedTestCases(projectOrId, { equipmentId = null, signalTag = null } = {}) {
  const project = resolveProject(projectOrId);
  if (!project) return [];
  const equipment = equipmentId ? getEquipmentById(project, equipmentId) : null;
  const needles = [signalTag, equipment?.tag].filter(Boolean);
  if (!needles.length) return project.testCases || [];
  return (project.testCases || []).filter((tc) => {
    const blob = JSON.stringify(tc);
    return needles.some((n) => blob.includes(String(n)));
  });
}

/**
 * Lightweight relationship graph for diagnostics (X-Ray, impact).
 */
export function buildModelGraph(projectOrId, { equipmentId = null } = {}) {
  const project = resolveProject(projectOrId);
  if (!project) return { ok: false, error: "No project" };

  const equipment = equipmentId
    ? [getEquipmentById(project, equipmentId)].filter(Boolean)
    : project.equipment || [];

  const nodes = [];
  const edges = [];

  for (const eq of equipment) {
    nodes.push({ kind: "equipment", id: eq.id, tag: eq.tag, type: eq.type });
    for (const s of getSignalsForEquipment(project, eq.id)) {
      nodes.push({ kind: "signal", id: s.id, tag: s.tag, equipmentId: eq.id });
      edges.push({ from: eq.id, to: s.id, rel: "has_signal" });
    }
    for (const ilk of getInterlocksForEquipment(project, eq.id)) {
      if (!nodes.find((n) => n.kind === "interlock" && n.id === ilk.id)) {
        nodes.push({ kind: "interlock", id: ilk.id, name: ilk.name });
      }
      edges.push({ from: ilk.id, to: eq.id, rel: "inhibits_or_conditions" });
      for (const sid of ilk.conditionSignalIds || []) {
        edges.push({ from: ilk.id, to: sid, rel: "condition" });
      }
    }
    for (const c of project.connections || []) {
      if (c.fromEquipmentId === eq.id || c.toEquipmentId === eq.id) {
        edges.push({
          from: c.fromEquipmentId,
          to: c.toEquipmentId,
          rel: "connection",
          connectionType: c.connectionType,
          id: c.id
        });
      }
    }
  }

  const tests = equipment.length === 1
    ? getRelatedTestCases(project, { equipmentId: equipment[0].id })
    : project.testCases || [];

  for (const tc of tests) {
    nodes.push({ kind: "testCase", id: tc.id, name: tc.name });
    edges.push({ from: tc.id, to: equipment[0]?.id || project.id, rel: "verifies" });
  }

  return {
    ok: true,
    projectId: project.id,
    modelVersion: project.modelVersion,
    schemaVersion: project.schemaVersion,
    nodes,
    edges
  };
}
