/**
 * Master Spec §14 / §40 — Two-tank transfer equipment + ladder IR.
 * Path: TANK-101 → PUMP-101 → VALVE-101 → TANK-102
 * Simulated ESD demonstrates model behavior only — NOT a certified safety function.
 *
 *   I0 PUMP-101.RunCommand | I4 System.Start | I5 System.Reset
 *   I3 ESD-101.Healthy | I2 LT-101.High
 *   I7 VALVE-101.OpenCommand | I1 VALVE-101.OpenedFeedback
 *   Q0 M-101.Energize | Q1 PUMP-101.RunningFeedback | Q2 PUMP-101.Fault
 *   A0 TANK-101.LevelPct | A1 TANK-102 / LT-101.LevelPct | A3 FIT-101.FlowGpm
 */

export const TT_ADDR = Object.freeze({
  RUN_CMD: "I0",
  VALVE_OPENED: "I1",
  LSH_HIGH: "I2",
  ESD_HEALTHY: "I3",
  START: "I4",
  RESET: "I5",
  VALVE_CMD: "I7",
  MOTOR: "Q0",
  PUMP_RUNNING: "Q1",
  PUMP_FAULT: "Q2",
  LT101: "A0",
  LT102: "A1",
  FIT101: "A3"
});

export function createTankTransferLadderIR() {
  return {
    language: "ladder",
    networks: [
      {
        rungs: [
          {
            cond: {
              op: "OR",
              a: { op: "NOT", x: { var: TT_ADDR.ESD_HEALTHY } },
              b: {
                op: "AND",
                a: { var: "M0" },
                b: { var: TT_ADDR.LSH_HIGH }
              }
            },
            actions: [{ type: "SET", target: "M1" }]
          },
          {
            cond: {
              op: "AND",
              a: { var: TT_ADDR.RESET },
              b: {
                op: "AND",
                a: { var: TT_ADDR.ESD_HEALTHY },
                b: { op: "NOT", x: { var: "M0" } }
              }
            },
            actions: [{ type: "RESET", target: "M1" }]
          },
          {
            cond: {
              op: "AND",
              a: {
                op: "OR",
                a: { var: TT_ADDR.START },
                b: { var: TT_ADDR.RUN_CMD }
              },
              b: {
                op: "AND",
                a: { var: TT_ADDR.ESD_HEALTHY },
                b: {
                  op: "AND",
                  a: { var: TT_ADDR.VALVE_OPENED },
                  b: {
                    op: "AND",
                    a: { op: "NOT", x: { var: TT_ADDR.LSH_HIGH } },
                    b: { op: "NOT", x: { var: "M1" } }
                  }
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
                a: { var: TT_ADDR.ESD_HEALTHY },
                b: {
                  op: "AND",
                  a: { var: TT_ADDR.VALVE_OPENED },
                  b: {
                    op: "AND",
                    a: { op: "NOT", x: { var: TT_ADDR.LSH_HIGH } },
                    b: { op: "NOT", x: { var: "M1" } }
                  }
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
            cond: {
              op: "AND",
              a: { var: "M0" },
              b: {
                op: "AND",
                a: { var: TT_ADDR.VALVE_OPENED },
                b: { var: TT_ADDR.ESD_HEALTHY }
              }
            },
            actions: [{ type: "COIL", target: TT_ADDR.MOTOR }]
          }
        ]
      }
    ],
    ioMap: {
      "System.Start": TT_ADDR.START,
      "System.Reset": TT_ADDR.RESET,
      "ESD-101.Healthy": TT_ADDR.ESD_HEALTHY,
      "LT-101.High": TT_ADDR.LSH_HIGH,
      "VALVE-101.OpenedFeedback": TT_ADDR.VALVE_OPENED,
      "VALVE-101.OpenCommand": TT_ADDR.VALVE_CMD,
      "PUMP-101.RunCommand": TT_ADDR.RUN_CMD,
      "M-101.Energize": TT_ADDR.MOTOR,
      "PUMP-101.RunningFeedback": TT_ADDR.PUMP_RUNNING,
      "PUMP-101.Fault": TT_ADDR.PUMP_FAULT,
      TransferRequest: "M0",
      TripLatched: "M1"
    },
    metadata: {
      template: "tank_transfer",
      masterSpecSection: 40,
      description: "Two-tank transfer — model E-stop is simulated only"
    }
  };
}

export function createTankTransferEquipment() {
  const st = {
    valveOpenTimer: 0,
    valveCloseTimer: 0,
    motorOnTimer: 0,
    pumpState: "stopped",
    motorState: "deenergized",
    valveState: "closed",
    esdState: "healthy",
    lt101: 70,
    lt102: 25,
    flow: 0,
    lastScan: -1
  };

  function read(io, addr) {
    if (addr.startsWith("A")) return Number(io.analogInputs[addr] ?? 0);
    return !!io.effectiveValue(addr);
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
    io.inputs[addr] = !!val;
  }

  function writeA(io, addr, val) {
    io.ensureAnalogInput(addr);
    io.analogInputs[addr] = Number(val);
  }

  function step({ io, scanCount }) {
    if (st.lastScan === scanCount) return;
    st.lastScan = scanCount;

    const esdOk = read(io, TT_ADDR.ESD_HEALTHY);
    let valveCmd = read(io, TT_ADDR.VALVE_CMD);
    const motorCmd = read(io, TT_ADDR.MOTOR);
    st.esdState = esdOk ? "healthy" : "activated";

    if (!esdOk) {
      valveCmd = false;
      st.valveState = "closed";
      st.valveOpenTimer = 0;
      writeI(io, TT_ADDR.VALVE_OPENED, false);
      st.motorState = "deenergized";
      st.pumpState = "safe";
      st.motorOnTimer = 0;
      st.flow = 0;
      writeQ(io, TT_ADDR.MOTOR, false);
      writeQ(io, TT_ADDR.PUMP_RUNNING, false);
      writeQ(io, TT_ADDR.PUMP_FAULT, false);
    } else if (valveCmd) {
      st.valveCloseTimer = 0;
      if (st.valveState !== "open") {
        st.valveState = "opening";
        st.valveOpenTimer += 1;
        if (st.valveOpenTimer >= 2) {
          st.valveState = "open";
          writeI(io, TT_ADDR.VALVE_OPENED, true);
        } else writeI(io, TT_ADDR.VALVE_OPENED, false);
      } else writeI(io, TT_ADDR.VALVE_OPENED, true);
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
      writeI(io, TT_ADDR.VALVE_OPENED, false);
    }

    if (esdOk) {
      const pathOpen = st.valveState === "open";
      if (motorCmd && pathOpen) {
        st.motorState = "energized";
        st.motorOnTimer += 1;
        if (st.motorOnTimer >= 1) {
          st.pumpState = "running";
          writeQ(io, TT_ADDR.PUMP_RUNNING, true);
        }
        writeQ(io, TT_ADDR.PUMP_FAULT, false);
        const rate = 0.4;
        if (st.lt101 > 0.5 && st.lt102 < 99.5) {
          st.lt101 = Math.max(0, st.lt101 - rate);
          st.lt102 = Math.min(100, st.lt102 + rate);
          st.flow = 40 + (st.lt101 / 100) * 10;
        } else {
          st.flow = Math.max(0, st.flow * 0.5);
        }
      } else {
        st.motorState = "deenergized";
        st.motorOnTimer = 0;
        st.pumpState = "stopped";
        writeQ(io, TT_ADDR.PUMP_RUNNING, false);
        st.flow = Math.max(0, st.flow * 0.3);
      }
    }

    if (st.lt102 >= 95) writeI(io, TT_ADDR.LSH_HIGH, true);

    if (read(io, TT_ADDR.LSH_HIGH) && st.pumpState === "running") {
      st.pumpState = "stopped";
      writeQ(io, TT_ADDR.PUMP_RUNNING, false);
      st.flow = 0;
    }

    writeA(io, TT_ADDR.LT101, st.lt101);
    writeA(io, TT_ADDR.LT102, st.lt102);
    writeA(io, TT_ADDR.FIT101, st.flow);
  }

  function reset() {
    st.valveOpenTimer = 0;
    st.valveCloseTimer = 0;
    st.motorOnTimer = 0;
    st.pumpState = "stopped";
    st.motorState = "deenergized";
    st.valveState = "closed";
    st.esdState = "healthy";
    st.lt101 = 70;
    st.lt102 = 25;
    st.flow = 0;
    st.lastScan = -1;
  }

  function snapshot() {
    return { ...st };
  }

  return { step, reset, snapshot, name: "TankTransferEquipment" };
}

export function attachTankTransfer(plc, io) {
  const equipment = createTankTransferEquipment();
  const ir = createTankTransferLadderIR();
  plc.setProgramIR(ir);

  io.setStrict(false);
  for (const addr of [
    TT_ADDR.ESD_HEALTHY,
    TT_ADDR.LSH_HIGH,
    TT_ADDR.START,
    TT_ADDR.RESET,
    TT_ADDR.RUN_CMD,
    TT_ADDR.VALVE_OPENED,
    TT_ADDR.VALVE_CMD
  ]) {
    io.ensureInput(addr);
  }
  io.inputs[TT_ADDR.ESD_HEALTHY] = true;
  io.inputs[TT_ADDR.LSH_HIGH] = false;
  io.inputs[TT_ADDR.START] = false;
  io.inputs[TT_ADDR.RESET] = false;
  io.inputs[TT_ADDR.RUN_CMD] = false;
  io.inputs[TT_ADDR.VALVE_OPENED] = false;
  io.inputs[TT_ADDR.VALVE_CMD] = false;

  for (const a of [TT_ADDR.LT101, TT_ADDR.LT102, TT_ADDR.FIT101]) io.ensureAnalogInput(a);
  io.analogInputs[TT_ADDR.LT101] = 70;
  io.analogInputs[TT_ADDR.LT102] = 25;
  io.analogInputs[TT_ADDR.FIT101] = 0;

  for (const q of [TT_ADDR.MOTOR, TT_ADDR.PUMP_RUNNING, TT_ADDR.PUMP_FAULT]) {
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
    io.inputs[TT_ADDR.ESD_HEALTHY] = true;
    io.inputs[TT_ADDR.LSH_HIGH] = false;
    io.inputs[TT_ADDR.START] = false;
    io.inputs[TT_ADDR.RESET] = false;
    io.inputs[TT_ADDR.RUN_CMD] = false;
    io.inputs[TT_ADDR.VALVE_OPENED] = false;
    io.inputs[TT_ADDR.VALVE_CMD] = false;
    io.analogInputs[TT_ADDR.LT101] = 70;
    io.analogInputs[TT_ADDR.LT102] = 25;
    io.analogInputs[TT_ADDR.FIT101] = 0;
    io.mem.M0 = false;
    io.mem.M1 = false;
    for (const q of [TT_ADDR.MOTOR, TT_ADDR.PUMP_RUNNING, TT_ADDR.PUMP_FAULT]) io.outputs[q] = false;
    if (typeof prevReset === "function") prevReset();
  };

  plc._emit?.("tank_transfer.attached", {});
  return { equipment, ir };
}
