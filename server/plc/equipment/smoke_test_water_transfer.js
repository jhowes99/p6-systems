/**
 * Phase 4/5 acceptance — Water Transfer System + virtual commissioning physics
 * node server/plc/equipment/smoke_test_water_transfer.js
 */

import { IOModel } from "../io.js";
import { VirtualPLC } from "../runtime.js";
import {
  attachWaterTransfer,
  WT_ADDR,
  WT_FIDELITY
} from "./water_transfer.js";
import { checkMassBalance } from "./process_physics.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const io = new IOModel();
const plc = new VirtualPLC({ io, scanMs: 50 });
const { equipment } = attachWaterTransfer(plc, io);
plc.pause();
plc.reset({ clearInputs: true });

io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
io.inputs[WT_ADDR.LSH_HIGH] = false;

async function steps(n) {
  for (let i = 0; i < n; i++) await plc.step();
}

// 1. Initializes stopped
assert(!io.outputs[WT_ADDR.MOTOR], "motor off at init");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump off at init");
assert(!io.mem.M0, "no transfer request");
assert(Number(io.analogInputs[WT_ADDR.LEVEL_SRC]) === WT_FIDELITY.initialSourcePct, "source init");
assert(Number(io.analogInputs[WT_ADDR.LEVEL_DST]) === WT_FIDELITY.initialDestPct, "dest init");

// 2-6. Start → permissives → valve → motor → pump
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false; // pulse
await steps(5); // valve open delay + motor/pump
assert(!!io.mem.M0, "transfer request latched");
assert(!!io.outputs[WT_ADDR.VALVE_CMD], "valve commanded");
assert(!!io.inputs[WT_ADDR.VALVE_OPENED], "valve opened feedback");
assert(!!io.outputs[WT_ADDR.MOTOR], "motor energized");
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "pump running");
assert(Number(io.analogInputs[WT_ADDR.FLOW]) > 0, "flow reflects transfer");
assert(Number(io.analogInputs[WT_ADDR.PRESSURE]) > WT_FIDELITY.pressureIdlePsi, "PT rises when pumping");

const src0 = Number(io.analogInputs[WT_ADDR.LEVEL_SRC]);
const dst0 = Number(io.analogInputs[WT_ADDR.LEVEL_DST]);
await steps(20);
const src1 = Number(io.analogInputs[WT_ADDR.LEVEL_SRC]);
const dst1 = Number(io.analogInputs[WT_ADDR.LEVEL_DST]);
assert(src1 < src0 - 0.05, `source fell: ${src0} → ${src1}`);
assert(dst1 > dst0 + 0.05, `dest rose: ${dst0} → ${dst1}`);

const bal = checkMassBalance({
  sourceBeforePct: src0,
  destBeforePct: dst0,
  sourceAfterPct: src1,
  destAfterPct: dst1,
  sourceGeom: WT_FIDELITY.tankGeom,
  destGeom: WT_FIDELITY.tankGeom
});
assert(bal.ok, `mass balance residual=${bal.residualGal}`);

// Blocked path: close valve → flow stops, levels hold
io.mem.M0 = false; // drop request (simulate stop)
await steps(4);
assert(!io.inputs[WT_ADDR.VALVE_OPENED], "valve closed after request drop");
assert(Number(io.analogInputs[WT_ADDR.FLOW]) === 0, "no flow when path blocked");
const holdSrc = Number(io.analogInputs[WT_ADDR.LEVEL_SRC]);
const holdDst = Number(io.analogInputs[WT_ADDR.LEVEL_DST]);
await steps(6);
assert(Math.abs(Number(io.analogInputs[WT_ADDR.LEVEL_SRC]) - holdSrc) < 0.05, "source holds");
assert(Math.abs(Number(io.analogInputs[WT_ADDR.LEVEL_DST]) - holdDst) < 0.05, "dest holds");

// Restart for LSH test
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(5);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "running again");

// 7. LSH inhibits
io.inputs[WT_ADDR.LSH_HIGH] = true;
await steps(3);
assert(!!io.mem.M1, "trip latched on LSH");
assert(!io.mem.M0, "request dropped");
assert(!io.outputs[WT_ADDR.MOTOR], "motor off on LSH");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump off on LSH");

io.inputs[WT_ADDR.LSH_HIGH] = false;
io.inputs[WT_ADDR.START] = true;
await steps(2);
io.inputs[WT_ADDR.START] = false;
assert(!io.mem.M0, "cannot restart while trip latched");
io.inputs[WT_ADDR.RESET] = true;
await steps(2);
io.inputs[WT_ADDR.RESET] = false;
assert(!io.mem.M1, "trip cleared after reset");

io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(5);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "pump running after reset+start");

// 8. E-stop shutdown
io.inputs[WT_ADDR.ESTOP_HEALTHY] = false;
await steps(3);
assert(!io.outputs[WT_ADDR.MOTOR], "E-stop de-energizes motor");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump not running / safe");
assert(!!io.mem.M1, "trip latched on E-stop");
assert(!io.mem.M0, "auto restart inhibited");

io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
io.inputs[WT_ADDR.START] = true;
await steps(3);
io.inputs[WT_ADDR.START] = false;
assert(!io.outputs[WT_ADDR.MOTOR], "restart blocked until reset");

io.inputs[WT_ADDR.RESET] = true;
await steps(2);
io.inputs[WT_ADDR.RESET] = false;
assert(!io.mem.M1, "trip cleared");
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(5);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "running after E-stop reset sequence");

// 9. Dry-run / low source → pump shutdown with reason
equipment.setProcessFault("low_source", true);
await steps(4);
assert(!!io.outputs[WT_ADDR.PUMP_FAULT], "dry-run sets pump fault");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump stopped on dry-run");
const snap = equipment.snapshot();
assert(
  /DRY-RUN|LOW SOURCE/i.test(snap.lastShutdownReason || ""),
  `shutdown reason: ${snap.lastShutdownReason}`
);
equipment.setProcessFault("low_source", false);
plc.reset({ clearInputs: true, clearFaults: true });
io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;

// 10. Fault injection: valve_fail blocks path
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(5);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "baseline running before valve fault");
equipment.setProcessFault("valve_fail", true);
await steps(4);
assert(!io.inputs[WT_ADDR.VALVE_OPENED], "valve fail → no open feedback");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump stops without path");
equipment.clearProcessFaults();
plc.reset({ clearInputs: true, clearFaults: true });
io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;

// 11. Sim clock vs equipment: pause does not advance; step advances
plc.pause();
const t0 = plc.clock.timeMs;
await new Promise((r) => setTimeout(r, 80));
assert(plc.clock.timeMs === t0, "pause: sim time frozen");
await plc.step();
assert(plc.clock.timeMs === t0 + 50, "step advances one scan");

// 12. Save/reload-ish: reset restores consistent initials
plc.reset({ clearInputs: true, clearFaults: true });
assert(Number(io.analogInputs[WT_ADDR.LEVEL_SRC]) === WT_FIDELITY.initialSourcePct, "reset source");
assert(Number(io.analogInputs[WT_ADDR.LEVEL_DST]) === WT_FIDELITY.initialDestPct, "reset dest");
assert(plc.clock.timeMs === 0, "reset sim time");

// Acceptance repeatability: start → levels change → reset → start again
io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(8);
const aSrc = Number(io.analogInputs[WT_ADDR.LEVEL_SRC]);
assert(aSrc < WT_FIDELITY.initialSourcePct, "acceptance levels change");
plc.reset({ clearInputs: true, clearFaults: true });
io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(8);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "acceptance repeat running");
assert(Number(io.analogInputs[WT_ADDR.LEVEL_SRC]) < WT_FIDELITY.initialSourcePct, "acceptance repeat levels");

console.log("Phase 5 smoke_test_water_transfer: PASS");
console.log(
  JSON.stringify({
    initStopped: true,
    startSequence: true,
    massBalance: bal.ok,
    levelTransfer: true,
    blockedPathHolds: true,
    lshInhibit: true,
    estopShutdown: true,
    dryRunShutdown: true,
    valveFail: true,
    simClockPause: true,
    resetConsistent: true,
    acceptanceRepeat: true,
    residualGal: bal.residualGal
  })
);
