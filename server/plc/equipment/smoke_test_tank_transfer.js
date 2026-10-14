/**
 * §40 two-tank transfer acceptance smoke
 * node server/plc/equipment/smoke_test_tank_transfer.js
 */

import { IOModel } from "../io.js";
import { VirtualPLC } from "../runtime.js";
import { attachTankTransfer, TT_ADDR } from "./tank_transfer.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const io = new IOModel();
const plc = new VirtualPLC({ io, scanMs: 50 });
attachTankTransfer(plc, io);
plc.pause();
plc.reset({ clearInputs: true });
io.inputs[TT_ADDR.ESD_HEALTHY] = true;
io.inputs[TT_ADDR.LSH_HIGH] = false;

async function steps(n) {
  for (let i = 0; i < n; i++) await plc.step();
}

assert(!io.outputs[TT_ADDR.MOTOR], "motor off at init");

io.inputs[TT_ADDR.VALVE_CMD] = true;
await steps(3);
assert(!!io.inputs[TT_ADDR.VALVE_OPENED], "VALVE-101 open");

io.inputs[TT_ADDR.START] = true;
await steps(1);
io.inputs[TT_ADDR.START] = false;
await steps(4);
assert(!!io.outputs[TT_ADDR.PUMP_RUNNING], "pump running");
assert(Number(io.analogInputs[TT_ADDR.FIT101]) > 0, "flow observed");
const a = Number(io.analogInputs[TT_ADDR.LT101]);
const b = Number(io.analogInputs[TT_ADDR.LT102]);
await steps(8);
assert(Number(io.analogInputs[TT_ADDR.LT101]) < a, "TANK-101 falling");
assert(Number(io.analogInputs[TT_ADDR.LT102]) > b, "TANK-102 rising");

io.inputs[TT_ADDR.VALVE_CMD] = false;
await steps(4);
assert(!io.inputs[TT_ADDR.VALVE_OPENED], "valve closed");
assert(!io.outputs[TT_ADDR.MOTOR], "motor off when valve closed");
assert(Number(io.analogInputs[TT_ADDR.FIT101]) < 5, "flow stops");

io.inputs[TT_ADDR.VALVE_CMD] = true;
await steps(3);
io.inputs[TT_ADDR.START] = true;
await steps(1);
io.inputs[TT_ADDR.START] = false;
await steps(4);
assert(!!io.outputs[TT_ADDR.PUMP_RUNNING], "flow resumes");

io.inputs[TT_ADDR.LSH_HIGH] = true;
await steps(3);
assert(!!io.mem.M1, "high-level trip");
assert(!io.outputs[TT_ADDR.PUMP_RUNNING], "pump stopped by interlock");

io.inputs[TT_ADDR.LSH_HIGH] = false;
io.inputs[TT_ADDR.RESET] = true;
await steps(2);
io.inputs[TT_ADDR.RESET] = false;

io.inputs[TT_ADDR.START] = true;
await steps(1);
io.inputs[TT_ADDR.START] = false;
await steps(4);
assert(!!io.outputs[TT_ADDR.PUMP_RUNNING], "restart after reset");

io.inputs[TT_ADDR.ESD_HEALTHY] = false;
await steps(3);
assert(!io.outputs[TT_ADDR.MOTOR], "ESD shutdown");
assert(!!io.mem.M1, "ESD trip latch");

console.log("PASS smoke_test_tank_transfer");
process.exit(0);
