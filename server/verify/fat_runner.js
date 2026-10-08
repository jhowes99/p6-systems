/**
 * P6 Verify — automated FAT execution against Water Transfer reference.
 */

import { IOModel } from "../plc/io.js";
import { VirtualPLC } from "../plc/runtime.js";
import { attachWaterTransfer, WT_ADDR } from "../plc/equipment/water_transfer.js";
import PDFDocument from "pdfkit";

export const P101_ESTOP_SHUTDOWN = {
  id: "P101_ESTOP_SHUTDOWN",
  name: "P101_ESTOP_SHUTDOWN",
  version: 1,
  description:
    "Pump running, E-stop healthy → activate virtual E-stop → motor de-energized, pump safe, restart inhibited until reset. Simulated only — not a physical safety certification.",
  steps: [
    { action: "RESET" },
    { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
    { action: "SET", addr: WT_ADDR.LSH_HIGH, value: false },
    { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
    { action: "SCAN", scans: 6 },
    { action: "ASSERT", name: "pump_running_before_estop", checks: [
      { addr: WT_ADDR.PUMP_RUNNING, value: true },
      { addr: WT_ADDR.MOTOR, value: true },
      { addr: WT_ADDR.ESTOP_HEALTHY, value: true }
    ]},
    { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: false },
    { action: "SCAN", scans: 4 },
    { action: "ASSERT", name: "shutdown", checks: [
      { addr: WT_ADDR.MOTOR, value: false },
      { addr: WT_ADDR.PUMP_RUNNING, value: false },
      { mem: "M1", value: true },
      { mem: "M0", value: false }
    ]},
    { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
    { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
    { action: "SCAN", scans: 4 },
    { action: "ASSERT", name: "restart_inhibited", checks: [
      { addr: WT_ADDR.MOTOR, value: false },
      { addr: WT_ADDR.PUMP_RUNNING, value: false }
    ]},
    { action: "PULSE", addr: WT_ADDR.RESET, scans: 2 },
    { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
    { action: "SCAN", scans: 6 },
    { action: "ASSERT", name: "restart_after_reset", checks: [
      { addr: WT_ADDR.PUMP_RUNNING, value: true }
    ]}
  ]
};

function readAddr(io, addr) {
  if (addr.startsWith("I") || addr.startsWith("Q") || addr.startsWith("M")) {
    return !!io.effectiveValue(addr);
  }
  return false;
}

/**
 * @returns {Promise<{ pass: boolean, result: object }>}
 */
export async function runFatTest(testDef = P101_ESTOP_SHUTDOWN, meta = {}) {
  const io = new IOModel();
  const plc = new VirtualPLC({ io, scanMs: 50 });
  attachWaterTransfer(plc, io);
  plc.pause();
  plc.reset({ clearInputs: true });
  io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;

  const inputSequence = [];
  const assertions = [];
  const timestamps = [];
  let pass = true;

  for (const step of testDef.steps) {
    if (step.action === "RESET") {
      plc.reset({ clearInputs: true });
      io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "RESET" });
    } else if (step.action === "SET") {
      if (step.addr.startsWith("I")) io.setInput(step.addr, step.value);
      else if (step.addr.startsWith("Q")) io.setOutput(step.addr, step.value);
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "SET", addr: step.addr, value: step.value });
    } else if (step.action === "PULSE") {
      if (step.addr.startsWith("I")) io.setInput(step.addr, true);
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "PULSE_ON", addr: step.addr });
      for (let i = 0; i < (step.scans || 1); i++) await plc.step();
      if (step.addr.startsWith("I")) io.setInput(step.addr, false);
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "PULSE_OFF", addr: step.addr });
    } else if (step.action === "SCAN") {
      for (let i = 0; i < (step.scans || 1); i++) await plc.step();
      timestamps.push(plc.clock.timeMs);
    } else if (step.action === "ASSERT") {
      const diffs = [];
      const actual = {};
      const expected = {};
      for (const c of step.checks || []) {
        if (c.addr) {
          const a = readAddr(io, c.addr);
          actual[c.addr] = a;
          expected[c.addr] = !!c.value;
          if (a !== !!c.value) diffs.push({ var: c.addr, expected: !!c.value, actual: a });
        }
        if (c.mem) {
          const a = !!io.mem[c.mem];
          actual[c.mem] = a;
          expected[c.mem] = !!c.value;
          if (a !== !!c.value) diffs.push({ var: c.mem, expected: !!c.value, actual: a });
        }
      }
      const ok = diffs.length === 0;
      if (!ok) pass = false;
      assertions.push({
        name: step.name,
        pass: ok,
        actual,
        expected,
        diffs,
        simTimeMs: plc.clock.timeMs,
        scanCount: plc.clock.scanCount
      });
    }
  }

  const result = {
    testId: testDef.id,
    testName: testDef.name,
    testVersion: testDef.version,
    pass,
    projectId: meta.projectId || null,
    modelVersion: meta.modelVersion || null,
    logicVersion: meta.logicVersion || "water_transfer_v1",
    runtimeVersion: meta.runtimeVersion || "p6-runtime-phase3",
    inputSequence,
    assertions,
    simulationTimestamps: timestamps,
    finalSnapshot: io.snapshot(),
    executedAt: new Date().toISOString(),
    disclaimer: "Simulated E-stop verifies model behavior only. It does not certify a physical safety function."
  };

  return { pass, result };
}

export function buildFatPdf(result) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("P6 Verify — FAT Evidence Report", { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(`Test: ${result.testName}`);
    doc.text(`Result: ${result.pass ? "PASS" : "FAIL"}`);
    doc.text(`Executed: ${result.executedAt}`);
    doc.text(`Project ID: ${result.projectId || "n/a"}`);
    doc.text(`Model version: ${result.modelVersion ?? "n/a"}`);
    doc.text(`Logic version: ${result.logicVersion}`);
    doc.text(`Runtime version: ${result.runtimeVersion}`);
    doc.text(`Test version: ${result.testVersion}`);
    doc.moveDown();
    doc.fillColor("#833").text(result.disclaimer);
    doc.fillColor("#000");
    doc.moveDown();
    doc.fontSize(13).text("Assertions", { underline: true });
    doc.fontSize(10);
    for (const a of result.assertions || []) {
      doc.text(`${a.pass ? "PASS" : "FAIL"} — ${a.name} @ sim ${a.simTimeMs}ms`);
      if (a.diffs?.length) {
        for (const d of a.diffs) {
          doc.text(`  ${d.var}: expected ${d.expected}, actual ${d.actual}`);
        }
      }
    }
    doc.moveDown();
    doc.fontSize(13).text("Input sequence (abbrev)", { underline: true });
    doc.fontSize(9);
    for (const s of (result.inputSequence || []).slice(0, 40)) {
      doc.text(`${s.simTimeMs}ms  ${s.type} ${s.addr || ""} ${s.value != null ? s.value : ""}`);
    }
    doc.end();
  });
}
