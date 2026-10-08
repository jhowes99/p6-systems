/**
 * Water Transfer System — reference control + equipment simulation (Spec §15).
 *
 * Simulated E-stop demonstrates model behavior only — NOT a certified safety function.
 *
 * Address map (matches seed_water_transfer.js):
 *   I4 System.Start | I5 System.Reset | I3 ESTOP101.Healthy | I2 LSH101.High
 *   I1 XV101.OpenedFeedback (equipment-written)
 *   Q3 XV101.OpenCommand | Q0 M101.Energize | Q1 P101.RunningFeedback | Q2 P101.Fault
 *   A0 TANK101.LevelPct
 */

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
  LEVEL: "A0"
});

/**
 * Ladder IR — seal-in transfer request with E-stop + LSH permissives + trip latch (M1).
 * Equipment simulation completes the plant feedback loop.
 */
export function createWaterTransferLadderIR() {
  return {
    language: "ladder",
    networks: [
      {
        rungs: [
          // Trip latch SET when E-stop drops or LSH while request active
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
          // Reset clears trip when E-stop healthy and not running
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
          // Start seal-in → M0 (transfer request)
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
          // Seal-in hold M0
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
          // Drop M0 on trip
          {
            cond: { var: "M1" },
            actions: [{ type: "RESET", target: "M0" }]
          },
          // Valve open command when transfer requested
          {
            cond: { var: "M0" },
            actions: [{ type: "COIL", target: WT_ADDR.VALVE_CMD }]
          },
          // Motor when request + valve opened feedback + E-stop
          {
            cond: {
              op: "AND",
              a: { var: "M0" },
              b: {
                op: "AND",
                a: { var: WT_ADDR.VALVE_OPENED },
                b: { var: WT_ADDR.ESTOP_HEALTHY }
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
      "TransferRequest": "M0",
      "TripLatched": "M1"
    },
    metadata: {
      template: "water_transfer",
      description: "Water Transfer System control — model E-stop is simulated only"
    }
  };
}

export function createWaterTransferEquipment() {
  const st = {
    valveOpenTimer: 0,
    valveCloseTimer: 0,
    motorOnTimer: 0,
    pumpState: "stopped",
    motorState: "deenergized",
    valveState: "closed",
    estopState: "healthy",
    lshState: "normal",
    tankLevel: 50,
    lastScan: -1
  };

  function read(io, addr) {
    if (addr.startsWith("I")) return !!io.effectiveValue(addr);
    if (addr.startsWith("Q")) return !!io.effectiveValue(addr);
    if (addr.startsWith("M")) return !!io.effectiveValue(addr);
    if (addr.startsWith("A")) return Number(io.analogInputs[addr] ?? 0);
    return false;
  }

  function writeQ(io, addr, val) {
    io.ensureOutput(addr);
    const f = io.getFault?.(addr);
    if (f && (f.mode === "force" || f.mode === "stuck")) return;
    io.outputs[addr] = !!val;
  }

  function writeI(io, addr, val) {
    io.ensureInput(addr);
    const f = io.getFault?.(addr);
    if (f && f.mode === "stuck") return;
    // Don't fight stuck; allow normal writes for equipment feedback
    io.inputs[addr] = !!val;
  }

  function step({ io, scanCount }) {
    if (st.lastScan === scanCount) return;
    st.lastScan = scanCount;

    const estopOk = read(io, WT_ADDR.ESTOP_HEALTHY);
    const lshHigh = read(io, WT_ADDR.LSH_HIGH);
    const valveCmd = read(io, WT_ADDR.VALVE_CMD);
    const motorCmd = read(io, WT_ADDR.MOTOR);

    st.estopState = estopOk ? "healthy" : "activated";
    st.lshState = lshHigh ? "high" : "normal";

    // --- Valve dynamics ---
    if (!estopOk) {
      // Safe state: force valve closed feedback path
      st.valveState = "closed";
      st.valveOpenTimer = 0;
      writeI(io, WT_ADDR.VALVE_OPENED, false);
    } else if (valveCmd) {
      if (st.valveState !== "open") {
        st.valveState = "opening";
        st.valveOpenTimer += 1;
        if (st.valveOpenTimer >= 2) {
          st.valveState = "open";
          writeI(io, WT_ADDR.VALVE_OPENED, true);
        } else {
          writeI(io, WT_ADDR.VALVE_OPENED, false);
        }
      } else {
        writeI(io, WT_ADDR.VALVE_OPENED, true);
      }
    } else {
      st.valveOpenTimer = 0;
      if (st.valveState === "open" || st.valveState === "opening") {
        st.valveState = "closing";
        st.valveCloseTimer += 1;
        if (st.valveCloseTimer >= 2) {
          st.valveState = "closed";
          st.valveCloseTimer = 0;
        }
      } else {
        st.valveState = "closed";
        st.valveCloseTimer = 0;
      }
      writeI(io, WT_ADDR.VALVE_OPENED, false);
    }

    // --- Motor / pump ---
    if (!estopOk) {
      st.motorState = "deenergized";
      st.pumpState = "safe";
      st.motorOnTimer = 0;
      writeQ(io, WT_ADDR.MOTOR, false); // equipment enforces de-energize on E-stop
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
      writeQ(io, WT_ADDR.PUMP_FAULT, false);
      writeQ(io, WT_ADDR.VALVE_CMD, false);
    } else if (motorCmd && st.valveState === "open") {
      st.motorState = "energized";
      st.motorOnTimer += 1;
      if (st.motorOnTimer >= 1) {
        st.pumpState = "running";
        writeQ(io, WT_ADDR.PUMP_RUNNING, true);
      }
      writeQ(io, WT_ADDR.PUMP_FAULT, false);
      // Gentle level change while pumping
      st.tankLevel = Math.max(0, Math.min(100, st.tankLevel + 0.05));
      io.ensureAnalogInput(WT_ADDR.LEVEL);
      io.analogInputs[WT_ADDR.LEVEL] = st.tankLevel;
    } else {
      st.motorState = "deenergized";
      st.motorOnTimer = 0;
      st.pumpState = st.pumpState === "safe" ? "stopped" : "stopped";
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
    }

    // LSH inhibit reflected in pump (logic drops M0); keep fault clear unless needed
    if (lshHigh && st.pumpState === "running") {
      st.pumpState = "stopped";
      writeQ(io, WT_ADDR.PUMP_RUNNING, false);
    }
  }

  function reset() {
    st.valveOpenTimer = 0;
    st.valveCloseTimer = 0;
    st.motorOnTimer = 0;
    st.pumpState = "stopped";
    st.motorState = "deenergized";
    st.valveState = "closed";
    st.estopState = "healthy";
    st.lshState = "normal";
    st.tankLevel = 50;
    st.lastScan = -1;
  }

  function snapshot() {
    return { ...st };
  }

  return { step, reset, snapshot, name: "WaterTransferEquipment" };
}

/**
 * Attach Water Transfer IR + equipment to a VirtualPLC instance.
 */
export function attachWaterTransfer(plc, io) {
  const equipment = createWaterTransferEquipment();
  const ir = createWaterTransferLadderIR();
  plc.setProgramIR(ir);

  // Seed defaults: E-stop healthy, level mid, all stopped
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
  io.ensureAnalogInput(WT_ADDR.LEVEL);
  io.analogInputs[WT_ADDR.LEVEL] = 50;
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
    io.analogInputs[WT_ADDR.LEVEL] = 50;
    io.mem.M0 = false;
    io.mem.M1 = false;
    for (const q of [WT_ADDR.MOTOR, WT_ADDR.PUMP_RUNNING, WT_ADDR.PUMP_FAULT, WT_ADDR.VALVE_CMD]) {
      io.outputs[q] = false;
    }
    if (typeof prevReset === "function") prevReset();
  };

  plc._emit?.("water_transfer.attached", {});
  return { equipment, ir };
}
