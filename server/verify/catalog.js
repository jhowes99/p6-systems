/**
 * P6 Verify — test catalog for Water Transfer reference plant.
 * Only tests with executable steps against real Runtime are runnable.
 * Never invent PASS; BLOCKED when Runtime cannot exercise the requirement.
 */

import { WT_ADDR } from "../plc/equipment/water_transfer.js";

/** Result statuses — honest vocabulary */
export const VerifyStatus = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
  NOT_RUN: "NOT_RUN"
});

/**
 * Approved requirement templates used for generation + traceability.
 * Linked to seeded Water Transfer interlocks / control narrative.
 */
export const REQUIREMENT_TEMPLATES = Object.freeze([
  {
    id: "REQ-P101-START-VALID",
    equipment: ["P101", "M101", "XV101"],
    title: "Pump start permitted when E-stop healthy and high level clear",
    source: "approved_operating_conditions"
  },
  {
    id: "REQ-P101-START-BLOCKED",
    equipment: ["P101", "LSH101"],
    title: "Pump start blocked when high-level interlock active",
    source: "interlock:LSH101_INHIBIT"
  },
  {
    id: "REQ-P101-INTERLOCK-STOP",
    equipment: ["P101", "LSH101"],
    title: "High level stops running transfer and latches trip",
    source: "interlock:LSH101_INHIBIT"
  },
  {
    id: "REQ-XV101-TRAVEL-FAIL",
    equipment: ["XV101", "M101", "P101"],
    title: "Valve travel fail (no opened feedback) prevents motor energize",
    source: "fault_injection:valve_stuck"
  },
  {
    id: "REQ-P101-MOTOR-FAULT-ALARM",
    equipment: ["P101", "M101"],
    title: "Motor / pump fault raises operator alarm",
    source: "alarm:P101.Fault"
  },
  {
    id: "REQ-LSH101-BLOCKS-TRANSFER",
    equipment: ["LSH101", "P101"],
    title: "High level blocks transfer request from stopped state",
    source: "interlock:LSH101_INHIBIT"
  },
  {
    id: "REQ-ESTOP101-SHUTDOWN",
    equipment: ["ESTOP101", "P101", "M101"],
    title: "Virtual E-stop de-energizes motor and inhibits restart until reset",
    source: "interlock:ESTOP101_SHUTDOWN"
  }
]);

/**
 * Executable / blocked catalog entries.
 * Steps use the same action vocabulary as fat_runner (SET, PULSE, SCAN, ASSERT, RESET, FAULT, CLEAR_FAULT).
 */
export const VERIFY_CATALOG = Object.freeze([
  {
    id: "P101_ESTOP_SHUTDOWN",
    name: "P101_ESTOP_SHUTDOWN",
    version: 1,
    equipment: ["ESTOP101", "P101", "M101"],
    requirementRef: "REQ-ESTOP101-SHUTDOWN",
    plantTemplate: "water_transfer",
    executable: true,
    description:
      "Pump running, E-stop healthy → activate virtual E-stop → motor de-energized, pump safe, restart inhibited until reset. Simulated only — not a physical safety certification.",
    passFailCriteria:
      "After ESTOP101.Healthy=false: M101.Energize and P101.RunningFeedback false, trip latched (M1). Restart blocked until System.Reset.",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: false },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 6 },
      {
        action: "ASSERT",
        name: "pump_running_before_estop",
        checks: [
          { addr: WT_ADDR.PUMP_RUNNING, value: true },
          { addr: WT_ADDR.MOTOR, value: true },
          { addr: WT_ADDR.ESTOP_HEALTHY, value: true }
        ]
      },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: false },
      { action: "SCAN", scans: 4 },
      {
        action: "ASSERT",
        name: "shutdown",
        checks: [
          { addr: WT_ADDR.MOTOR, value: false },
          { addr: WT_ADDR.PUMP_RUNNING, value: false },
          { mem: "M1", value: true },
          { mem: "M0", value: false }
        ]
      },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 4 },
      {
        action: "ASSERT",
        name: "restart_inhibited",
        checks: [
          { addr: WT_ADDR.MOTOR, value: false },
          { addr: WT_ADDR.PUMP_RUNNING, value: false }
        ]
      },
      { action: "PULSE", addr: WT_ADDR.RESET, scans: 2 },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 6 },
      {
        action: "ASSERT",
        name: "restart_after_reset",
        checks: [{ addr: WT_ADDR.PUMP_RUNNING, value: true }]
      }
    ]
  },
  {
    id: "P101_START_VALID",
    name: "P101_START_VALID",
    version: 1,
    equipment: ["P101", "M101", "XV101"],
    requirementRef: "REQ-P101-START-VALID",
    plantTemplate: "water_transfer",
    executable: true,
    description: "With E-stop healthy and LSH clear, System.Start latches transfer and energizes motor/pump after valve opens.",
    passFailCriteria: "After start pulse and valve travel: TransferRequest (M0), XV101.OpenCommand, M101.Energize, P101.RunningFeedback all true.",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: false },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 6 },
      {
        action: "ASSERT",
        name: "transfer_running",
        checks: [
          { mem: "M0", value: true },
          { addr: WT_ADDR.VALVE_CMD, value: true },
          { addr: WT_ADDR.VALVE_OPENED, value: true },
          { addr: WT_ADDR.MOTOR, value: true },
          { addr: WT_ADDR.PUMP_RUNNING, value: true }
        ]
      }
    ]
  },
  {
    id: "P101_START_BLOCKED_LSH",
    name: "P101_START_BLOCKED_LSH",
    version: 1,
    equipment: ["P101", "LSH101"],
    requirementRef: "REQ-P101-START-BLOCKED",
    plantTemplate: "water_transfer",
    executable: true,
    description: "High level present before start — transfer request must not latch.",
    passFailCriteria: "With LSH101.High=true, after System.Start: M0 false, motor and pump off.",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: true },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 6 },
      {
        action: "ASSERT",
        name: "start_blocked",
        checks: [
          { mem: "M0", value: false },
          { addr: WT_ADDR.MOTOR, value: false },
          { addr: WT_ADDR.PUMP_RUNNING, value: false }
        ]
      }
    ]
  },
  {
    id: "P101_INTERLOCK_STOP_LSH",
    name: "P101_INTERLOCK_STOP_LSH",
    version: 1,
    equipment: ["P101", "LSH101"],
    requirementRef: "REQ-P101-INTERLOCK-STOP",
    plantTemplate: "water_transfer",
    executable: true,
    description: "While transfer running, LSH high trips request and stops motor/pump.",
    passFailCriteria: "After LSH101.High=true while running: M1 latched, M0 false, motor and pump off.",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: false },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 6 },
      {
        action: "ASSERT",
        name: "running_before_lsh",
        checks: [{ addr: WT_ADDR.PUMP_RUNNING, value: true }]
      },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: true },
      { action: "SCAN", scans: 4 },
      {
        action: "ASSERT",
        name: "interlock_stop",
        checks: [
          { mem: "M1", value: true },
          { mem: "M0", value: false },
          { addr: WT_ADDR.MOTOR, value: false },
          { addr: WT_ADDR.PUMP_RUNNING, value: false }
        ]
      }
    ]
  },
  {
    id: "XV101_VALVE_TRAVEL_FAIL",
    name: "XV101_VALVE_TRAVEL_FAIL",
    version: 1,
    equipment: ["XV101", "M101", "P101"],
    requirementRef: "REQ-XV101-TRAVEL-FAIL",
    plantTemplate: "water_transfer",
    executable: true,
    description:
      "Inject stuck-closed valve opened feedback (fault). Transfer may command valve open but motor must not energize without feedback.",
    passFailCriteria: "With XV101.OpenedFeedback stuck false: after start, VALVE_CMD may be true but MOTOR and PUMP_RUNNING remain false.",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: false },
      { action: "FAULT", addr: WT_ADDR.VALVE_OPENED, mode: "stuck", value: false },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 8 },
      {
        action: "ASSERT",
        name: "motor_blocked_without_valve_feedback",
        checks: [
          { mem: "M0", value: true },
          { addr: WT_ADDR.VALVE_CMD, value: true },
          { addr: WT_ADDR.VALVE_OPENED, value: false },
          { addr: WT_ADDR.MOTOR, value: false },
          { addr: WT_ADDR.PUMP_RUNNING, value: false }
        ]
      },
      { action: "CLEAR_FAULT", addr: WT_ADDR.VALVE_OPENED }
    ]
  },
  {
    id: "P101_MOTOR_FAULT_ALARM",
    name: "P101_MOTOR_FAULT_ALARM",
    version: 1,
    equipment: ["P101", "M101"],
    requirementRef: "REQ-P101-MOTOR-FAULT-ALARM",
    plantTemplate: "water_transfer",
    executable: false,
    blockReason:
      "Water Transfer Runtime does not raise P101.Fault or drive an alarm coil under a testable sequence yet. Catalog entry retained for requirement traceability — status BLOCKED, not PASS.",
    description: "Motor / pump fault should raise an operator alarm (not yet implemented in WT plant template).",
    passFailCriteria: "Blocked — no executable Runtime path.",
    steps: []
  },
  {
    id: "LSH101_BLOCKS_TRANSFER",
    name: "LSH101_BLOCKS_TRANSFER",
    version: 1,
    equipment: ["LSH101", "P101"],
    requirementRef: "REQ-LSH101-BLOCKS-TRANSFER",
    plantTemplate: "water_transfer",
    executable: true,
    description: "High level from stopped state blocks transfer (same permissive as start-blocked; separate requirement id for FAT matrix).",
    passFailCriteria: "LSH high → start does not latch transfer request.",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: true },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 5 },
      {
        action: "ASSERT",
        name: "transfer_blocked",
        checks: [
          { mem: "M0", value: false },
          { addr: WT_ADDR.PUMP_RUNNING, value: false },
          { addr: WT_ADDR.MOTOR, value: false }
        ]
      }
    ]
  }
]);

export function listCatalogSummaries() {
  return VERIFY_CATALOG.map((t) => ({
    id: t.id,
    name: t.name,
    version: t.version,
    equipment: t.equipment,
    requirementRef: t.requirementRef,
    executable: t.executable !== false,
    blockReason: t.blockReason || null,
    description: t.description,
    passFailCriteria: t.passFailCriteria || null,
    plantTemplate: t.plantTemplate
  }));
}

export function getCatalogTest(testId) {
  return VERIFY_CATALOG.find((t) => t.id === testId || t.name === testId) || null;
}

export function getExecutableCatalogIds() {
  return VERIFY_CATALOG.filter((t) => t.executable !== false).map((t) => t.id);
}

export function getAllCatalogIds() {
  return VERIFY_CATALOG.map((t) => t.id);
}

/** Legacy export — same object shape fat_runner historically used */
export const P101_ESTOP_SHUTDOWN = VERIFY_CATALOG.find((t) => t.id === "P101_ESTOP_SHUTDOWN");
