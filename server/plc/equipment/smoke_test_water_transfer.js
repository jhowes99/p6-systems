/**
 * Phase 4 acceptance — Water Transfer System
 * node server/plc/equipment/smoke_test_water_transfer.js
 */

import { IOModel } from "../io.js";
import { VirtualPLC } from "../runtime.js";
import { attachWaterTransfer, WT_ADDR } from "./water_transfer.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const io = new IOModel();
const plc = new VirtualPLC({ io, scanMs: 50 });
attachWaterTransfer(plc, io);
plc.pause();
plc.reset({ clearInputs: true });

// Re-apply healthy defaults after reset
io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
io.inputs[WT_ADDR.LSH_HIGH] = false;

async function steps(n) {
  for (let i = 0; i < n; i++) await plc.step();
}

// 1. Initializes stopped
assert(!io.outputs[WT_ADDR.MOTOR], "motor off at init");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump off at init");
assert(!io.mem.M0, "no transfer request");

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

// 7. LSH inhibits
io.inputs[WT_ADDR.LSH_HIGH] = true;
await steps(3);
assert(!!io.mem.M1, "trip latched on LSH");
assert(!io.mem.M0, "request dropped");
assert(!io.outputs[WT_ADDR.MOTOR], "motor off on LSH");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump off on LSH");

// Clear LSH + reset required
io.inputs[WT_ADDR.LSH_HIGH] = false;
io.inputs[WT_ADDR.START] = true;
await steps(2);
io.inputs[WT_ADDR.START] = false;
assert(!io.mem.M0, "cannot restart while trip latched");
io.inputs[WT_ADDR.RESET] = true;
await steps(2);
io.inputs[WT_ADDR.RESET] = false;
assert(!io.mem.M1, "trip cleared after reset");

// Restart successfully
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(5);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "pump running after reset+start");

// 8. E-stop shutdown (P101_ESTOP_SHUTDOWN scenario)
io.inputs[WT_ADDR.ESTOP_HEALTHY] = false;
await steps(3);
assert(!io.outputs[WT_ADDR.MOTOR], "E-stop de-energizes motor");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump not running / safe");
assert(!!io.mem.M1, "trip latched on E-stop");
assert(!io.mem.M0, "auto restart inhibited");

// Cannot restart without reset even if E-stop released + start
io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
io.inputs[WT_ADDR.START] = true;
await steps(3);
io.inputs[WT_ADDR.START] = false;
assert(!io.outputs[WT_ADDR.MOTOR], "restart blocked until reset");
assert(!io.outputs[WT_ADDR.PUMP_RUNNING], "pump blocked until reset");

// 9. Explicit reset + restart
io.inputs[WT_ADDR.RESET] = true;
await steps(2);
io.inputs[WT_ADDR.RESET] = false;
assert(!io.mem.M1, "trip cleared");
io.inputs[WT_ADDR.START] = true;
await steps(1);
io.inputs[WT_ADDR.START] = false;
await steps(5);
assert(!!io.outputs[WT_ADDR.PUMP_RUNNING], "running after E-stop reset sequence");

console.log("Phase 4 smoke_test_water_transfer: PASS");
console.log(JSON.stringify({
  initStopped: true,
  startSequence: true,
  lshInhibit: true,
  estopShutdown: true,
  restartInhibited: true,
  resetRequired: true
}));
