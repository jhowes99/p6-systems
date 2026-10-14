/**
 * Master Spec §14 / §40 — Two-tank transfer demonstration plant.
 * Sample/simulated data only. ESD is model behavior, not a certified safety function.
 *
 * Path: TANK-101 → PUMP-101 → VALVE-101 → TANK-102 (+ LT-101, M-101, ESD-101)
 */

import {
  DataClass,
  DataType,
  SignalDirection,
  createEquipment,
  createSignal,
  createInstrument,
  createConnection,
  createInterlock,
  createControlModule,
  createTestCase,
  createIntegrationConnection,
  createSimulationModel
} from "./schema.js";
import {
  createProject,
  listProjects,
  loadProject,
  saveProject,
  setActiveProject,
  deleteProject
} from "./store.js";

export const TANK_TRANSFER_DEMO_NAME = "P6 Demo — Tank Transfer System";
export const TANK_TRANSFER_DEMO_SLUG = "p6-demo-tank-transfer";

/** Canonical §40 demo tags — E2E ingest leaves ESD-E2E-* / PUMP-201 extras otherwise. */
export const TANK_TRANSFER_CANONICAL_TAGS = Object.freeze([
  "TANK-101",
  "TANK-102",
  "PUMP-101",
  "M-101",
  "VALVE-101",
  "LT-101",
  "ESD-101"
]);

/**
 * Strip non-canonical equipment (and orphans) from the Tank Transfer demo.
 * Persists across reboots via project.json — without this, Studio Simulate fills with junk rows.
 */
export function pruneTankTransferExtras(project) {
  if (!project || project.name !== TANK_TRANSFER_DEMO_NAME) {
    return { project, pruned: false, removedTags: [] };
  }
  const keepTags = new Set(TANK_TRANSFER_CANONICAL_TAGS);
  const keepIds = new Set();
  const removedTags = [];

  project.equipment = (project.equipment || []).filter((e) => {
    if (keepTags.has(e.tag)) {
      keepIds.add(e.id);
      return true;
    }
    removedTags.push(e.tag);
    return false;
  });

  project.instruments = (project.instruments || []).filter(
    (inst) => (inst.equipmentId && keepIds.has(inst.equipmentId)) || keepTags.has(inst.tag)
  );
  project.signals = (project.signals || []).filter((s) => {
    if (s.equipmentId && keepIds.has(s.equipmentId)) return true;
    const root = String(s.tag || "").split(".")[0];
    return keepTags.has(root);
  });
  project.connections = (project.connections || []).filter(
    (c) => keepIds.has(c.fromEquipmentId) && keepIds.has(c.toEquipmentId)
  );
  project.interlocks = (project.interlocks || []).filter((ilk) => {
    const inhibits = ilk.inhibitsEquipmentIds || [];
    if (inhibits.length) {
      ilk.inhibitsEquipmentIds = inhibits.filter((id) => keepIds.has(id));
      return ilk.inhibitsEquipmentIds.length > 0;
    }
    return (ilk.conditionSignalIds || []).some((sid) =>
      (project.signals || []).some((s) => s.id === sid)
    );
  });

  // Restore §40 P&ID coordinates whenever we prune (auto-layout dumps survivors into a grid)
  const byTag = Object.fromEntries((project.equipment || []).map((e) => [e.tag, e]));
  const layout = {};
  const place = (tag, box) => {
    const e = byTag[tag];
    if (e) layout[e.id] = box;
  };
  place("TANK-101", { x: 60, y: 160, w: 160, h: 100 });
  place("PUMP-101", { x: 320, y: 180, w: 140, h: 80 });
  place("M-101", { x: 320, y: 320, w: 120, h: 70 });
  place("VALVE-101", { x: 560, y: 180, w: 120, h: 80 });
  place("TANK-102", { x: 800, y: 160, w: 160, h: 100 });
  place("LT-101", { x: 800, y: 40, w: 120, h: 70 });
  place("ESD-101", { x: 560, y: 40, w: 120, h: 70 });
  project.ui = project.ui || {};
  project.ui.graph = { nodes: layout, updatedAt: new Date().toISOString() };

  project.meta = {
    ...(project.meta || {}),
    demoPruneVersion: 2,
    lastDemoPruneAt: new Date().toISOString(),
    lastDemoPruneRemoved: removedTags
  };
  return { project, pruned: true, removedTags };
}

function eq(projectId, tag, type, description, states, initialState, properties = {}) {
  const e = createEquipment({
    projectId,
    tag,
    type,
    description,
    dataClass: DataClass.ENGINEER_APPROVED,
    states,
    initialState
  });
  e.properties = { ...properties };
  return e;
}

function isCurrentDemo(project) {
  const tags = new Set((project.equipment || []).map((e) => e.tag));
  return tags.has("TANK-101") && tags.has("TANK-102") && tags.has("PUMP-101") && tags.has("VALVE-101") && tags.has("LT-101");
}

/**
 * Idempotent: returns §40-shaped demo; upgrades obsolete Part-13 tag sets by recreate.
 */
export function ensureTankTransferDemoProject() {
  const existing = listProjects().find((p) => p.name === TANK_TRANSFER_DEMO_NAME);
  if (existing) {
    let full = loadProject(existing.id);
    if (isCurrentDemo(full)) {
      const needsPrune =
        full.meta?.demoPruneVersion !== 2 ||
        (full.equipment || []).some((e) => !TANK_TRANSFER_CANONICAL_TAGS.includes(e.tag));
      if (needsPrune) {
        const { project: cleaned, pruned } = pruneTankTransferExtras(full);
        full = saveProject(cleaned, { bumpVersion: false });
        setActiveProject(full.id);
        return { project: full, created: false, upgraded: !!pruned };
      }
      setActiveProject(full.id);
      return { project: full, created: false, upgraded: false };
    }
    deleteProject(full.id);
  }

  let project = createProject({
    name: TANK_TRANSFER_DEMO_NAME,
    description:
      "Master Spec §40 sample plant (simulated): TANK-101 → PUMP-101 → VALVE-101 → TANK-102 with LT-101 and ESD-101. " +
      "Sample/simulated data only. Simulated E-stop is model behavior — not a certified physical safety function."
  });

  const pid = project.id;

  const tank101 = eq(
    pid,
    "TANK-101",
    "tank",
    "Source storage tank",
    ["empty", "ready", "low", "high"],
    "ready",
    { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 70, highAlarmPct: 90, highHighAlarmPct: 95, lowAlarmPct: 10 }
  );
  const tank102 = eq(
    pid,
    "TANK-102",
    "tank",
    "Destination tank",
    ["empty", "ready", "filling", "high"],
    "ready",
    { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 25, highAlarmPct: 90, highHighAlarmPct: 95, lowAlarmPct: 10 }
  );
  const pump101 = eq(pid, "PUMP-101", "pump", "Transfer pump", ["stopped", "starting", "running", "stopping", "fault", "safe"], "stopped");
  const m101 = eq(pid, "M-101", "motor", "Pump motor", ["deenergized", "energized", "fault"], "deenergized");
  const valve101 = eq(pid, "VALVE-101", "valve", "Discharge isolation valve", ["closed", "opening", "open", "closing", "fault"], "closed");
  const lt101 = eq(pid, "LT-101", "level_transmitter", "Level transmitter on TANK-102", ["ok", "high", "fault"], "ok");
  const esd101 = eq(pid, "ESD-101", "emergency_stop_input", "Simulated E-stop (model only)", ["healthy", "activated"], "healthy");

  project.equipment.push(tank101, tank102, pump101, m101, valve101, lt101, esd101);

  const ltInst = createInstrument({
    projectId: pid,
    tag: "LT-101",
    type: "level_transmitter",
    equipmentId: lt101.id,
    units: "%",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  project.instruments.push(ltInst);

  const signals = [
    createSignal({
      projectId: pid,
      tag: "PUMP-101.RunCommand",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: pump101.id,
      address: "I0",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "PUMP-101.RunningFeedback",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: pump101.id,
      address: "Q1",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "PUMP-101.Fault",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: pump101.id,
      address: "Q2",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "M-101.Energize",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: m101.id,
      address: "Q0",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "VALVE-101.OpenCommand",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: valve101.id,
      address: "I7",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "VALVE-101.OpenedFeedback",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: valve101.id,
      address: "I1",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "LT-101.High",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: lt101.id,
      instrumentId: ltInst.id,
      address: "I2",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "ESD-101.Healthy",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: true,
      equipmentId: esd101.id,
      address: "I3",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "System.Start",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      address: "I4",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "System.Reset",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      address: "I5",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "TANK-101.LevelPct",
      dataType: DataType.REAL,
      direction: SignalDirection.INPUT,
      units: "%",
      initialValue: 70,
      equipmentId: tank101.id,
      address: "A0",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "TANK-102.LevelPct",
      dataType: DataType.REAL,
      direction: SignalDirection.INPUT,
      units: "%",
      initialValue: 25,
      equipmentId: tank102.id,
      address: "A1",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "LT-101.LevelPct",
      dataType: DataType.REAL,
      direction: SignalDirection.INPUT,
      units: "%",
      initialValue: 25,
      equipmentId: lt101.id,
      instrumentId: ltInst.id,
      address: "A1",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    }),
    createSignal({
      projectId: pid,
      tag: "FIT-101.FlowGpm",
      dataType: DataType.REAL,
      direction: SignalDirection.INPUT,
      units: "gpm",
      initialValue: 0,
      address: "A3",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.sample"
    })
  ];
  project.signals.push(...signals);
  const byTag = Object.fromEntries(signals.map((s) => [s.tag, s]));

  project.connections.push(
    createConnection({
      projectId: pid,
      fromEquipmentId: tank101.id,
      toEquipmentId: pump101.id,
      connectionType: "process",
      description: "TANK-101 to PUMP-101 suction"
    }),
    createConnection({
      projectId: pid,
      fromEquipmentId: m101.id,
      toEquipmentId: pump101.id,
      connectionType: "mechanical",
      description: "M-101 drives PUMP-101"
    }),
    createConnection({
      projectId: pid,
      fromEquipmentId: pump101.id,
      toEquipmentId: valve101.id,
      connectionType: "process",
      description: "PUMP-101 discharge to VALVE-101"
    }),
    createConnection({
      projectId: pid,
      fromEquipmentId: valve101.id,
      toEquipmentId: tank102.id,
      connectionType: "process",
      description: "VALVE-101 to TANK-102"
    }),
    createConnection({
      projectId: pid,
      fromEquipmentId: lt101.id,
      toEquipmentId: tank102.id,
      connectionType: "instrument",
      description: "LT-101 measures TANK-102"
    })
  );

  project.interlocks.push(
    createInterlock({
      projectId: pid,
      name: "LT101_HIGH_SHUTDOWN",
      conditionSignalIds: [byTag["LT-101.High"].id],
      actionDescription: "High destination level stops transfer (interlock)",
      inhibitsEquipmentIds: [pump101.id, m101.id],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createInterlock({
      projectId: pid,
      name: "ESD101_SHUTDOWN",
      conditionSignalIds: [byTag["ESD-101.Healthy"].id],
      actionDescription:
        "When ESD-101.Healthy becomes false: de-energize motor, pump safe, close path, inhibit auto-restart until reset. Simulated only.",
      inhibitsEquipmentIds: [pump101.id, m101.id, valve101.id],
      dataClass: DataClass.ENGINEER_APPROVED
    })
  );

  project.controlModules.push(
    createControlModule({
      projectId: pid,
      name: "TankTransferTrain",
      equipmentIds: project.equipment.map((e) => e.id),
      signalIds: signals.map((s) => s.id),
      description: "§40 two-tank transfer control module (sample)"
    })
  );

  project.simulationModels.push(
    createSimulationModel({
      projectId: pid,
      name: "TankTransferSim",
      equipmentIds: project.equipment.map((e) => e.id),
      version: 2
    })
  );

  project.testCases.push(
    createTestCase({
      projectId: pid,
      name: "P101_ESTOP_SHUTDOWN",
      description:
        "Pump running, ESD-101 healthy → activate virtual E-stop → motor de-energized, pump safe, restart inhibited until reset. Simulated only.",
      version: 1,
      initialConditions: {
        "PUMP-101.RunningFeedback": true,
        "M-101.Energize": true,
        "ESD-101.Healthy": true
      },
      actions: [{ type: "SET_SIGNAL", tag: "ESD-101.Healthy", value: false }],
      expectedResults: [
        { tag: "M-101.Energize", value: false },
        { tag: "PUMP-101.RunningFeedback", value: false },
        { note: "Automatic restart inhibited; System.Reset required" }
      ],
      dataClass: DataClass.ENGINEER_APPROVED
    })
  );

  project.integrationConnections.push(
    createIntegrationConnection({
      projectId: pid,
      kind: "opcua",
      name: "P6 Runtime OPC UA",
      endpoint: "",
      mode: "SIMULATION",
      enabled: true,
      status: "runtime",
      config: {
        namespace: "P6Systems",
        pathPrefix: "P6Systems/Projects/TankTransferDemo",
        note: "Sample plant tags published when OPC UA server is enabled"
      }
    })
  );

  project.ui = project.ui || {};
  project.ui.graph = {
    updatedAt: new Date().toISOString(),
    nodes: {
      [tank101.id]: { x: 60, y: 160, w: 160, h: 100 },
      [pump101.id]: { x: 320, y: 180, w: 140, h: 80 },
      [m101.id]: { x: 320, y: 320, w: 120, h: 70 },
      [valve101.id]: { x: 560, y: 180, w: 120, h: 80 },
      [tank102.id]: { x: 800, y: 160, w: 160, h: 100 },
      [lt101.id]: { x: 800, y: 40, w: 120, h: 70 },
      [esd101.id]: { x: 560, y: 40, w: 120, h: 70 }
    }
  };

  project.legacy.ioMap = Object.fromEntries(signals.filter((s) => s.address).map((s) => [s.tag, s.address]));
  project.legacy.ioEntries = signals
    .filter((s) => s.address)
    .map((s) => ({
      tag: s.tag,
      address: s.address,
      type: s.dataType,
      direction: s.direction,
      description: s.tag
    }));
  project.meta = {
    ...(project.meta || {}),
    samplePlant: true,
    masterSpecSection: 40,
    slug: TANK_TRANSFER_DEMO_SLUG,
    dataLabel: "sample/simulated"
  };

  project = saveProject(project, { bumpVersion: false });
  setActiveProject(project.id);
  return { project, created: true, upgraded: !!existing };
}
