/**
 * P6 Verify — execute catalog tests against real VirtualPLC + Water Transfer equipment.
 * Never invents PASS. Records actual signal/transition evidence.
 */

import { IOModel } from "../plc/io.js";
import { VirtualPLC } from "../plc/runtime.js";
import { attachWaterTransfer, WT_ADDR } from "../plc/equipment/water_transfer.js";
import PDFDocument from "pdfkit";
import { getCatalogTest, VerifyStatus, P101_ESTOP_SHUTDOWN } from "./catalog.js";

function readAddr(io, addr) {
  if (addr.startsWith("I") || addr.startsWith("Q") || addr.startsWith("M")) {
    return !!io.effectiveValue(addr);
  }
  if (addr.startsWith("A")) {
    return Number(io.analogInputs?.[addr] ?? 0);
  }
  return false;
}

function explainFailure(assertions, testDef) {
  const failed = (assertions || []).filter((a) => a.pass === false);
  if (!failed.length) return null;
  const parts = [];
  for (const a of failed) {
    const diffs = (a.diffs || [])
      .map((d) => `${d.var} expected ${d.expected}, observed ${d.actual}`)
      .join("; ");
    parts.push(
      `Assertion "${a.name}" failed at sim ${a.simTimeMs} ms` +
        (diffs ? `: ${diffs}` : "") +
        ". Engineer action: compare Runtime snapshot to pass/fail criteria" +
        (testDef?.passFailCriteria ? ` (${testDef.passFailCriteria})` : "") +
        "."
    );
  }
  return parts.join(" ");
}

/**
 * @param {object} testDef
 * @param {object} meta
 * @returns {Promise<{ pass: boolean, status: string, result: object }>}
 */
export async function runVerifyTest(testDef, meta = {}) {
  if (!testDef) {
    return {
      pass: false,
      status: VerifyStatus.NOT_RUN,
      result: {
        testId: null,
        status: VerifyStatus.NOT_RUN,
        failureExplain: "No test definition provided.",
        executedAt: new Date().toISOString(),
        evidenceClass: "VIRTUAL"
      }
    };
  }

  if (testDef.executable === false) {
    const result = {
      testId: testDef.id,
      testName: testDef.name,
      testVersion: testDef.version,
      equipment: testDef.equipment || [],
      requirementRef: testDef.requirementRef || null,
      pass: false,
      status: VerifyStatus.BLOCKED,
      projectId: meta.projectId || null,
      modelVersion: meta.modelVersion ?? null,
      logicVersion: meta.logicVersion || "water_transfer_v1",
      runtimeVersion: meta.runtimeVersion || "p6-runtime-phase6",
      initialConditions: {},
      actions: [],
      expected: {},
      actual: {},
      assertions: [],
      inputSequence: [],
      simulationTimestamps: [],
      passFailCriteria: testDef.passFailCriteria || null,
      failureExplain: testDef.blockReason || "Test blocked — not executable against current Runtime.",
      executedAt: new Date().toISOString(),
      evidenceClass: "VIRTUAL",
      disclaimer:
        "VIRTUAL test evidence only. Does not constitute completed physical FAT or certified safety function. Simulated E-stop / faults demonstrate model behavior only.",
      blockReason: testDef.blockReason || null
    };
    return { pass: false, status: VerifyStatus.BLOCKED, result };
  }

  const io = new IOModel();
  const plc = new VirtualPLC({ io, scanMs: 50 });
  attachWaterTransfer(plc, io);
  plc.pause();
  plc.reset({ clearInputs: true });
  io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;

  const inputSequence = [];
  const assertions = [];
  const timestamps = [];
  const actionsLog = [];
  let pass = true;

  for (const step of testDef.steps || []) {
    if (step.action === "RESET") {
      plc.reset({ clearInputs: true });
      io.inputs[WT_ADDR.ESTOP_HEALTHY] = true;
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "RESET" });
      actionsLog.push({ type: "RESET", simTimeMs: plc.clock.timeMs });
    } else if (step.action === "SET") {
      if (step.addr.startsWith("I")) io.setInput(step.addr, step.value);
      else if (step.addr.startsWith("Q")) io.setOutput(step.addr, step.value);
      inputSequence.push({
        simTimeMs: plc.clock.timeMs,
        type: "SET",
        addr: step.addr,
        value: step.value
      });
      actionsLog.push({
        type: "SET",
        addr: step.addr,
        value: step.value,
        simTimeMs: plc.clock.timeMs
      });
    } else if (step.action === "FAULT") {
      io.setFault({ var: step.addr, mode: step.mode || "stuck", value: !!step.value });
      inputSequence.push({
        simTimeMs: plc.clock.timeMs,
        type: "FAULT",
        addr: step.addr,
        mode: step.mode || "stuck",
        value: !!step.value
      });
      actionsLog.push({
        type: "FAULT",
        addr: step.addr,
        mode: step.mode || "stuck",
        value: !!step.value,
        simTimeMs: plc.clock.timeMs
      });
    } else if (step.action === "CLEAR_FAULT") {
      io.clearFault(step.addr);
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "CLEAR_FAULT", addr: step.addr });
      actionsLog.push({ type: "CLEAR_FAULT", addr: step.addr, simTimeMs: plc.clock.timeMs });
    } else if (step.action === "PULSE") {
      if (step.addr.startsWith("I")) io.setInput(step.addr, true);
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "PULSE_ON", addr: step.addr });
      for (let i = 0; i < (step.scans || 1); i++) await plc.step();
      if (step.addr.startsWith("I")) io.setInput(step.addr, false);
      inputSequence.push({ simTimeMs: plc.clock.timeMs, type: "PULSE_OFF", addr: step.addr });
      actionsLog.push({
        type: "PULSE",
        addr: step.addr,
        scans: step.scans || 1,
        simTimeMs: plc.clock.timeMs
      });
    } else if (step.action === "SCAN") {
      for (let i = 0; i < (step.scans || 1); i++) await plc.step();
      timestamps.push(plc.clock.timeMs);
      actionsLog.push({ type: "SCAN", scans: step.scans || 1, simTimeMs: plc.clock.timeMs });
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

  const status = pass ? VerifyStatus.PASS : VerifyStatus.FAIL;
  const failureExplain = pass ? null : explainFailure(assertions, testDef);

  const result = {
    testId: testDef.id,
    testName: testDef.name,
    testVersion: testDef.version,
    equipment: testDef.equipment || [],
    requirementRef: testDef.requirementRef || null,
    pass,
    status,
    projectId: meta.projectId || null,
    modelVersion: meta.modelVersion ?? null,
    logicVersion: meta.logicVersion || "water_transfer_v1",
    runtimeVersion: meta.runtimeVersion || "p6-runtime-phase6",
    initialConditions: summarizeICs(testDef),
    actions: actionsLog,
    expected: Object.assign({}, ...assertions.map((a) => a.expected)),
    actual: Object.assign({}, ...assertions.map((a) => a.actual)),
    assertions,
    inputSequence,
    simulationTimestamps: timestamps,
    passFailCriteria: testDef.passFailCriteria || null,
    failureExplain,
    finalSnapshot: io.snapshot(),
    executedAt: new Date().toISOString(),
    evidenceClass: "VIRTUAL",
    disclaimer:
      "VIRTUAL test evidence only. Does not constitute completed physical FAT or certified safety function. Simulated E-stop / faults demonstrate model behavior only."
  };

  return { pass, status, result };
}

function summarizeICs(testDef) {
  const ics = {};
  for (const step of testDef.steps || []) {
    if (step.action === "SET" && step.addr) ics[step.addr] = step.value;
  }
  return ics;
}

export async function runVerifyTestById(testId, meta = {}) {
  const def = getCatalogTest(testId);
  if (!def) {
    return {
      pass: false,
      status: VerifyStatus.NOT_RUN,
      result: {
        testId,
        status: VerifyStatus.NOT_RUN,
        failureExplain: `Unknown test id: ${testId}`,
        executedAt: new Date().toISOString(),
        evidenceClass: "VIRTUAL"
      }
    };
  }
  return runVerifyTest(def, meta);
}

/**
 * Run multiple tests; returns suite summary. Does not invent PASS.
 */
export async function runVerifySuite(testIds, meta = {}) {
  const results = [];
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let notRun = 0;

  for (const id of testIds) {
    const { pass, status, result } = await runVerifyTestById(id, meta);
    results.push(result);
    if (status === VerifyStatus.PASS) passed += 1;
    else if (status === VerifyStatus.FAIL) failed += 1;
    else if (status === VerifyStatus.BLOCKED) blocked += 1;
    else notRun += 1;
    void pass;
  }

  return {
    ok: true,
    summary: {
      total: results.length,
      passed,
      failed,
      blocked,
      notRun,
      allPassed: failed === 0 && blocked === 0 && notRun === 0 && passed === results.length
    },
    results,
    executedAt: new Date().toISOString(),
    evidenceClass: "VIRTUAL",
    disclaimer:
      "Suite results are VIRTUAL Runtime evidence. Physical FAT is not complete."
  };
}

export function buildFatPdf(result) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("P6 Verify — FAT Evidence Report (VIRTUAL)", { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(`Test: ${result.testName || result.testId}`);
    doc.text(`Status: ${result.status || (result.pass ? "PASS" : "FAIL")}`);
    doc.text(`Evidence class: ${result.evidenceClass || "VIRTUAL"}`);
    doc.text(`Executed: ${result.executedAt}`);
    doc.text(`Project ID: ${result.projectId || "n/a"}`);
    doc.text(`Model version: ${result.modelVersion ?? "n/a"}`);
    doc.text(`Logic version: ${result.logicVersion || "n/a"}`);
    doc.text(`Runtime version: ${result.runtimeVersion || "n/a"}`);
    doc.text(`Test version: ${result.testVersion ?? "n/a"}`);
    if (result.requirementRef) doc.text(`Requirement: ${result.requirementRef}`);
    if (result.equipment?.length) doc.text(`Equipment: ${result.equipment.join(", ")}`);
    doc.moveDown();
    doc.fillColor("#833").text(result.disclaimer || "VIRTUAL test evidence only.");
    doc.fillColor("#000");
    if (result.failureExplain) {
      doc.moveDown();
      doc.fillColor("#900").text(`Failure explanation: ${result.failureExplain}`);
      doc.fillColor("#000");
    }
    if (result.blockReason) {
      doc.moveDown();
      doc.fillColor("#960").text(`Blocked: ${result.blockReason}`);
      doc.fillColor("#000");
    }
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
    for (const s of (result.inputSequence || []).slice(0, 50)) {
      doc.text(`${s.simTimeMs}ms  ${s.type} ${s.addr || ""} ${s.value != null ? s.value : ""}`);
    }
    doc.moveDown();
    doc.fontSize(9).fillColor("#666").text(
      "Label: VIRTUAL TEST EVIDENCE — never claim physical FAT complete from this report alone."
    );
    doc.end();
  });
}

/** Backward-compatible wrapper used by legacy fat_estop smoke */
export async function runFatTest(testDef = P101_ESTOP_SHUTDOWN, meta = {}) {
  const def = typeof testDef === "string" ? getCatalogTest(testDef) : testDef || P101_ESTOP_SHUTDOWN;
  return runVerifyTest(def, meta);
}

export { P101_ESTOP_SHUTDOWN };
