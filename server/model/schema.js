/**
 * P6 Canonical Engineering Model — schema definitions and factories.
 * Spec §5. File-backed SoR (ADR-002); Ignition is optional consumer only.
 */

export const SCHEMA_VERSION = 2;

/** Cached engineering validation rollup (computed; optional on entities) */
export const ValidationStatus = Object.freeze({
  UNKNOWN: "UNKNOWN",
  VALID: "VALID",
  WARNING: "WARNING",
  ERROR: "ERROR"
});

/** Provenance / approval classification (Spec §4) */
export const DataClass = Object.freeze({
  EXTRACTED_FACT: "EXTRACTED_FACT",
  ENGINEERING_INFERENCE: "ENGINEERING_INFERENCE",
  ENGINEER_APPROVED: "ENGINEER_APPROVED"
});

export const SignalDirection = Object.freeze({
  INPUT: "INPUT",
  OUTPUT: "OUTPUT",
  INTERNAL: "INTERNAL",
  BIDIRECTIONAL: "BIDIRECTIONAL"
});

export const SignalQuality = Object.freeze({
  GOOD: "GOOD",
  UNCERTAIN: "UNCERTAIN",
  BAD: "BAD",
  NOT_CONNECTED: "NOT_CONNECTED"
});

export const DataType = Object.freeze({
  BOOL: "BOOL",
  INT: "INT",
  REAL: "REAL",
  STRING: "STRING"
});

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyProject({ name, description = "", id: givenId } = {}) {
  if (!name || !String(name).trim()) throw new Error("Project name is required");
  const ts = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: givenId || id("prj"),
    name: String(name).trim(),
    description: String(description || ""),
    createdAt: ts,
    updatedAt: ts,
    modelVersion: 1,
    documents: [],
    documentVersions: [],
    equipment: [],
    instruments: [],
    signals: [],
    ioPoints: [],
    connections: [],
    controlModules: [],
    interlocks: [],
    controlLogic: [],
    simulationModels: [],
    simulationRuns: [],
    testCases: [],
    testResults: [],
    vendorAdapters: [],
    integrationConnections: [],
    /** CEM 2.0 — optional control narrative / sequence skeletons */
    controlSequences: [],
    /** CEM 2.0 — vendor-neutral mapping intent (Connect export proposals) */
    vendorMappings: [],
    /** Last validateProject snapshot (informational) */
    lastValidation: null,
    // Bridge to existing ladder IR / C&E until Runtime Phase 3–4 fully adopts the model
    legacy: {
      ladderIR: null,
      ioMap: {},
      causeEffectRules: [],
      ioEntries: []
    }
  };
}

export function createDocument({ projectId, name, format, sourcePath = null, dataClass = DataClass.EXTRACTED_FACT }) {
  const ts = nowIso();
  return {
    id: id("doc"),
    projectId,
    name,
    format, // pdf | png | jpeg | csv | xlsx | json | other
    sourcePath,
    dataClass,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createDocumentVersion({ documentId, version, contentRef = null, checksum = null }) {
  return {
    id: id("docver"),
    documentId,
    version,
    contentRef,
    checksum,
    createdAt: nowIso()
  };
}

export function createEquipment({
  projectId,
  tag,
  type,
  description = "",
  dataClass = DataClass.ENGINEERING_INFERENCE,
  states = [],
  initialState = null,
  sourceDocumentIds = []
}) {
  const ts = nowIso();
  return {
    id: id("eq"),
    projectId,
    tag: String(tag).trim().toUpperCase(),
    type: String(type).trim().toLowerCase(), // motor | pump | valve | tank | solenoid | ...
    description,
    dataClass,
    states,
    initialState,
    operatingState: initialState,
    properties: {},
    sourceDocumentIds: [...sourceDocumentIds],
    sourceDocumentRefs: [...sourceDocumentIds],
    validationStatus: ValidationStatus.UNKNOWN,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createInstrument({
  projectId,
  tag,
  type,
  equipmentId = null,
  units = "",
  range = null,
  dataClass = DataClass.ENGINEERING_INFERENCE,
  sourceDocumentIds = []
}) {
  const ts = nowIso();
  return {
    id: id("inst"),
    projectId,
    tag: String(tag).trim().toUpperCase(),
    type,
    equipmentId,
    units,
    range,
    dataClass,
    sourceDocumentIds: [...sourceDocumentIds],
    createdAt: ts,
    updatedAt: ts
  };
}

/**
 * Spec §5 signal properties — every signal supports these fields.
 */
export function createSignal({
  projectId,
  tag,
  dataType = DataType.BOOL,
  units = "",
  direction = SignalDirection.INTERNAL,
  initialValue = false,
  equipmentId = null,
  instrumentId = null,
  address = null, // legacy PLC address bridge e.g. I0, Q0
  dataClass = DataClass.ENGINEERING_INFERENCE,
  source = "p6.model"
}) {
  const ts = nowIso();
  return {
    id: id("sig"),
    projectId,
    tag: String(tag).trim(),
    dataType,
    units,
    direction,
    initialValue,
    currentValue: initialValue,
    quality: SignalQuality.GOOD,
    source,
    timestamp: ts,
    simulationOverride: false,
    overrideValue: null,
    equipmentId,
    instrumentId,
    address,
    dataClass,
    sourceDocumentRefs: [],
    validationStatus: ValidationStatus.UNKNOWN,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createControlSequence({
  projectId,
  name,
  description = "",
  stepIds = [],
  equipmentIds = [],
  dataClass = DataClass.ENGINEERING_INFERENCE
}) {
  const ts = nowIso();
  return {
    id: id("seq"),
    projectId,
    name,
    description,
    stepIds: [...stepIds],
    equipmentIds: [...equipmentIds],
    dataClass,
    validationStatus: ValidationStatus.UNKNOWN,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createVendorMapping({
  projectId,
  vendor = "ignition",
  p6Signal = null,
  p6Tag = null,
  signalId = null,
  equipmentId = null,
  vendorPath = "",
  direction = "P6_TO_VENDOR",
  status = "proposed"
}) {
  const ts = nowIso();
  return {
    id: id("vmap"),
    projectId,
    vendor,
    p6Signal,
    p6Tag,
    signalId,
    equipmentId,
    vendorPath,
    direction,
    status,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createIOPoint({
  projectId,
  signalId,
  channel = null,
  terminal = null,
  card = null,
  wiringNote = ""
}) {
  return {
    id: id("iop"),
    projectId,
    signalId,
    channel,
    terminal,
    card,
    wiringNote,
    createdAt: nowIso()
  };
}

export function createConnection({
  projectId,
  fromEquipmentId,
  toEquipmentId,
  connectionType = "process", // process | instrument | signal | mechanical | electrical | communication
  description = "",
  waypoints = []
}) {
  return {
    id: id("conn"),
    projectId,
    fromEquipmentId,
    toEquipmentId,
    connectionType,
    description,
    waypoints: Array.isArray(waypoints)
      ? waypoints.map((w) => ({ x: Number(w.x) || 0, y: Number(w.y) || 0 })).filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y))
      : [],
    createdAt: nowIso()
  };
}

export function createControlModule({
  projectId,
  name,
  equipmentIds = [],
  signalIds = [],
  description = ""
}) {
  const ts = nowIso();
  return {
    id: id("cm"),
    projectId,
    name,
    equipmentIds: [...equipmentIds],
    signalIds: [...signalIds],
    description,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createInterlock({
  projectId,
  name,
  conditionSignalIds = [],
  actionDescription = "",
  inhibitsEquipmentIds = [],
  dataClass = DataClass.ENGINEERING_INFERENCE
}) {
  return {
    id: id("ilk"),
    projectId,
    name,
    conditionSignalIds: [...conditionSignalIds],
    actionDescription,
    inhibitsEquipmentIds: [...inhibitsEquipmentIds],
    dataClass,
    validationStatus: ValidationStatus.UNKNOWN,
    createdAt: nowIso()
  };
}

export function createControlLogic({
  projectId,
  name,
  language = "ladder",
  ir = null,
  version = 1,
  staged = false,
  dataClass = DataClass.ENGINEER_APPROVED
}) {
  const ts = nowIso();
  return {
    id: id("logic"),
    projectId,
    name,
    language,
    ir,
    version,
    staged,
    dataClass,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createSimulationModel({
  projectId,
  name,
  equipmentIds = [],
  logicId = null,
  version = 1
}) {
  const ts = nowIso();
  return {
    id: id("sim"),
    projectId,
    name,
    equipmentIds: [...equipmentIds],
    logicId,
    version,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createSimulationRun({
  projectId,
  simulationModelId,
  logicVersion = null,
  status = "created", // created | running | paused | stopped | completed | failed
  startedAt = null,
  endedAt = null
}) {
  return {
    id: id("run"),
    projectId,
    simulationModelId,
    logicVersion,
    status,
    startedAt,
    endedAt,
    eventCount: 0,
    createdAt: nowIso()
  };
}

export function createTestCase({
  projectId,
  name,
  description = "",
  initialConditions = {},
  actions = [],
  expectedResults = [],
  version = 1,
  dataClass = DataClass.ENGINEER_APPROVED
}) {
  const ts = nowIso();
  return {
    id: id("tc"),
    projectId,
    name,
    description,
    initialConditions,
    actions,
    expectedResults,
    version,
    dataClass,
    createdAt: ts,
    updatedAt: ts
  };
}

export function createTestResult({
  projectId,
  testCaseId,
  modelVersion,
  logicVersion,
  runtimeVersion = "p6-runtime-dev",
  testVersion,
  pass = false,
  actualStates = {},
  expectedStates = {},
  inputSequence = [],
  simulationTimestamps = [],
  evidenceRef = null
}) {
  return {
    id: id("tr"),
    projectId,
    testCaseId,
    modelVersion,
    logicVersion,
    runtimeVersion,
    testVersion,
    pass,
    actualStates,
    expectedStates,
    inputSequence,
    simulationTimestamps,
    evidenceRef,
    executedAt: nowIso()
  };
}

export function createVendorAdapter({
  name,
  vendor,
  version,
  validated = false,
  notes = ""
}) {
  return {
    id: id("va"),
    name,
    vendor,
    version,
    validated,
    notes,
    createdAt: nowIso()
  };
}

export function createIntegrationConnection({
  projectId,
  kind, // opcua | mqtt | ignition_rest
  name,
  endpoint = "",
  mode = "SIMULATION", // SIMULATION | EXTERNAL_TEST | LIVE_INTEGRATION
  enabled = false,
  status = "disconnected",
  config = {}
}) {
  const ts = nowIso();
  return {
    id: id("int"),
    projectId,
    kind,
    name,
    endpoint,
    mode,
    enabled,
    status,
    config,
    createdAt: ts,
    updatedAt: ts
  };
}

/**
 * Ensure a loaded project object has all collections and current schemaVersion shape.
 * Does not bump modelVersion; migrate.js owns version bumps.
 */
export function normalizeProject(raw) {
  const base = createEmptyProject({ name: raw?.name || "Unnamed", description: raw?.description || "", id: raw?.id });
  const out = {
    ...base,
    ...raw,
    schemaVersion: Number(raw?.schemaVersion) || SCHEMA_VERSION,
    documents: Array.isArray(raw?.documents) ? raw.documents : [],
    documentVersions: Array.isArray(raw?.documentVersions) ? raw.documentVersions : [],
    equipment: Array.isArray(raw?.equipment) ? raw.equipment : [],
    instruments: Array.isArray(raw?.instruments) ? raw.instruments : [],
    signals: Array.isArray(raw?.signals) ? raw.signals : [],
    ioPoints: Array.isArray(raw?.ioPoints) ? raw.ioPoints : [],
    connections: Array.isArray(raw?.connections) ? raw.connections : [],
    controlModules: Array.isArray(raw?.controlModules) ? raw.controlModules : [],
    interlocks: Array.isArray(raw?.interlocks) ? raw.interlocks : [],
    controlLogic: Array.isArray(raw?.controlLogic) ? raw.controlLogic : [],
    simulationModels: Array.isArray(raw?.simulationModels) ? raw.simulationModels : [],
    simulationRuns: Array.isArray(raw?.simulationRuns) ? raw.simulationRuns : [],
    testCases: Array.isArray(raw?.testCases) ? raw.testCases : [],
    testResults: Array.isArray(raw?.testResults) ? raw.testResults : [],
    vendorAdapters: Array.isArray(raw?.vendorAdapters) ? raw.vendorAdapters : [],
    integrationConnections: Array.isArray(raw?.integrationConnections) ? raw.integrationConnections : [],
    controlSequences: Array.isArray(raw?.controlSequences) ? raw.controlSequences : [],
    vendorMappings: Array.isArray(raw?.vendorMappings) ? raw.vendorMappings : [],
    lastValidation: raw?.lastValidation ?? null,
    legacy: {
      ladderIR: raw?.legacy?.ladderIR ?? null,
      ioMap: raw?.legacy?.ioMap && typeof raw.legacy.ioMap === "object" ? raw.legacy.ioMap : {},
      causeEffectRules: Array.isArray(raw?.legacy?.causeEffectRules) ? raw.legacy.causeEffectRules : [],
      ioEntries: Array.isArray(raw?.legacy?.ioEntries) ? raw.legacy.ioEntries : []
    }
  };
  return out;
}

export function bumpModelVersion(project) {
  project.modelVersion = (Number(project.modelVersion) || 1) + 1;
  project.updatedAt = nowIso();
  return project;
}

export function validateSignalPatch(patch) {
  if (patch.dataType && !Object.values(DataType).includes(patch.dataType)) {
    throw new Error(`Invalid dataType: ${patch.dataType}`);
  }
  if (patch.direction && !Object.values(SignalDirection).includes(patch.direction)) {
    throw new Error(`Invalid direction: ${patch.direction}`);
  }
  if (patch.quality && !Object.values(SignalQuality).includes(patch.quality)) {
    throw new Error(`Invalid quality: ${patch.quality}`);
  }
  if (patch.dataClass && !Object.values(DataClass).includes(patch.dataClass)) {
    throw new Error(`Invalid dataClass: ${patch.dataClass}`);
  }
}
