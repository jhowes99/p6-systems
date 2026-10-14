/**
 * Water Transfer System — canonical model (Spec §15) + Phase 2 P&ID demo layout.
 * Runtime control path preserved (TANK101/XV101/P101/M101/LSH101/ESTOP101 addresses).
 * Simulated E-stop is model behavior only — not a certified safety function.
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
import { createProject, listProjects, loadProject, saveProject, setActiveProject } from "./store.js";

export const WATER_TRANSFER_NAME = "Water Transfer System";
export const WATER_TRANSFER_SLUG = "water-transfer-system";

function eqByTag(project, tag) {
  return (project.equipment || []).find((e) => e.tag === tag);
}

function ensureSignal(project, spec) {
  const existing = (project.signals || []).find((s) => s.tag === spec.tag);
  if (existing) {
    if (spec.equipmentId && !existing.equipmentId) existing.equipmentId = spec.equipmentId;
    return existing;
  }
  const sig = createSignal(spec);
  project.signals.push(sig);
  return sig;
}

function ensureConnection(project, spec) {
  const dup = (project.connections || []).some(
    (c) =>
      c.fromEquipmentId === spec.fromEquipmentId &&
      c.toEquipmentId === spec.toEquipmentId &&
      c.connectionType === (spec.connectionType || "process")
  );
  if (dup) {
    const c = project.connections.find(
      (x) =>
        x.fromEquipmentId === spec.fromEquipmentId &&
        x.toEquipmentId === spec.toEquipmentId &&
        x.connectionType === (spec.connectionType || "process")
    );
    if (c && spec.fromPortId && !c.fromPortId) c.fromPortId = spec.fromPortId;
    if (c && spec.toPortId && !c.toPortId) c.toPortId = spec.toPortId;
    return c;
  }
  const conn = createConnection(spec);
  project.connections.push(conn);
  return conn;
}

/** Restore TANK101 if a prior edit renamed the source tank (upgrade must not no-op). */
function restoreTank101(project) {
  let tank = eqByTag(project, "TANK101");
  if (tank) return { tank, changed: false };

  const valve = eqByTag(project, "XV101");
  const tanks = (project.equipment || []).filter((e) => e.type === "tank" && e.tag !== "TANK102");
  if (valve) {
    const viaConn = (project.connections || []).find(
      (c) =>
        (c.toEquipmentId === valve.id || c.fromEquipmentId === valve.id) &&
        tanks.some((t) => t.id === c.fromEquipmentId || t.id === c.toEquipmentId)
    );
    if (viaConn) {
      const id = viaConn.fromEquipmentId === valve.id ? viaConn.toEquipmentId : viaConn.fromEquipmentId;
      tank = tanks.find((t) => t.id === id) || null;
    }
  }
  if (!tank && tanks.length === 1) tank = tanks[0];
  if (!tank) {
    tank =
      tanks.find((t) => /source|supply|transfer/i.test(t.description || "")) ||
      tanks.find((t) => /^EDIT/i.test(t.tag || "")) ||
      (project.equipment || []).find((t) => /^EDIT/i.test(t.tag || "")) ||
      null;
  }
  // Polluted demos may have renamed/removed the source tank entirely — recreate rather than no-op.
  if (!tank) {
    tank = createEquipment({
      projectId: project.id,
      tag: "TANK101",
      type: "tank",
      description: "Source / supply tank",
      dataClass: DataClass.ENGINEER_APPROVED,
      states: ["empty", "filling", "ready", "high"],
      initialState: "ready"
    });
    tank.properties = { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 65, highAlarmPct: 90 };
    project.equipment.push(tank);
    return { tank, changed: true };
  }

  tank.tag = "TANK101";
  tank.type = tank.type || "tank";
  tank.description = tank.description && !/^edit/i.test(tank.description) ? tank.description : "Source / supply tank";
  tank.properties = {
    heightM: 3,
    diameterM: 2,
    capacityM3: 9.42,
    initialLevelPct: 65,
    highAlarmPct: 90,
    ...(tank.properties || {})
  };
  tank.updatedAt = new Date().toISOString();
  const lvl = (project.signals || []).find((s) => s.equipmentId === tank.id && /LevelPct$/i.test(s.tag));
  if (lvl && lvl.tag !== "TANK101.LevelPct") {
    lvl.tag = "TANK101.LevelPct";
    lvl.initialValue = 65;
    lvl.address = lvl.address || "A0";
  }
  return { tank, changed: true };
}

/** Canonical Water Transfer tags — demos/E2E often dump extras onto this project. */
export const WATER_TRANSFER_CANONICAL_TAGS = Object.freeze([
  "TANK101",
  "TANK102",
  "XV101",
  "P101",
  "M101",
  "LT101",
  "FT101",
  "PT101",
  "LSH101",
  "ESTOP101"
]);

/**
 * Remove non-canonical equipment (and orphan signals/instruments/connections/graph nodes)
 * left behind by library drops / E2E pollution. Only for Water Transfer System.
 */
export function pruneWaterTransferExtras(project) {
  if (!project || project.name !== WATER_TRANSFER_NAME) {
    return { project, pruned: false, removedTags: [] };
  }
  const keepTags = new Set(WATER_TRANSFER_CANONICAL_TAGS);
  const keepIds = new Set();
  const removedTags = [];
  const before = (project.equipment || []).length;

  project.equipment = (project.equipment || []).filter((e) => {
    if (keepTags.has(e.tag)) {
      keepIds.add(e.id);
      return true;
    }
    removedTags.push(e.tag);
    return false;
  });

  if (removedTags.length === 0 && project.meta?.demoPruneVersion === 1) {
    return { project, pruned: false, removedTags: [] };
  }

  const keepInst = new Set();
  project.instruments = (project.instruments || []).filter((inst) => {
    if (inst.equipmentId && keepIds.has(inst.equipmentId)) {
      keepInst.add(inst.id);
      return true;
    }
    if (inst.tag && keepTags.has(inst.tag)) {
      keepInst.add(inst.id);
      return true;
    }
    return false;
  });

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
    if (inhibits.length && inhibits.every((id) => keepIds.has(id))) return true;
    if (inhibits.some((id) => keepIds.has(id))) {
      ilk.inhibitsEquipmentIds = inhibits.filter((id) => keepIds.has(id));
      return true;
    }
    // Keep ESD/LSH style interlocks tied to remaining signals
    const sigOk = (ilk.conditionSignalIds || []).some((sid) =>
      (project.signals || []).some((s) => s.id === sid)
    );
    return sigOk || !inhibits.length;
  });

  if (project.ui?.graph?.nodes && typeof project.ui.graph.nodes === "object") {
    const nodes = project.ui.graph.nodes;
    if (Array.isArray(nodes)) {
      project.ui.graph.nodes = nodes.filter((n) => keepIds.has(n.id));
    } else {
      for (const id of Object.keys(nodes)) {
        if (!keepIds.has(id)) delete nodes[id];
      }
    }
  }

  const pruned = removedTags.length > 0 || (project.equipment || []).length !== before;
  project.meta = {
    ...(project.meta || {}),
    demoPruneVersion: 1,
    lastDemoPruneAt: new Date().toISOString(),
    lastDemoPruneRemoved: removedTags
  };
  return { project, pruned: pruned || removedTags.length > 0, removedTags };
}

/** Phase 2 diagram layout + destination tank / transmitters (idempotent upgrade). */
function upgradeWaterTransferDiagram(project) {
  const pid = project.id;
  let changed = false;

  const pruned = pruneWaterTransferExtras(project);
  if (pruned.pruned) {
    changed = true;
    // Force Phase 2 layout rewrite after removing junk rows under the P&ID
    if (project.meta) project.meta.symbolDemoVersion = 1;
  }

  const restored = restoreTank101(project);
  const tank101 = restored.tank;
  if (restored.changed) changed = true;

  const valve = eqByTag(project, "XV101");
  const pump = eqByTag(project, "P101");
  const motor = eqByTag(project, "M101");
  const lsh = eqByTag(project, "LSH101");
  const estop = eqByTag(project, "ESTOP101");
  if (!tank101 || !valve || !pump || !motor) return { project, upgraded: changed };

  let tank102 = eqByTag(project, "TANK102");
  if (!tank102) {
    tank102 = createEquipment({
      projectId: pid,
      tag: "TANK102",
      type: "tank",
      description: "Destination / receiving tank",
      dataClass: DataClass.ENGINEER_APPROVED,
      states: ["empty", "filling", "ready", "high"],
      initialState: "empty"
    });
    tank102.properties = { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 15, highAlarmPct: 90 };
    project.equipment.push(tank102);
    changed = true;
  }

  let lt = eqByTag(project, "LT101");
  if (!lt) {
    lt = createEquipment({
      projectId: pid,
      tag: "LT101",
      type: "level_transmitter",
      description: "Source tank level transmitter",
      dataClass: DataClass.ENGINEER_APPROVED,
      states: ["ok", "alarm"],
      initialState: "ok"
    });
    project.equipment.push(lt);
    project.instruments.push(
      createInstrument({
        projectId: pid,
        tag: "LT101",
        type: "level_transmitter",
        equipmentId: lt.id,
        units: "%",
        dataClass: DataClass.ENGINEER_APPROVED
      })
    );
    changed = true;
  }

  let ft = eqByTag(project, "FT101");
  if (!ft) {
    ft = createEquipment({
      projectId: pid,
      tag: "FT101",
      type: "flow_transmitter",
      description: "Transfer line flow transmitter",
      dataClass: DataClass.ENGINEER_APPROVED,
      states: ["ok"],
      initialState: "ok"
    });
    project.equipment.push(ft);
    project.instruments.push(
      createInstrument({
        projectId: pid,
        tag: "FT101",
        type: "flow_transmitter",
        equipmentId: ft.id,
        units: "gpm",
        dataClass: DataClass.ENGINEER_APPROVED
      })
    );
    changed = true;
  }

  let pt = eqByTag(project, "PT101");
  if (!pt) {
    pt = createEquipment({
      projectId: pid,
      tag: "PT101",
      type: "pressure_transmitter",
      description: "Pump discharge pressure transmitter",
      dataClass: DataClass.ENGINEER_APPROVED,
      states: ["ok"],
      initialState: "ok"
    });
    project.equipment.push(pt);
    project.instruments.push(
      createInstrument({
        projectId: pid,
        tag: "PT101",
        type: "pressure_transmitter",
        equipmentId: pt.id,
        units: "psi",
        dataClass: DataClass.ENGINEER_APPROVED
      })
    );
    changed = true;
  }

  ensureSignal(project, {
    projectId: pid,
    tag: "TANK101.LevelPct",
    dataType: DataType.REAL,
    direction: SignalDirection.INPUT,
    units: "%",
    initialValue: 65,
    equipmentId: tank101.id,
    address: "A0",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  ensureSignal(project, {
    projectId: pid,
    tag: "TANK102.LevelPct",
    dataType: DataType.REAL,
    direction: SignalDirection.INPUT,
    units: "%",
    initialValue: 15,
    equipmentId: tank102.id,
    address: "A1",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  ensureSignal(project, {
    projectId: pid,
    tag: "LT101.LevelPct",
    dataType: DataType.REAL,
    direction: SignalDirection.INPUT,
    units: "%",
    initialValue: 65,
    equipmentId: lt.id,
    address: "A4",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  ensureSignal(project, {
    projectId: pid,
    tag: "FT101.FlowGpm",
    dataType: DataType.REAL,
    direction: SignalDirection.OUTPUT,
    units: "gpm",
    initialValue: 0,
    equipmentId: ft.id,
    address: "A2",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  ensureSignal(project, {
    projectId: pid,
    tag: "PT101.PressurePsi",
    dataType: DataType.REAL,
    direction: SignalDirection.OUTPUT,
    units: "psi",
    initialValue: 0,
    equipmentId: pt.id,
    address: "A3",
    dataClass: DataClass.ENGINEER_APPROVED
  });

  // Process piping: TANK101 → XV101 → P101 → TANK102
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: tank101.id,
    toEquipmentId: valve.id,
    connectionType: "process",
    description: "Source tank outlet to isolation valve",
    fromPortId: "outlet",
    toPortId: "in"
  });
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: valve.id,
    toEquipmentId: pump.id,
    connectionType: "process",
    description: "Valve to pump suction",
    fromPortId: "out",
    toPortId: "suction"
  });
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: pump.id,
    toEquipmentId: tank102.id,
    connectionType: "process",
    description: "Pump discharge to destination tank",
    fromPortId: "discharge",
    toPortId: "inlet"
  });
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: motor.id,
    toEquipmentId: pump.id,
    connectionType: "mechanical",
    description: "Motor drives pump",
    fromPortId: "shaft",
    toPortId: "drive"
  });
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: lt.id,
    toEquipmentId: tank101.id,
    connectionType: "instrument",
    description: "LT on source tank",
    fromPortId: "process",
    toPortId: "instrument"
  });
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: ft.id,
    toEquipmentId: pump.id,
    connectionType: "instrument",
    description: "FT on pump discharge",
    fromPortId: "process",
    toPortId: "discharge"
  });
  ensureConnection(project, {
    projectId: pid,
    fromEquipmentId: pt.id,
    toEquipmentId: pump.id,
    connectionType: "instrument",
    description: "PT on pump discharge",
    fromPortId: "process",
    toPortId: "discharge"
  });
  if (lsh) {
    ensureConnection(project, {
      projectId: pid,
      fromEquipmentId: lsh.id,
      toEquipmentId: tank102.id,
      connectionType: "instrument",
      description: "High level switch on destination tank",
      fromPortId: "process",
      toPortId: "instrument"
    });
  }

  project.ui = project.ui || {};
  const prevLayout = project.ui.graph?.nodes || {};
  const forceLayout = !prevLayout[tank102.id] || project.meta?.symbolDemoVersion !== 2;
  const layoutOf = (id, fallback) => (forceLayout ? fallback : { ...fallback, ...(prevLayout[id] || {}) });
  const nodes = {
    ...prevLayout,
    [tank101.id]: layoutOf(tank101.id, { x: 40, y: 160, w: 168, h: 110 }),
    [valve.id]: layoutOf(valve.id, { x: 280, y: 185, w: 120, h: 80 }),
    [pump.id]: layoutOf(pump.id, { x: 460, y: 180, w: 140, h: 90 }),
    [motor.id]: layoutOf(motor.id, { x: 470, y: 320, w: 130, h: 85 }),
    [tank102.id]: layoutOf(tank102.id, { x: 700, y: 160, w: 168, h: 110 }),
    [lt.id]: layoutOf(lt.id, { x: 80, y: 40, w: 110, h: 75 }),
    [ft.id]: layoutOf(ft.id, { x: 580, y: 60, w: 110, h: 75 }),
    [pt.id]: layoutOf(pt.id, { x: 460, y: 40, w: 110, h: 75 })
  };
  if (lsh) nodes[lsh.id] = layoutOf(lsh.id, { x: 740, y: 40, w: 110, h: 75 });
  if (estop) nodes[estop.id] = layoutOf(estop.id, { x: 280, y: 40, w: 110, h: 80 });

  if (forceLayout) {
    project.ui.graph = { nodes, updatedAt: new Date().toISOString() };
    changed = true;
  } else if (!project.ui.graph) {
    project.ui.graph = { nodes, updatedAt: new Date().toISOString() };
    changed = true;
  }

  if (tank101.description === "Transfer source/destination tank") {
    tank101.description = "Source / supply tank";
    changed = true;
  }

  const allIds = [tank101.id, tank102.id, valve.id, pump.id, motor.id, lt.id, ft.id, pt.id];
  if (lsh) allIds.push(lsh.id);
  if (estop) allIds.push(estop.id);

  const cm = (project.controlModules || []).find((c) => c.name === "TransferTrain");
  if (cm) {
    cm.equipmentIds = [...new Set([...(cm.equipmentIds || []), ...allIds])];
    cm.signalIds = (project.signals || []).map((s) => s.id);
  }

  project.legacy = project.legacy || {};
  project.legacy.ioMap = Object.fromEntries(
    (project.signals || []).filter((s) => s.address).map((s) => [s.tag, s.address])
  );
  project.legacy.ioEntries = (project.signals || [])
    .filter((s) => s.address)
    .map((s) => ({
      tag: s.tag,
      address: s.address,
      type: s.dataType,
      direction: s.direction,
      description: s.tag
    }));

  if (project.meta?.symbolDemoVersion !== 2) changed = true;
  project.meta = {
    ...(project.meta || {}),
    slug: WATER_TRANSFER_SLUG,
    masterSpecSection: 15,
    template: "water_transfer",
    dataLabel: "reference/simulated",
    symbolDemoVersion: 2
  };
  project.description =
    "Reference P&ID (Spec §15 / Phase 2): TANK101→XV101→P101(+M101)→TANK102 with LT101/FT101/PT101. " +
    "Runtime energize path unchanged. Simulated E-stop is model behavior only — not a certified safety function.";

  return { project, upgraded: changed };
}

/**
 * Idempotent: returns existing project if already seeded by name; upgrades diagram to Phase 2.
 */
export function ensureWaterTransferProject() {
  const existing = listProjects().find((p) => p.name === WATER_TRANSFER_NAME);
  if (existing) {
    let full = loadProject(existing.id);
    const needsMeta =
      !full.meta?.slug ||
      full.meta?.symbolDemoVersion !== 2 ||
      full.meta?.demoPruneVersion !== 1;
    const { project: upgraded, upgraded: did } = upgradeWaterTransferDiagram(full);
    if (did || needsMeta) {
      full = saveProject(upgraded, { bumpVersion: false });
    } else {
      full = upgraded;
    }
    setActiveProject(full.id);
    return { project: full, created: false, upgraded: did || needsMeta };
  }

  let project = createProject({
    name: WATER_TRANSFER_NAME,
    description:
      "Reference P&ID (Spec §15 / Phase 2): TANK101→XV101→P101(+M101)→TANK102 with LT101/FT101/PT101. " +
      "Simulated E-stop is model behavior only — not a certified safety function."
  });

  const pid = project.id;

  const tank = createEquipment({
    projectId: pid,
    tag: "TANK101",
    type: "tank",
    description: "Source / supply tank",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["empty", "filling", "ready", "high"],
    initialState: "ready"
  });
  tank.properties = { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 65, highAlarmPct: 90 };
  const valve = createEquipment({
    projectId: pid,
    tag: "XV101",
    type: "valve",
    description: "Transfer path isolation valve",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["closed", "opening", "open", "closing", "fault"],
    initialState: "closed"
  });
  const pump = createEquipment({
    projectId: pid,
    tag: "P101",
    type: "pump",
    description: "Centrifugal water transfer pump",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["stopped", "starting", "running", "stopping", "fault", "safe"],
    initialState: "stopped"
  });
  const motor = createEquipment({
    projectId: pid,
    tag: "M101",
    type: "motor",
    description: "Pump drive motor",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["deenergized", "energized", "fault"],
    initialState: "deenergized"
  });
  const lsh = createEquipment({
    projectId: pid,
    tag: "LSH101",
    type: "level_switch",
    description: "High level switch — inhibits transfer when active",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["normal", "high"],
    initialState: "normal"
  });
  const estop = createEquipment({
    projectId: pid,
    tag: "ESTOP101",
    type: "emergency_stop_input",
    description: "Simulated E-stop input (model behavior only)",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["healthy", "activated"],
    initialState: "healthy"
  });

  project.equipment.push(tank, valve, pump, motor, lsh, estop);

  const lshInst = createInstrument({
    projectId: pid,
    tag: "LSH101",
    type: "level_switch",
    equipmentId: lsh.id,
    units: "",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  project.instruments.push(lshInst);

  const signals = [
    createSignal({
      projectId: pid,
      tag: "P101.RunCommand",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: pump.id,
      address: "I0",
      dataClass: DataClass.ENGINEER_APPROVED,
      source: "p6.model"
    }),
    createSignal({
      projectId: pid,
      tag: "P101.RunningFeedback",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: pump.id,
      address: "Q1",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "P101.Fault",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: pump.id,
      address: "Q2",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "M101.Energize",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: motor.id,
      address: "Q0",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "XV101.OpenCommand",
      dataType: DataType.BOOL,
      direction: SignalDirection.OUTPUT,
      initialValue: false,
      equipmentId: valve.id,
      address: "Q3",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "XV101.OpenedFeedback",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: valve.id,
      address: "I1",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "LSH101.High",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      equipmentId: lsh.id,
      instrumentId: lshInst.id,
      address: "I2",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "ESTOP101.Healthy",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: true,
      equipmentId: estop.id,
      address: "I3",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "System.Start",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      address: "I4",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "System.Reset",
      dataType: DataType.BOOL,
      direction: SignalDirection.INPUT,
      initialValue: false,
      address: "I5",
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createSignal({
      projectId: pid,
      tag: "TANK101.LevelPct",
      dataType: DataType.REAL,
      direction: SignalDirection.INPUT,
      units: "%",
      initialValue: 65,
      equipmentId: tank.id,
      address: "A0",
      dataClass: DataClass.ENGINEER_APPROVED
    })
  ];
  project.signals.push(...signals);

  const byTag = Object.fromEntries(signals.map((s) => [s.tag, s]));

  project.interlocks.push(
    createInterlock({
      projectId: pid,
      name: "LSH101_INHIBIT",
      conditionSignalIds: [byTag["LSH101.High"].id],
      actionDescription: "High level inhibits transfer start and running",
      inhibitsEquipmentIds: [pump.id, motor.id],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createInterlock({
      projectId: pid,
      name: "ESTOP101_SHUTDOWN",
      conditionSignalIds: [byTag["ESTOP101.Healthy"].id],
      actionDescription:
        "When ESTOP101.Healthy becomes false: de-energize motor, pump to safe state, inhibit auto-restart until reset",
      inhibitsEquipmentIds: [pump.id, motor.id, valve.id],
      dataClass: DataClass.ENGINEER_APPROVED
    })
  );

  project.controlModules.push(
    createControlModule({
      projectId: pid,
      name: "TransferTrain",
      equipmentIds: [tank.id, valve.id, pump.id, motor.id, lsh.id, estop.id],
      signalIds: signals.map((s) => s.id),
      description: "Water transfer train control module"
    })
  );

  project.simulationModels.push(
    createSimulationModel({
      projectId: pid,
      name: "WaterTransferSim",
      equipmentIds: [tank.id, valve.id, pump.id, motor.id, lsh.id, estop.id],
      version: 1
    })
  );

  project.testCases.push(
    createTestCase({
      projectId: pid,
      name: "P101_ESTOP_SHUTDOWN",
      description:
        "Pump running, E-stop healthy → activate virtual E-stop → motor de-energized, pump safe, restart inhibited until reset. " +
        "Simulated input only; does not certify physical safety.",
      version: 1,
      initialConditions: {
        "P101.RunningFeedback": true,
        "M101.Energize": true,
        "ESTOP101.Healthy": true
      },
      actions: [{ type: "SET_SIGNAL", tag: "ESTOP101.Healthy", value: false }],
      expectedResults: [
        { tag: "M101.Energize", value: false },
        { tag: "P101.RunningFeedback", value: false },
        { note: "Automatic restart inhibited; System.Reset required" }
      ],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createTestCase({
      projectId: pid,
      name: "P101_START_VALID",
      description: "Valid start when E-stop healthy and high level clear.",
      version: 1,
      initialConditions: { "ESTOP101.Healthy": true, "LSH101.High": false },
      actions: [{ type: "PULSE", tag: "System.Start" }],
      expectedResults: [{ tag: "P101.RunningFeedback", value: true }],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createTestCase({
      projectId: pid,
      name: "P101_START_BLOCKED_LSH",
      description: "Start blocked when high-level interlock active.",
      version: 1,
      initialConditions: { "LSH101.High": true },
      actions: [{ type: "PULSE", tag: "System.Start" }],
      expectedResults: [{ tag: "P101.RunningFeedback", value: false }],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createTestCase({
      projectId: pid,
      name: "P101_INTERLOCK_STOP_LSH",
      description: "High level stops running transfer.",
      version: 1,
      actions: [{ type: "SET_SIGNAL", tag: "LSH101.High", value: true }],
      expectedResults: [{ tag: "P101.RunningFeedback", value: false }],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createTestCase({
      projectId: pid,
      name: "XV101_VALVE_TRAVEL_FAIL",
      description: "Stuck valve opened feedback prevents motor energize.",
      version: 1,
      expectedResults: [{ tag: "M101.Energize", value: false }],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createTestCase({
      projectId: pid,
      name: "P101_MOTOR_FAULT_ALARM",
      description:
        "Motor fault alarm — catalog BLOCKED until Water Transfer Runtime raises P101.Fault under a testable sequence.",
      version: 1,
      expectedResults: [{ note: "BLOCKED — not executable yet" }],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createTestCase({
      projectId: pid,
      name: "LSH101_BLOCKS_TRANSFER",
      description: "High level blocks transfer from stopped state.",
      version: 1,
      initialConditions: { "LSH101.High": true },
      expectedResults: [{ tag: "P101.RunningFeedback", value: false }],
      dataClass: DataClass.ENGINEER_APPROVED
    })
  );

  project.integrationConnections.push(
    createIntegrationConnection({
      projectId: pid,
      kind: "opcua",
      name: "P6 Runtime OPC UA (planned)",
      endpoint: "",
      mode: "SIMULATION",
      enabled: false,
      status: "not_implemented",
      config: {
        namespace: "P6Systems",
        pathPrefix: "P6Systems/Projects/WaterTransfer",
        note: "OPC UA server Phase 6 — not active"
      }
    })
  );

  const { project: withDiagram } = upgradeWaterTransferDiagram(project);
  project = saveProject(withDiagram, { bumpVersion: false });
  setActiveProject(project.id);
  return { project, created: true, upgraded: true };
}
