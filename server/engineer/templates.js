/**
 * P6 Engineer — configurable controls engineering templates.
 * Templates propose signals, permissives, alarms, and logic skeletons.
 * They do NOT invent physical PLC addresses or certified safety functions.
 */

/** @typedef {'DI'|'DO'|'AI'|'AO'|'INTERNAL'} IoClass */

/**
 * @typedef {object} TemplateSignal
 * @property {string} role
 * @property {IoClass} ioClass
 * @property {string} dataType
 * @property {string} [units]
 * @property {string} description
 * @property {boolean} [required]
 */

/**
 * @typedef {object} ControlTemplate
 * @property {string} id
 * @property {string} name
 * @property {string[]} equipmentTypes
 * @property {string} category
 * @property {string} description
 * @property {TemplateSignal[]} signals
 * @property {object} fields
 * @property {string[]} [permissives]
 * @property {string[]} [alarms]
 * @property {string[]} [strategies]
 * @property {boolean} [safetyRelated]
 * @property {string} [disclaimer]
 */

/** @type {Record<string, ControlTemplate>} */
export const ControlTemplates = {
  pump: {
    id: "pump",
    name: "Centrifugal / transfer pump",
    equipmentTypes: ["pump"],
    category: "equipment",
    description: "Run command, feedback, fault, and safe-state for transfer / process pumps.",
    fields: {
      ratedFlowGpm: { type: "number", label: "Rated flow (GPM)", required: false },
      dutyStandby: { type: "enum", options: ["duty", "standby", "none"], default: "none" },
      autoStartAllowed: { type: "boolean", default: true },
      minSuctionPermissive: { type: "boolean", default: false }
    },
    signals: [
      { role: "RunCommand", ioClass: "DO", dataType: "BOOL", description: "Pump run command", required: true },
      { role: "RunningFeedback", ioClass: "DI", dataType: "BOOL", description: "Running feedback", required: true },
      { role: "Fault", ioClass: "DI", dataType: "BOOL", description: "Pump / drive fault", required: true },
      { role: "SafeState", ioClass: "INTERNAL", dataType: "BOOL", description: "Safe/stopped latch", required: false }
    ],
    permissives: ["ESTOP_HEALTHY", "NO_HIGH_LEVEL_INHIBIT", "NO_FAULT", "VALVE_PATH_OK"],
    alarms: ["PUMP_FAIL_TO_START", "PUMP_FAULT", "UNEXPECTED_STOP"],
    strategies: ["transfer", "duty_standby", "alternation"]
  },

  motor: {
    id: "motor",
    name: "Motor / drive",
    equipmentTypes: ["motor"],
    category: "equipment",
    description: "Energize path for pump / agitator motors with availability and fault.",
    fields: {
      ratedHp: { type: "number", label: "Rated HP", required: false },
      overloadProtected: { type: "boolean", default: true }
    },
    signals: [
      { role: "RunCommand", ioClass: "DO", dataType: "BOOL", description: "Motor run request", required: false },
      { role: "Energize", ioClass: "DO", dataType: "BOOL", description: "Contactor / VFD enable", required: true },
      { role: "RunningFeedback", ioClass: "DI", dataType: "BOOL", description: "Aux / speed feedback", required: true },
      { role: "Fault", ioClass: "DI", dataType: "BOOL", description: "Overload / drive fault", required: true },
      { role: "Available", ioClass: "INTERNAL", dataType: "BOOL", description: "Available for auto", required: false }
    ],
    permissives: ["ESTOP_HEALTHY", "NO_OVERLOAD", "AVAILABLE"],
    alarms: ["MOTOR_FAULT", "FAIL_TO_ENERGIZE"],
    strategies: ["transfer", "duty_standby"]
  },

  valve: {
    id: "valve",
    name: "On/off isolation valve",
    equipmentTypes: ["valve", "solenoid"],
    category: "equipment",
    description: "Open/close commands with discrete position feedback.",
    fields: {
      failPosition: { type: "enum", options: ["fail_closed", "fail_open", "fail_last"], default: "fail_closed" },
      travelTimeSec: { type: "number", default: 2 },
      dualFeedbackRequired: { type: "boolean", default: true }
    },
    signals: [
      { role: "OpenCommand", ioClass: "DO", dataType: "BOOL", description: "Open command", required: true },
      { role: "OpenedFeedback", ioClass: "DI", dataType: "BOOL", description: "Open limit / ZSO", required: true },
      { role: "ClosedFeedback", ioClass: "DI", dataType: "BOOL", description: "Closed limit / ZSC", required: true },
      { role: "Fault", ioClass: "DI", dataType: "BOOL", description: "Valve fault / stuck", required: false }
    ],
    permissives: ["ESTOP_HEALTHY"],
    alarms: ["VALVE_FAIL_TO_OPEN", "VALVE_FAIL_TO_CLOSE", "VALVE_STUCK"],
    strategies: ["valve_sequence", "transfer"]
  },

  tank: {
    id: "tank",
    name: "Process / storage tank",
    equipmentTypes: ["tank"],
    category: "equipment",
    description: "Level indication and high/low alarms for tank inventory.",
    fields: {
      capacityGal: { type: "number", label: "Capacity (gal)", required: false },
      highAlarmPct: { type: "number", default: 90 },
      lowAlarmPct: { type: "number", default: 10 },
      spillPreventionRequired: { type: "boolean", default: true }
    },
    signals: [
      { role: "LevelPct", ioClass: "AI", dataType: "REAL", units: "%", description: "Level percent", required: false },
      { role: "HighAlarm", ioClass: "DI", dataType: "BOOL", description: "High level alarm / LSH", required: true },
      { role: "LowAlarm", ioClass: "DI", dataType: "BOOL", description: "Low level alarm / LSL", required: false }
    ],
    permissives: [],
    alarms: ["TANK_HIGH", "TANK_LOW", "TANK_OVERFLOW_RISK"],
    strategies: ["level_control", "transfer"]
  },

  level_instrument: {
    id: "level_instrument",
    name: "Level measurement",
    equipmentTypes: ["level_switch", "level_transmitter", "tank"],
    category: "instrument",
    description: "Discrete or analog level sensing for interlocks and control.",
    fields: {
      measurementType: { type: "enum", options: ["switch", "transmitter"], default: "switch" },
      tripDirection: { type: "enum", options: ["high", "low"], default: "high" }
    },
    signals: [
      { role: "High", ioClass: "DI", dataType: "BOOL", description: "High level active", required: false },
      { role: "Low", ioClass: "DI", dataType: "BOOL", description: "Low level active", required: false },
      { role: "Pv", ioClass: "AI", dataType: "REAL", units: "%", description: "Level process value", required: false }
    ],
    alarms: ["LEVEL_HIGH", "LEVEL_LOW"],
    strategies: ["level_control", "transfer"]
  },

  pressure_instrument: {
    id: "pressure_instrument",
    name: "Pressure measurement",
    equipmentTypes: ["pressure_transmitter", "pressure_switch"],
    category: "instrument",
    description: "Pressure PV / switch for permissives and PID.",
    fields: {
      units: { type: "string", default: "psi" },
      highTrip: { type: "number", required: false },
      lowTrip: { type: "number", required: false }
    },
    signals: [
      { role: "Pv", ioClass: "AI", dataType: "REAL", units: "psi", description: "Pressure PV", required: true },
      { role: "Fault", ioClass: "DI", dataType: "BOOL", description: "Transmitter fault", required: false }
    ],
    alarms: ["PRESSURE_HIGH", "PRESSURE_LOW", "XMITTER_FAULT"],
    strategies: ["pid_pressure"]
  },

  flow_instrument: {
    id: "flow_instrument",
    name: "Flow measurement",
    equipmentTypes: ["flow_transmitter", "flow_switch"],
    category: "instrument",
    description: "Flow PV for transfer confirmation and PID.",
    fields: {
      units: { type: "string", default: "gpm" },
      lowFlowTrip: { type: "number", required: false }
    },
    signals: [
      { role: "Pv", ioClass: "AI", dataType: "REAL", units: "gpm", description: "Flow PV", required: true },
      { role: "Fault", ioClass: "DI", dataType: "BOOL", description: "Transmitter fault", required: false }
    ],
    alarms: ["FLOW_LOW", "FLOW_HIGH", "XMITTER_FAULT"],
    strategies: ["transfer", "pid_flow"]
  },

  pid_loop: {
    id: "pid_loop",
    name: "PID regulatory loop",
    equipmentTypes: ["*"],
    category: "control",
    description: "Preliminary PID skeleton — gains and I/O binding require engineer approval.",
    fields: {
      pvTag: { type: "string", required: true },
      cvTag: { type: "string", required: true },
      spDefault: { type: "number", default: 50 },
      kp: { type: "number", default: 1.0 },
      ti: { type: "number", default: 10.0 },
      td: { type: "number", default: 0.0 },
      reverseActing: { type: "boolean", default: false }
    },
    signals: [
      { role: "Pv", ioClass: "AI", dataType: "REAL", description: "Process variable", required: true },
      { role: "Sp", ioClass: "INTERNAL", dataType: "REAL", description: "Setpoint", required: true },
      { role: "Cv", ioClass: "AO", dataType: "REAL", description: "Control output", required: true },
      { role: "ModeAuto", ioClass: "INTERNAL", dataType: "BOOL", description: "Auto mode", required: false }
    ],
    strategies: ["pid_level", "pid_pressure", "pid_flow"],
    disclaimer: "PID gains are placeholders — not tuned or commissioning-ready."
  },

  transfer_sequence: {
    id: "transfer_sequence",
    name: "Tank-to-tank / water transfer sequence",
    equipmentTypes: ["*"],
    category: "sequence",
    description: "Permissive-gated transfer: valve path → pump/motor energize → run → stop on inhibit.",
    fields: {
      sourceTankTag: { type: "string", required: false },
      destinationTankTag: { type: "string", required: false },
      requireValveOpenFeedback: { type: "boolean", default: true },
      inhibitOnHighLevel: { type: "boolean", default: true }
    },
    signals: [],
    permissives: [
      "ESTOP_HEALTHY",
      "NO_HIGH_LEVEL_INHIBIT",
      "VALVE_OPEN_FEEDBACK",
      "NO_PUMP_FAULT",
      "NO_MOTOR_FAULT",
      "OPERATOR_START"
    ],
    alarms: ["TRANSFER_INHIBITED", "TRANSFER_ABORT", "FAIL_TO_START"],
    strategies: ["transfer"]
  },

  alarm_management: {
    id: "alarm_management",
    name: "Alarm management skeleton",
    equipmentTypes: ["*"],
    category: "alarms",
    description: "Standard alarm classes and latching expectations — not a full ISA-18.2 package.",
    fields: {
      latchCritical: { type: "boolean", default: true },
      requireAck: { type: "boolean", default: true }
    },
    signals: [],
    alarms: ["CRITICAL_LATCH", "WARNING", "INFO"],
    strategies: ["alarm_mgmt"],
    disclaimer: "Alarm philosophy / priority assignment requires site engineer approval."
  },

  emergency_stop: {
    id: "emergency_stop",
    name: "Simulated E-stop input",
    equipmentTypes: ["emergency_stop_input"],
    category: "safety_adjacent",
    description: "Model/sim E-stop healthy bit for demos. Not a certified safety function.",
    fields: {},
    signals: [
      { role: "Healthy", ioClass: "DI", dataType: "BOOL", description: "E-stop circuit healthy (sim)", required: true },
      { role: "Activated", ioClass: "INTERNAL", dataType: "BOOL", description: "Activated inverse of healthy", required: false }
    ],
    safetyRelated: true,
    disclaimer:
      "Simulated E-stop demonstrates model behavior only — never a certified physical safety function. SIL/safety functions are not inferred from drawings."
  }
};

export function listTemplates() {
  return Object.values(ControlTemplates).map((t) => ({
    id: t.id,
    name: t.name,
    equipmentTypes: t.equipmentTypes,
    category: t.category,
    description: t.description,
    fieldKeys: Object.keys(t.fields || {}),
    signalRoles: (t.signals || []).map((s) => s.role),
    safetyRelated: !!t.safetyRelated,
    disclaimer: t.disclaimer || null
  }));
}

export function getTemplate(id) {
  return ControlTemplates[id] || null;
}

/**
 * Suggest templates for an equipment type (honest match — may return multiple).
 */
export function suggestTemplatesForEquipment(equipment) {
  const type = String(equipment?.type || "").toLowerCase();
  const hits = Object.values(ControlTemplates).filter((t) => {
    if (t.equipmentTypes.includes("*")) return false;
    return t.equipmentTypes.map((x) => x.toLowerCase()).includes(type);
  });
  return hits;
}

export function signalTagFor(equipmentTag, role) {
  return `${String(equipmentTag).toUpperCase()}.${role}`;
}
