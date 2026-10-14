/**
 * Water Transfer System — reference control + equipment simulation (Spec §15).
 *
 * Simulated E-stop demonstrates model behavior only — NOT a certified safety function.
 *
 * Address map (matches seed_water_transfer.js):
 *   I4 System.Start | I5 System.Reset | I3 ESTOP101.Healthy | I2 LSH101.High
 *   I1 XV101.OpenedFeedback (equipment-written)
 *   Q3 XV101.OpenCommand | Q0 M101.Energize | Q1 P101.RunningFeedback | Q2 P101.Fault
 *   A0 TANK101.LevelPct (source) | A1 TANK102.LevelPct (dest)
 *   A2 FT101.FlowGpm | A3 PT101.PressurePsi | A4 LT101.LevelPct (mirrors source)
 *
 * Process path: TANK101 → XV101 → P101/M101 → TANK102
 * Physics: see process_physics.js (lumped mass balance; not CFD).
 */

import {
  PHYSICS_FIDELITY,
  transferBetweenTanks,
  checkMassBalance,
  tankCapacityGal
} from "./process_physics.js";

export const WT_ADDR = Object.freeze({
  START: "I4",
  RESET: "I5",
  ESTOP_HEALTHY: "I3",
  LSH_HIGH: "I2",
  VALVE_OPENED: "I1",
  RUN_CMD: "I0",
  MOTOR: "Q0",
  PUMP_RUNNING: "Q1",
  PUMP_FAULT: "Q2",
  VALVE_CMD: "Q3",
  LEVEL_SRC: "A0",
  LEVEL_DST: "A1",
  FLOW: "A2",
  PRESSURE: "A3",
  LEVEL_LT: "A4",
  /** @deprecated use LEVEL_SRC — kept for callers expecting LEVEL */
  LEVEL: "A0"
});

/** Explicit fidelity for this plant template (honest limits). */
export const WT_FIDELITY = Object.freeze({
  ...PHYSICS_FIDELITY,
  template: "water_transfer",
  path: "TANK101 → XV101 → P101/M101 → TANK102",
  /** Demo-accelerated rated flow so tank levels move on a human commissioning timescale. */
  pumpRatedGpm: 1800,
  dryRunLevelPct: 5,
  destHighPct: 95,
  valveTravelMs: 100,
  pressureIdlePsi: 5,
  pressureRunningPsi: 35,
  tankGeom: { heightM: 3, diameterM: 2 },
  initialSourcePct: 65,
  initialDestPct: 15,
  note:
    "Levels change only when motor energized, valve fully open, source above dry-run, and dest not full. " +
    "Blocked path → flow 0, levels hold. E-stop is simulated model behavior only. " +
    "pumpRatedGpm is demo-accelerated (not a plant curve); mass balance still conserves volume."
});

/**
 * Ladder IR — seal-in transfer request with E-stop + LSH permissives + trip latch (M1).
 * Equipment simulation completes the plant feedback loop.
 *
 * Supported ladder actions: COIL, SET, RESET, TON (via VirtualPLC).
 * Unsupported constructs (not in IR): CTU/CTD, PID, AO writes from ladder, structured text.
 */
export function createWaterTransferLadderIR() {
  return {
    language: "ladder",
    networks: [
      {
        rungs: [
          {
            cond: {
              op: "OR",
              a: { op: "NOT", x: { var: WT_ADDR.ESTOP_HEALTHY } },
              b: {
                op: "AND",
                a: { var: "M0" },
                b: { var: WT_ADDR.LSH_HIGH }
              }
            },
            actions: [{ type: "SET", target: "M1" }]
          },
          {
            cond: {
              op: "AND",
              a: { var: WT_ADDR.RESET },
              b: {
                op: "AND",
                a: { var: WT_ADDR.ESTOP_HEALTHY },
                b: { op: "NOT", x: { var: "M0" } }
              }
            },
            actions: [{ type: "RESET", target: "M1" }]
          },
          {
            cond: {
              op: "AND",
              a: { var: WT_ADDR.START },
              b: {
                op: "AND",
                a: { var: WT_ADDR.ESTOP_HEALTHY },
                b: {
                  op: "AND",
                  a: { op: "NOT", x: { var: WT_ADDR.LSH_HIGH } },
                  b: { op: "NOT", x: { var: "M1" } }
                }
              }
            },
            actions: [{ type: "SET", target: "M0" }]
          },
          {
            cond: {
              op: "AND",
              a: { var: "M0" },
              b: {
                op: "AND",
                a: { var: WT_ADDR.ESTOP_HEALTHY },
                b: {
                  op: "AND",
                  a: { op: "NOT", x: { var: WT_ADDR.LSH_HIGH } },
                  b: { op: "NOT", x: { var: "M1" } }
                }
              }
            },
            actions: [{ type: "COIL", target: "M0" }]
          },
          {
            cond: { var: "M1" },
            actions: [{ type: "RESET", target: "M0" }]
          },
          {
            cond: { var: "M0" },
            actions: [{ type: "COIL", target: WT_ADDR.VALVE_CMD }]
          },
          {
            cond: {
              op: "AND",
              a: { var: "M0" },
              b: {
                op: "AND",
                a: { var: WT_ADDR.VALVE_OPENED },
                b: {
                  op: "AND",
                  a: { var: WT_ADDR.ESTOP_HEALTHY },
                  b: { op: "NOT", x: { var: WT_ADDR.PUMP_FAULT } }
                }
              }
            },
            actions: [{ type: "COIL", target: WT_ADDR.MOTOR }]
          }
        ]
      }
    ],
    ioMap: {
      "System.Start": WT_ADDR.START,
      "System.Reset": WT_ADDR.RESET,
      "ESTOP101.Healthy": WT_ADDR.ESTOP_HEALTHY,
      "LSH101.High": WT_ADDR.LSH_HIGH,
      "XV101.OpenedFeedback": WT_ADDR.VALVE_OPENED,
      "XV101.OpenCommand": WT_ADDR.VALVE_CMD,
      "M101.Energize": WT_ADDR.MOTOR,
      "P101.RunningFeedback": WT_ADDR.PUMP_RUNNING,
      "P101.Fault": WT_ADDR.PUMP_FAULT,
      "TANK101.LevelPct": WT_ADDR.LEVEL_SRC,
      "TANK102.LevelPct": WT_ADDR.LEVEL_DST,
      "FT101.FlowGpm": WT_ADDR.FLOW,
      "PT101.PressurePsi": WT_ADDR.PRESSURE,
      "LT101.LevelPct": WT_ADDR.LEVEL_LT,
      TransferRequest: "M0",
      TripLatched: "M1"
    },
    metadata: {
      template: "water_transfer",
      description: "Water Transfer System control — model E-stop is simulated only",
      fidelity: WT_FIDELITY,
      supportedActions: ["COIL", "SET", "RESET", "TON"],
      unsupportedConstructs: ["CTU", "CTD", "PID", "ST", "AO_from_ladder"]
    }
  };
}

/**
 * Named process / IO fault scenarios for virtual commissioning.
 * Applied by equipment.step — propagate through real ladder where applicable.
 */
export const WT_PROCESS_FAULTS = Object.freeze({
  sensor_fail: "Stuck destination level transmitter (LT102 holds last value)",
  low_source: "Force source tank to empty / dry-run condition",
  high_dest: "Force destination high-level switch active",
  pump_fault: "Latched pump motor fault (Q2)",
  valve_fail: "Valve fails closed (stuck closed feedback)",
  comm_loss: "Instrument / command path quality bad (no equipment writes)",
  instrument_loss: "Flow + pressure instruments freeze / go bad"
});

export function createWaterTransferEquipment({ plc = null, scanMs = 50 } = {}) {
  const geom = { ...WT_FIDELITY.tankGeom };
  const st = {
    valveOpenAccumMs: 0,
    valveCloseAccumMs: 0,
    motorOnTimer: 0,
    pumpState: "stopped",
    motorState: "deenergized",
    valveState: "closed",
    estopState: "healthy",
    lshState: "normal",
    sourceLevel: WT_FIDELITY.initialSourcePct,
    destLevel: WT_FIDELITY.initialDestPct,
    flowGpm: 0,
    pressurePsi: WT_FIDELITY.pressureIdlePsi,
    lastScan: -1,
    totalTransferredGal: 0,
    lastShutdownReason: null,
    processFaults: Object.create(null),
    /** Freeze values when sensor_fail / instrument_loss */
    frozenDestLevel: null,
    frozenFlow: null,
    frozenPressure: null,
    scanMs,
    geom
  };

  function emit(type, detail = {}) {
    try {
      plc?._emit?.(type, detail);
    } catch (_) {
      /* ignore */
    }
  }

  function read(io, addr) {
    if (addr.startsWith("A")) {
      const f = io.getFault?.(addr);
      if (f && (f.mode === "force" || f.mode === "stuck")) {
        return Number(f.value);
      }
      return Number(io.analogInputs[addr] ?? 0);
    }
    return !!io.effectiveValue(addr);
  }

  function writeQ(io, addr, val) {
    io.ensureOutput(addr);
    const f = io.getFault?.(addr);
    if (f && (f.mode === "force" || f.mode === "stuck")) return;
    if (st.processFaults.comm_loss) return;
    io.outputs[addr] = !!val;
  }

  function writeI(io, addr, val) {
    io.ensureInput(addr);
    const f = io.getFault?.(addr);
    if (f && f.mode === "stuck") return;
    if (st.processFaults.comm_loss) return;
    io.inputs[addr] = !!val;
  }

  function writeA(io, addr, val) {
    io.ensureAnalogInput(addr);
    const f = io.getFault?.(addr);
    if (f && (f.mode === "force" || f.mode === "stuck")) return;
    if (st.processFaults.comm_loss) return;
    io.analogInputs[addr] = Number(val);
  }

  function setProcessFault(name, on = true) {
    const key = String(name || "");
    if (!(key in WT_PROCESS_FAULTS)) {
      throw new Error(`Unknown process fault '${name}'. Known: ${Object.keys(WT_PROCESS_FAULTS).join(", ")}`);
    }
    if (on) {
      st.processFaults[key] = true;
      if (key === "low_source") st.sourceLevel = Math.min(st.sourceLevel, WT_FIDELITY.dryRunLevelPct - 0.5);
      if (key === "high_dest") st.lshState = "high";
      if (key === "sensor_fail") st.frozenDestLevel = st.destLevel;
      if (key === "instrument_loss") {
        st.frozenFlow = st.flowGpm;
        st.frozenPressure = st.pressurePsi;
      }
      if (key === "pump_fault") {
        st.pumpState = "fault";
        st.lastShutdownReason = "PUMP FAULT INJECTED";
      }
      if (key === "valve_fail") {
        st.valveState = "fault";
        st.valveOpenAccumMs = 0;
      }
      emit("fault.process", { name: key, description: WT_PROCESS_FAULTS[key], active: true });
    } else {
      delete st.processFaults[key];
      if (key === "sensor_fail") st.frozenDestLevel = null;
      if (key === "instrument_loss") {
        st.frozenFlow = null;
        st.frozenPressure = null;
      }
      if (key === "valve_fail" && st.valveState === "fault") st.valveState = "closed";
      emit("fault.process", { name: key, description: WT_PROCESS_FAULTS[key], active: false });
    }
    return snapshot();
  }

  function clearProcessFaults() {
    for (const k of Object.keys(st.processFaults)) delete st.processFaults[k];
    st.frozenDestLevel = null;
    st.frozenFlow = null;
    st.frozenPressure = null;
    emit("fault.process_cleared", {});
  }

  function step({ io, scanCount, simTimeMs, scanMs } = {}) {
    if (st.lastScan === scanCount) return;
    st.lastScan = scanCount;
    if (scanMs != null) st.scanMs = Number(scanMs) || st.scanMs;
    const dtMs = Number(st.scanMs) || 50;

    const estopOk = read(io, WT_ADDR.ESTOP_HEALTHY);
    let lshHigh = read(io, WT_ADDR.LSH_HIGH);
    const valveCmd = read(io, WT_ADDR.VALVE_CMD);
    const motorCmd = read(io, WT_ADDR.MOTOR);

    if (st.processFaults.high_dest) {
      lshHigh = true;
      writeI(io, WT_ADDR.LSH_HIGH, true);
    }

    st.estopState = estopOk ? "healthy" : "activated";
    st.lshState = lshHigh ? "high" : "normal";

    // --- Valve dynamics (travel time in sim ms) ---
    const travel = WT_FIDELITY.valveTravelMs;
    if (st.processFaults.valve_fail) {
      st.valveState = "fault";
      st.valveOpenAccumMs = 0;
      writeI(io, WT_ADDR.VALVE_OPENED, false);
    } else if (!estopOk) {
      st.valveState = "closed";
      st.valveOpenAccumMs = 0;
      st.valveCloseAccumMs = 0;
      writeI(io, WT_ADDR.VALVE_OPENED, false);
    } else if (valveCmd) {
      st.valveCloseAccumMs = 0;
      if (st.valveState !== "open") {
        st.valveState = "opening";
        st.valveOpenAccumMs += dtMs;
        if (st.valveOpenAccumMs >= travel) {
          st.valveState = "open";
          writeI(io, WT_ADDR.VALVE_OPENED, true);
          emit("equipment.state", { equipment: "XV101", state: "open" });
        } else {
          writeI(io, WT_ADDR.VALVE_OPENED, false);
        }
      } else {
        writeI(io, WT_ADDR.VALVE_OPENED, true);
      }
    } else {
      st.valveOpenAccumMs = 0;
      if (st.valveState === "open" || st.valveState === "opening") {
        st.valveState = "closing";
        st.valveCloseAccumMs += dtMs;
        if (st.valveCloseAccumMs >= travel) {
          st.valveState = "closed";
          st.valveCloseAccumMs = 0;
          emit("equipment.state", { equipment: "XV101", state: "closed" });
        }
      } else if (st.valveState !== "fault") {
        st.valveState = "closed";
        st.valveCloseAccumMs = 0;
      }
      writeI(io, WT_ADDR.VALVE_OPENED, false);
    }

    const pathOpen = st.valveState === "open" && !st.processFaults.valve_fail;
    let pumpFault = !!st.processFaults.pump_fault || !!read(io, WT_ADDR.PUMP_FAULT);

    // --- Motor / pump + mass balance ---
    if (!estopOk) {
      st.motorState = "deenergized";
      st.pumpState = "safe";
      st.motorOnTimer = 0;
      st.flowGpm = 0;
      st.pressurePsi = WT_FIDELITY.pressureIdlePsi;
      st.lastShutdownReason = "E-STOP ACTIVE (sim)";
      writeQ(io, WT_ADDR.MOTOR, false);
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
      writeQ(io, WT_ADDR.PUMP_FAULT, false);
      writeQ(io, WT_ADDR.VALVE_CMD, false);
      emit("process.shutdown", { reason: st.lastShutdownReason, simTimeMs });
    } else if (pumpFault) {
      st.motorState = "fault";
      st.pumpState = "fault";
      st.motorOnTimer = 0;
      st.flowGpm = 0;
      st.pressurePsi = WT_FIDELITY.pressureIdlePsi;
      st.lastShutdownReason = st.lastShutdownReason || "PUMP FAULT";
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
      writeQ(io, WT_ADDR.PUMP_FAULT, true);
    } else if (motorCmd && pathOpen) {
      // Dry-run / low source
      if (st.sourceLevel <= WT_FIDELITY.dryRunLevelPct || st.processFaults.low_source) {
        st.motorState = "deenergized";
        st.pumpState = "fault";
        st.flowGpm = 0;
        st.pressurePsi = WT_FIDELITY.pressureIdlePsi;
        st.lastShutdownReason = "DRY-RUN / LOW SOURCE LEVEL — PUMP SHUTDOWN";
        writeQ(io, WT_ADDR.PUMP_RUNNING, false);
        writeQ(io, WT_ADDR.PUMP_FAULT, true);
        emit("process.shutdown", { reason: st.lastShutdownReason, sourceLevel: st.sourceLevel });
      } else if (lshHigh) {
        st.motorState = "deenergized";
        st.pumpState = "stopped";
        st.flowGpm = 0;
        st.pressurePsi = WT_FIDELITY.pressureIdlePsi;
        st.lastShutdownReason = "DESTINATION LEVEL HIGH";
        writeQ(io, WT_ADDR.PUMP_RUNNING, false);
      } else {
        st.motorState = "energized";
        st.motorOnTimer += 1;
        st.pumpState = "running";
        writeQ(io, WT_ADDR.PUMP_RUNNING, true);
        writeQ(io, WT_ADDR.PUMP_FAULT, false);

        const rated = WT_FIDELITY.pumpRatedGpm;
        // Mild head effect: reduce flow as dest fills / source empties (not full hydraulics)
        const headFactor = 0.85 + 0.15 * (st.sourceLevel / 100) * (1 - st.destLevel / 100);
        const commandedFlow = rated * headFactor;
        const dtMin = dtMs / 60000;

        const before = { s: st.sourceLevel, d: st.destLevel };
        const xfer = transferBetweenTanks({
          sourceLevelPct: st.sourceLevel,
          destLevelPct: st.destLevel,
          flowGpm: commandedFlow,
          scanMs: dtMs,
          sourceGeom: geom,
          destGeom: geom
        });
        st.sourceLevel = xfer.sourceLevelPct;
        st.destLevel = xfer.destLevelPct;
        st.flowGpm =
          xfer.transferredGal > 0 && dtMin > 0
            ? Math.min(rated, xfer.transferredGal / dtMin)
            : 0;
        st.pressurePsi =
          st.flowGpm > 0
            ? WT_FIDELITY.pressureIdlePsi +
              (st.flowGpm / rated) * (WT_FIDELITY.pressureRunningPsi - WT_FIDELITY.pressureIdlePsi)
            : WT_FIDELITY.pressureIdlePsi;
        st.totalTransferredGal += xfer.transferredGal;
        st.lastShutdownReason = null;

        // Auto dest high switch from process
        if (st.destLevel >= WT_FIDELITY.destHighPct && !st.processFaults.sensor_fail) {
          writeI(io, WT_ADDR.LSH_HIGH, true);
          st.lshState = "high";
        }

        const bal = checkMassBalance({
          sourceBeforePct: before.s,
          destBeforePct: before.d,
          sourceAfterPct: st.sourceLevel,
          destAfterPct: st.destLevel,
          sourceGeom: geom,
          destGeom: geom
        });
        if (!bal.ok) {
          emit("process.mass_balance_warn", bal);
        }
      }
    } else {
      // Blocked path or no motor command — levels hold; flow decays to 0
      st.motorState = "deenergized";
      st.motorOnTimer = 0;
      if (st.pumpState !== "fault" && st.pumpState !== "safe") st.pumpState = "stopped";
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
      st.flowGpm = 0;
      st.pressurePsi = WT_FIDELITY.pressureIdlePsi;
      if (motorCmd && !pathOpen) {
        st.lastShutdownReason = "NO VALID FLOW PATH — VALVE NOT OPEN";
      }
    }

    // Publish analogs (respect freeze / faults)
    const pubSrc = st.sourceLevel;
    const pubDst = st.processFaults.sensor_fail && st.frozenDestLevel != null ? st.frozenDestLevel : st.destLevel;
    const pubFlow =
      st.processFaults.instrument_loss && st.frozenFlow != null ? st.frozenFlow : st.flowGpm;
    const pubPress =
      st.processFaults.instrument_loss && st.frozenPressure != null
        ? st.frozenPressure
        : st.pressurePsi;

    writeA(io, WT_ADDR.LEVEL_SRC, pubSrc);
    writeA(io, WT_ADDR.LEVEL_DST, pubDst);
    writeA(io, WT_ADDR.LEVEL_LT, pubSrc);
    writeA(io, WT_ADDR.FLOW, pubFlow);
    writeA(io, WT_ADDR.PRESSURE, pubPress);

    if (lshHigh && st.pumpState === "running") {
      st.pumpState = "stopped";
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
      st.flowGpm = 0;
    }
  }

  function reset() {
    st.valveOpenAccumMs = 0;
    st.valveCloseAccumMs = 0;
    st.motorOnTimer = 0;
    st.pumpState = "stopped";
    st.motorState = "deenergized";
    st.valveState = "closed";
    st.estopState = "healthy";
    st.lshState = "normal";
    st.sourceLevel = WT_FIDELITY.initialSourcePct;
    st.destLevel = WT_FIDELITY.initialDestPct;
    st.flowGpm = 0;
    st.pressurePsi = WT_FIDELITY.pressureIdlePsi;
    st.lastScan = -1;
    st.totalTransferredGal = 0;
    st.lastShutdownReason = null;
    clearProcessFaults();
  }

  function snapshot() {
    return {
      ...st,
      processFaults: { ...st.processFaults },
      fidelity: WT_FIDELITY,
      capacityGal: tankCapacityGal(geom)
    };
  }

  return {
    step,
    reset,
    snapshot,
    setProcessFault,
    clearProcessFaults,
    name: "WaterTransferEquipment",
    fidelity: WT_FIDELITY
  };
}

/**
 * Attach Water Transfer IR + equipment to a VirtualPLC instance.
 */
export function attachWaterTransfer(plc, io) {
  const equipment = createWaterTransferEquipment({ plc, scanMs: plc.scanMs || 50 });
  const ir = createWaterTransferLadderIR();
  plc.setProgramIR(ir);
  plc._waterTransferEquipment = equipment;

  io.setStrict(false);
  io.ensureInput(WT_ADDR.ESTOP_HEALTHY);
  io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
  io.ensureInput(WT_ADDR.LSH_HIGH);
  io.inputs[WT_ADDR.LSH_HIGH] = false;
  io.ensureInput(WT_ADDR.START);
  io.inputs[WT_ADDR.START] = false;
  io.ensureInput(WT_ADDR.RESET);
  io.inputs[WT_ADDR.RESET] = false;
  io.ensureInput(WT_ADDR.VALVE_OPENED);
  io.inputs[WT_ADDR.VALVE_OPENED] = false;
  io.ensureInput(WT_ADDR.RUN_CMD);
  io.inputs[WT_ADDR.RUN_CMD] = false;

  for (const a of [
    WT_ADDR.LEVEL_SRC,
    WT_ADDR.LEVEL_DST,
    WT_ADDR.FLOW,
    WT_ADDR.PRESSURE,
    WT_ADDR.LEVEL_LT
  ]) {
    io.ensureAnalogInput(a);
  }
  io.analogInputs[WT_ADDR.LEVEL_SRC] = WT_FIDELITY.initialSourcePct;
  io.analogInputs[WT_ADDR.LEVEL_DST] = WT_FIDELITY.initialDestPct;
  io.analogInputs[WT_ADDR.LEVEL_LT] = WT_FIDELITY.initialSourcePct;
  io.analogInputs[WT_ADDR.PRESSURE] = WT_FIDELITY.pressureIdlePsi;
  io.analogInputs[WT_ADDR.FLOW] = 0;

  for (const q of [WT_ADDR.MOTOR, WT_ADDR.PUMP_RUNNING, WT_ADDR.PUMP_FAULT, WT_ADDR.VALVE_CMD]) {
    io.ensureOutput(q);
    io.outputs[q] = false;
  }
  io.ensureMem("M0");
  io.ensureMem("M1");
  io.mem.M0 = false;
  io.mem.M1 = false;

  const prevEquip = plc.equipmentStep;
  plc.equipmentStep = async (ctx) => {
    if (typeof prevEquip === "function") await prevEquip(ctx);
    equipment.step(ctx);
  };

  const prevReset = plc.onReset;
  plc.onReset = () => {
    equipment.reset();
    io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
    io.inputs[WT_ADDR.LSH_HIGH] = false;
    io.inputs[WT_ADDR.START] = false;
    io.inputs[WT_ADDR.RESET] = false;
    io.inputs[WT_ADDR.VALVE_OPENED] = false;
    io.inputs[WT_ADDR.RUN_CMD] = false;
    io.analogInputs[WT_ADDR.LEVEL_SRC] = WT_FIDELITY.initialSourcePct;
    io.analogInputs[WT_ADDR.LEVEL_DST] = WT_FIDELITY.initialDestPct;
    io.analogInputs[WT_ADDR.LEVEL_LT] = WT_FIDELITY.initialSourcePct;
    io.analogInputs[WT_ADDR.PRESSURE] = WT_FIDELITY.pressureIdlePsi;
    io.analogInputs[WT_ADDR.FLOW] = 0;
    io.mem.M0 = false;
    io.mem.M1 = false;
    for (const q of [WT_ADDR.MOTOR, WT_ADDR.PUMP_RUNNING, WT_ADDR.PUMP_FAULT, WT_ADDR.VALVE_CMD]) {
      io.outputs[q] = false;
    }
    if (typeof prevReset === "function") prevReset();
  };

  plc._emit?.("water_transfer.attached", { fidelity: WT_FIDELITY });
  return { equipment, ir };
}
