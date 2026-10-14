/**
 * Phase 16 — reusable virtual equipment models.
 * Each defines signals, states, transitions, timing, failure behavior.
 */

export const EquipmentLibrary = {
  Motor: {
    type: "motor",
    signals: ["RunCommand", "Energize", "RunningFeedback", "Fault", "Available"],
    states: ["deenergized", "energizing", "energized", "fault"],
    timing: { energizeScans: 1 },
    failure: { faultOnCommandWhileUnavailable: true },
    initialState: "deenergized"
  },
  Pump: {
    type: "pump",
    signals: ["RunCommand", "RunningFeedback", "Fault", "SafeState"],
    states: ["stopped", "starting", "running", "stopping", "fault", "safe"],
    timing: { startScans: 1 },
    failure: { goSafeOnEstop: true },
    initialState: "stopped"
  },
  Valve: {
    type: "valve",
    signals: ["OpenCommand", "OpenedFeedback", "ClosedFeedback", "Fault"],
    states: ["closed", "opening", "open", "closing", "fault"],
    timing: { travelScans: 2 },
    failure: { failClosedOnEstop: true },
    initialState: "closed"
  },
  Solenoid: {
    type: "solenoid",
    signals: ["Energize", "Feedback"],
    states: ["off", "on", "fault"],
    timing: { switchScans: 1 },
    initialState: "off"
  },
  LimitSwitch: {
    type: "limit_switch",
    signals: ["Active"],
    states: ["inactive", "active"],
    timing: {},
    initialState: "inactive"
  },
  LevelSwitch: {
    type: "level_switch",
    signals: ["High", "Low"],
    states: ["normal", "high", "low"],
    timing: {},
    initialState: "normal"
  },
  PressureTransmitter: {
    type: "pressure_transmitter",
    signals: ["Pv", "Fault"],
    states: ["ok", "fault"],
    units: "psi",
    timing: {},
    initialState: "ok"
  },
  LevelTransmitter: {
    type: "level_transmitter",
    signals: ["Pv", "LevelPct", "High", "Low", "Fault"],
    states: ["ok", "alarm", "fault"],
    units: "%",
    timing: {},
    initialState: "ok"
  },
  FlowTransmitter: {
    type: "flow_transmitter",
    signals: ["Pv", "FlowGpm", "Fault"],
    states: ["ok", "fault"],
    units: "gpm",
    timing: {},
    initialState: "ok"
  },
  TemperatureTransmitter: {
    type: "temperature_transmitter",
    signals: ["Pv", "Fault"],
    states: ["ok", "fault"],
    units: "degF",
    timing: {},
    initialState: "ok"
  },
  Tank: {
    type: "tank",
    signals: ["LevelPct", "HighAlarm", "LowAlarm"],
    states: ["empty", "filling", "ready", "high"],
    timing: {},
    initialState: "ready"
  },
  Relay: {
    type: "relay",
    signals: ["Coil", "Contact"],
    states: ["open", "closed"],
    timing: { delayScans: 0 },
    initialState: "open"
  },
  Contactor: {
    type: "contactor",
    signals: ["Coil", "AuxContact", "Fault"],
    states: ["open", "closed", "fault"],
    timing: { closeScans: 1 },
    initialState: "open"
  },
  EmergencyStopInput: {
    type: "emergency_stop_input",
    signals: ["Healthy", "Activated"],
    states: ["healthy", "activated"],
    timing: {},
    failure: { simulatedOnly: true },
    initialState: "healthy",
    disclaimer: "Simulated input only — not a certified physical safety function"
  }
};

export function listEquipmentTypes() {
  return Object.entries(EquipmentLibrary).map(([name, def]) => ({
    name,
    ...def
  }));
}

export function getEquipmentType(nameOrType) {
  if (EquipmentLibrary[nameOrType]) return { name: nameOrType, ...EquipmentLibrary[nameOrType] };
  const hit = Object.entries(EquipmentLibrary).find(([, d]) => d.type === nameOrType);
  return hit ? { name: hit[0], ...hit[1] } : null;
}
