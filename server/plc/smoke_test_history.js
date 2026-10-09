/**
 * Signal history ring buffer smoke — node server/plc/smoke_test_history.js
 */
import { SignalHistoryBuffer } from "./history_buffer.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const h = new SignalHistoryBuffer({ maxFrames: 5, everyN: 1 });
assert(h.meta().recording === true, "recording default on");

for (let i = 1; i <= 7; i++) {
  h.record({
    scanCount: i,
    simTimeMs: i * 50,
    signals: [
      { tag: "PUMP-101.RunningFeedback", currentValue: i > 3 },
      { tag: "FIT-101.FlowGpm", currentValue: i > 3 ? 40 : 0 }
    ],
    mem: { M0: false, M1: false }
  });
}

assert(h.meta().count === 5, "ring caps at maxFrames");
assert(h.get(0).scanCount === 3, "oldest retained");
assert(h.get(4).signals["FIT-101.FlowGpm"] === 40, "latest flow");

h.setRecording(false);
h.record({ scanCount: 99, simTimeMs: 1, signals: [] });
assert(h.meta().count === 5, "paused recording ignores");

h.clear();
assert(h.meta().count === 0, "clear");

console.log("PASS smoke_test_history");
process.exit(0);
