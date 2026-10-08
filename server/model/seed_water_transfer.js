/**
 * Water Transfer System — canonical model skeleton (Spec §15).
 * Equipment and signals only; full control behavior is Phase 4.
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

/**
 * Idempotent: returns existing project if already seeded by name.
 */
export function ensureWaterTransferProject() {
  const existing = listProjects().find((p) => p.name === WATER_TRANSFER_NAME);
  if (existing) {
    const full = loadProject(existing.id);
    setActiveProject(full.id);
    return { project: full, created: false };
  }

  let project = createProject({
    name: WATER_TRANSFER_NAME,
    description:
      "Reference project (Spec section 15): TANK101, XV101, P101, M101, LSH101, ESTOP101. " +
      "Skeleton for Phase 4 runtime behavior. Simulated E-stop is model behavior only — not a certified safety function."
  });

  const pid = project.id;

  const tank = createEquipment({
    projectId: pid,
    tag: "TANK101",
    type: "tank",
    description: "Transfer source/destination tank",
    dataClass: DataClass.ENGINEER_APPROVED,
    states: ["empty", "filling", "ready", "high"],
    initialState: "ready"
  });
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
    description: "Water transfer pump",
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

  // Signals — map to conceptual P6 paths (OPC UA later): P6Systems/Projects/WaterTransfer/...
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
      initialValue: 50,
      equipmentId: tank.id,
      address: "A0",
      dataClass: DataClass.ENGINEER_APPROVED
    })
  ];
  project.signals.push(...signals);

  const byTag = Object.fromEntries(signals.map((s) => [s.tag, s]));

  project.connections.push(
    createConnection({
      projectId: pid,
      fromEquipmentId: tank.id,
      toEquipmentId: valve.id,
      connectionType: "process",
      description: "Tank outlet to valve"
    }),
    createConnection({
      projectId: pid,
      fromEquipmentId: valve.id,
      toEquipmentId: pump.id,
      connectionType: "process",
      description: "Valve to pump suction"
    }),
    createConnection({
      projectId: pid,
      fromEquipmentId: motor.id,
      toEquipmentId: pump.id,
      connectionType: "mechanical",
      description: "Motor drives pump"
    })
  );

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

  // Placeholder FAT — execution in Phase 7; definition stored now for traceability
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

  // Legacy bridge for existing monitor/address UI
  project.legacy.ioMap = Object.fromEntries(
    signals.filter((s) => s.address).map((s) => [s.tag, s.address])
  );
  project.legacy.ioEntries = signals
    .filter((s) => s.address)
    .map((s) => ({
      tag: s.tag,
      address: s.address,
      type: s.dataType,
      direction: s.direction,
      description: s.tag
    }));

  project = saveProject(project, { bumpVersion: false });
  setActiveProject(project.id);
  return { project, created: true };
}
