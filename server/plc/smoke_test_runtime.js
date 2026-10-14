/**
 * Phase 3 runtime smoke test — node server/plc/smoke_test_runtime.js
 */

import { IOModel } from "./io.js";
import { VirtualPLC } from "./runtime.js";
import { ProjectRuntimeBridge, attachBridge } from "./project_binding.js";
import { setDataRootOverride, initStore, createProject } from "../model/store.js";
import { createSignal, createEquipment, DataType, SignalDirection, DataClass } from "../model/schema.js";
import { saveProject } from "../model/store.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tmp = path.join(__dirname, "..", "data", "_smoke_runtime");
fs.rmSync(tmp, { recursive: true, force: true });
setDataRootOverride(tmp);
initStore();

const io = new IOModel();
const plc = new VirtualPLC({ io, scanMs: 50 });
const bridge = new ProjectRuntimeBridge({ io, plc });
attachBridge(plc, bridge);

// --- Sim clock + pause/step ---
plc.start();
assert(plc.mode === "running", "should be running");
plc.pause();
assert(plc.mode === "paused", "should be paused");
const t0 = plc.clock.timeMs;
await new Promise((r) => setTimeout(r, 120));
assert(plc.clock.timeMs === t0, "paused must not advance sim time on wall clock");

await plc.step();
await plc.step();
assert(plc.clock.scanCount === 2, `expected 2 scans, got ${plc.clock.scanCount}`);
assert(plc.clock.timeMs === 100, `expected sim 100ms, got ${plc.clock.timeMs}`);

// --- TON uses sim clock ---
plc.reset({ clearInputs: true });
plc.setProgramIR({
  language: "ladder",
  networks: [{
    rungs: [{
      cond: { var: "I0" },
      actions: [{ type: "TON", name: "T0", presetMs: 150, doneTarget: "Q0" }]
    }]
  }]
});
io.setInput("I0", true);
// 150ms preset / 50ms scan = 3 scans of accrual
await plc.step(); // elapsed 50
assert(!io.timers.T0?.done, "TON should not be done at 50ms");
await plc.step(); // elapsed 100
assert(!io.timers.T0?.done, "TON should not be done at 100ms");
await plc.step(); // elapsed 150
assert(plc.clock.timeMs === 150, `sim time ${plc.clock.timeMs}`);
const ton = io.timers.T0;
assert(ton && ton.elapsedMs >= 150 && ton.done, `TON should be done: ${JSON.stringify(ton)}`);
assert(!!io.effectiveValue("Q0"), "Q0 should follow TON.done");

// --- Project bind ---
let project = createProject({ name: "Phase3 Bind Test" });
const eq = createEquipment({
  projectId: project.id,
  tag: "M1",
  type: "motor",
  dataClass: DataClass.ENGINEER_APPROVED,
  initialState: "deenergized"
});
project.equipment.push(eq);
project.signals.push(
  createSignal({
    projectId: project.id,
    tag: "M1.Run",
    dataType: DataType.BOOL,
    direction: SignalDirection.INPUT,
    initialValue: false,
    address: "I1",
    equipmentId: eq.id,
    dataClass: DataClass.ENGINEER_APPROVED
  }),
  createSignal({
    projectId: project.id,
    tag: "M1.Energized",
    dataType: DataType.BOOL,
    direction: SignalDirection.OUTPUT,
    initialValue: false,
    address: "Q1",
    equipmentId: eq.id,
    dataClass: DataClass.ENGINEER_APPROVED
  })
);
project = saveProject(project, { bumpVersion: false });

const bound = bridge.bindProject(project);
assert(bound.ok, "bind ok");
assert(bound.signalCount === 2, "2 signals");

bridge.setSignal("M1.Run", true);
assert(io.inputs.I1 === true, "input mapped");

plc.setProgramIR({
  language: "ladder",
  networks: [{
    rungs: [{
      cond: { var: "I1" },
      actions: [{ type: "COIL", target: "Q1" }]
    }]
  }]
});
await plc.step();
bridge.syncFromIo({ simTimeMs: plc.clock.timeMs });
const energized = bridge.getSignal("M1.Energized");
assert(energized?.currentValue === true, "output signal synced from Q1");

// Override
bridge.setSignal("M1.Energized", false, { override: true });
assert(bridge.getSignal("M1.Energized").simulationOverride === true, "override set");

plc.reset();
assert(plc.clock.timeMs === 0, "reset clears sim clock");
assert(bridge.getSignal("M1.Run").currentValue === false, "initials restored");

// --- Sim layer ≠ equipment: start() does not write inputs ---
io.setInput("I1", false);
plc.start();
assert(plc.mode === "running", "sim start");
assert(io.inputs.I1 === false, "sim start must not pulse equipment inputs");
plc.pause();

// --- Analog fault force ---
io.setFault({ var: "A0", mode: "force", value: 12.5 });
assert(io.effectiveValue("A0") === 12.5, "analog force");
io.clearFault("A0");

setDataRootOverride(null);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("Phase 3 smoke_test_runtime: PASS");
console.log(JSON.stringify({
  simClock: true,
  pauseNoWallAdvance: true,
  tonSimClock: true,
  projectBind: true,
  signalSync: true,
  reset: true,
  simVsEquipment: true,
  analogFault: true
}));
