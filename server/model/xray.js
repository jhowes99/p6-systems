/**
 * P6 X-Ray — visual engineering intelligence (§18–§19).
 * Builds dependency chains and start-inhibit root cause from live signals + model.
 * No fabricated blockers — only evaluated conditions.
 */

import { loadProject, getActiveProject } from "./store.js";

function sigVal(signals, ...tags) {
  const byTag = Object.fromEntries((signals || []).map((s) => [s.tag, s]));
  for (const t of tags) {
    if (byTag[t]) return byTag[t];
  }
  return null;
}

function findByRe(signals, re) {
  return (signals || []).find((s) => re.test(s.tag)) || null;
}

/**
 * Evaluate why a pump/motor cannot start (or is inhibited).
 * @param {object} opts
 * @param {string} [opts.projectId]
 * @param {string} opts.equipmentId
 * @param {object[]} opts.signals - live signal snapshots from runtime bridge
 * @param {object} [opts.mem] - { M0, M1 }
 */
export function analyzeEquipmentXRay({ projectId, equipmentId, equipmentTag, signals = [], mem = {} } = {}) {
  const project = projectId ? loadProject(projectId) : getActiveProject();
  if (!project) throw new Error("No project");

  const equipment =
    project.equipment.find((e) => e.id === equipmentId) ||
    project.equipment.find((e) => e.tag === String(equipmentTag || "").toUpperCase());
  if (!equipment) throw new Error("Equipment not found");

  const eqSignals = signals.filter((s) => s.equipmentId === equipment.id);
  const related = [];

  const esd = sigVal(signals, "ESD-101.Healthy", "ESTOP101.Healthy") || findByRe(signals, /ESD|ESTOP.*Healthy/i);
  const high = sigVal(signals, "LT-101.High", "LT-102.High", "LSH101.High") || findByRe(signals, /High$/i);
  const valveOpen =
    sigVal(signals, "VALVE-101.OpenedFeedback", "XV-101.OpenedFeedback", "XV101.OpenedFeedback") ||
    findByRe(signals, /VALVE-?101\.Opened|XV-?101\.Opened/i);
  const valveCmd =
    sigVal(signals, "VALVE-101.OpenCommand", "XV-101.OpenCommand") || findByRe(signals, /VALVE-?101\.OpenCommand|XV-?101\.OpenCommand/i);
  const running =
    sigVal(signals, "PUMP-101.RunningFeedback", "P-101.RunningFeedback", "P101.RunningFeedback") ||
    findByRe(signals, /RunningFeedback/i);
  const motor =
    sigVal(signals, "M-101.Energize", "M101.Energize") || findByRe(signals, /Energize/i);
  const flow = sigVal(signals, "FIT-101.FlowGpm") || findByRe(signals, /FlowGpm|Flow/i);

  const conditions = [];

  if (esd) {
    const healthy = esd.currentValue === true;
    conditions.push({
      id: "esd",
      label: "Emergency stop",
      signalTag: esd.tag,
      value: esd.currentValue,
      address: esd.address || null,
      status: healthy ? "HEALTHY" : "BLOCKING",
      blocking: !healthy,
      detail: healthy ? "ESD healthy (sim)" : "ESD ACTIVE — start inhibited (sim)"
    });
  }

  if (high) {
    const isHigh = high.currentValue === true;
    conditions.push({
      id: "level_high",
      label: "Destination high level",
      signalTag: high.tag,
      value: high.currentValue,
      address: high.address || null,
      status: isHigh ? "BLOCKING" : "READY",
      blocking: isHigh,
      detail: isHigh ? "High level interlock active" : "Level interlock clear"
    });
  }

  if (valveOpen) {
    const open = valveOpen.currentValue === true;
    conditions.push({
      id: "valve",
      label: "Discharge valve open",
      signalTag: valveOpen.tag,
      value: valveOpen.currentValue,
      address: valveOpen.address || null,
      status: open ? "READY" : "BLOCKING",
      blocking: !open,
      detail: open ? "Valve opened feedback true" : "VALVE NOT OPEN — start inhibited"
    });
  }

  const trip = !!mem.M1;
  conditions.push({
    id: "trip_latch",
    label: "Trip latch (M1)",
    signalTag: "TripLatched",
    value: trip,
    address: "M1",
    status: trip ? "BLOCKING" : "READY",
    blocking: trip,
    detail: trip ? "Trip latched — System.Reset required" : "No trip latch"
  });

  if (running) {
    conditions.push({
      id: "running",
      label: "Pump running feedback",
      signalTag: running.tag,
      value: running.currentValue,
      address: running.address || null,
      status: running.currentValue ? "RUNNING" : "STOPPED",
      blocking: false,
      detail: running.currentValue ? "Pump reports running" : "Pump not running"
    });
  }

  if (motor) {
    conditions.push({
      id: "motor",
      label: "Motor energize",
      signalTag: motor.tag,
      value: motor.currentValue,
      address: motor.address || null,
      status: motor.currentValue ? "ENERGIZED" : "DEENERGIZED",
      blocking: false,
      detail: motor.currentValue ? "Motor output energized" : "Motor de-energized"
    });
  }

  if (flow) {
    conditions.push({
      id: "flow",
      label: "Process flow",
      signalTag: flow.tag,
      value: flow.currentValue,
      address: flow.address || null,
      status: Number(flow.currentValue) > 1 ? "FLOWING" : "NO FLOW",
      blocking: false,
      detail: `Flow = ${flow.currentValue} ${flow.units || ""}`.trim()
    });
  }

  if (valveCmd) {
    related.push({
      role: "valve_command",
      signalTag: valveCmd.tag,
      value: valveCmd.currentValue,
      address: valveCmd.address || null
    });
  }

  const blockers = conditions.filter((c) => c.blocking);
  const primary = blockers[0] || null;

  // Highlight equipment along the inhibit path
  const highlightTags = new Set([equipment.tag]);
  const highlightIds = new Set([equipment.id]);
  for (const c of conditions) {
    if (!c.signalTag) continue;
    const s = signals.find((x) => x.tag === c.signalTag);
    if (s?.equipmentId) {
      highlightIds.add(s.equipmentId);
      const eq = project.equipment.find((e) => e.id === s.equipmentId);
      if (eq) highlightTags.add(eq.tag);
    }
  }
  // Always include process neighbors via connections
  for (const conn of project.connections || []) {
    if (highlightIds.has(conn.fromEquipmentId) || highlightIds.has(conn.toEquipmentId)) {
      highlightIds.add(conn.fromEquipmentId);
      highlightIds.add(conn.toEquipmentId);
    }
  }
  for (const id of highlightIds) {
    const eq = project.equipment.find((e) => e.id === id);
    if (eq) highlightTags.add(eq.tag);
  }

  const interlocks = (project.interlocks || []).filter(
    (ilk) =>
      (ilk.inhibitsEquipmentIds || []).includes(equipment.id) ||
      (ilk.conditionSignalIds || []).some((sid) => signals.some((s) => s.id === sid || s.tag))
  );

  const chain = [];
  if (esd) chain.push({ step: "INPUT", tag: esd.tag, value: esd.currentValue, address: esd.address });
  if (high) chain.push({ step: "INTERLOCK", tag: high.tag, value: high.currentValue, address: high.address });
  if (valveOpen) chain.push({ step: "PERMISSIVE", tag: valveOpen.tag, value: valveOpen.currentValue, address: valveOpen.address });
  chain.push({ step: "LOGIC", tag: "M0/M1", value: { transferRequest: !!mem.M0, tripLatched: !!mem.M1 } });
  if (motor) chain.push({ step: "OUTPUT", tag: motor.tag, value: motor.currentValue, address: motor.address });
  if (running) chain.push({ step: "EQUIPMENT", tag: running.tag, value: running.currentValue, address: running.address });

  const title =
    /pump|motor/i.test(equipment.type) || /PUMP|M-101|P-101|P101/i.test(equipment.tag)
      ? blockers.length
        ? `${equipment.tag} — START INHIBITED`
        : running?.currentValue
          ? `${equipment.tag} — RUNNING`
          : `${equipment.tag} — READY TO START`
      : `${equipment.tag} — X-RAY`;

  return {
    ok: true,
    mode: "xray",
    title,
    equipment: {
      id: equipment.id,
      tag: equipment.tag,
      type: equipment.type,
      operatingState: equipment.operatingState
    },
    canStart: blockers.length === 0 && !running?.currentValue,
    inhibited: blockers.length > 0,
    primaryBlocker: primary,
    conditions,
    related,
    chain,
    highlightEquipmentIds: [...highlightIds],
    highlightTags: [...highlightTags],
    highlightConnectionIds: (project.connections || [])
      .filter((c) => highlightIds.has(c.fromEquipmentId) && highlightIds.has(c.toEquipmentId))
      .map((c) => c.id),
    interlocks: interlocks.map((i) => ({
      id: i.id,
      name: i.name,
      actionDescription: i.actionDescription
    })),
    equipmentSignals: eqSignals.map((s) => ({
      tag: s.tag,
      value: s.currentValue,
      address: s.address,
      direction: s.direction,
      units: s.units || ""
    })),
    note: "Simulated analysis only — not a certified physical safety assessment."
  };
}
