/**
 * FAT/SAT test runner: generate tests from C&E rules, run against IR, produce pass/fail + evidence.
 */

import { IOModel } from "./io.js";
import { execLadder } from "./ladder.js";
import { normalizeTag } from "./doc_normalize.js";

const PLACEHOLDER_CAUSE = "ORPHAN_CE_CAUSE";
const PLACEHOLDER_EFFECT = "ORPHAN_CE_EFFECT";

function isPlaceholderRule(rule) {
  const causes = rule.causes || [];
  const effects = rule.effects || [];
  const norm = (t) => normalizeTag(t);
  if (rule.placeholder === true) return true;
  if (causes.some((c) => norm(c) === norm(PLACEHOLDER_CAUSE))) return true;
  if (effects.some((e) => norm(e) === norm(PLACEHOLDER_EFFECT))) return true;
  return false;
}

/**
 * Generate test cases from Cause&Effect rules.
 * Skips placeholder/orphan rules (ORPHAN_CE_CAUSE, ORPHAN_CE_EFFECT) so only testable rules are generated.
 * ioMap keys must use the same normalization as project_to_plc (normalizeTag); we look up by normalized tag.
 * @param {{ ioMap: Record<string,string>, causeEffectRules: Array<{ causes: string[], effects: string[], placeholder?: boolean }> }} opts
 * @returns {Array<{ id: string, name: string, arrange: { inputs: Record<string,boolean>, analog?: Record<string,number> }, act: { scans: number }, assert: { outputs: Record<string,boolean>, mem?: Record<string,boolean> }, notes?: string }>}
 */
export function generateTestsFromCauseEffect({ ioMap = {}, causeEffectRules = [] }) {
  const tests = [];
  const tagToAddr = (tag) => ioMap[normalizeTag(tag)] || null;

  for (let r = 0; r < causeEffectRules.length; r++) {
    const rule = causeEffectRules[r];
    if (isPlaceholderRule(rule)) continue;

    const causes = rule.causes || [];
    const effects = rule.effects || [];
    if (!causes.length || !effects.length) continue;

    const causeAddrs = causes.map((c) => tagToAddr(c)).filter(Boolean);
    const effectAddrs = effects.map((e) => tagToAddr(e)).filter(Boolean);
    if (!causeAddrs.length || !effectAddrs.length) continue;

    // Positive test: all causes TRUE -> run scans -> all effects TRUE
    const posId = `ce-${r + 1}-pos`;
    const arrangeInputs = {};
    for (const addr of causeAddrs) {
      if (addr.startsWith("I")) arrangeInputs[addr] = true;
    }
    const assertOutputs = {};
    for (const addr of effectAddrs) {
      if (addr.startsWith("Q")) assertOutputs[addr] = true;
    }
    tests.push({
      id: posId,
      name: `C&E ${r + 1}: causes ON → effects ON`,
      arrange: { inputs: arrangeInputs },
      act: { scans: 10 },
      assert: { outputs: assertOutputs },
      notes: `Causes: ${causes.join(", ")} → Effects: ${effects.join(", ")}`
    });

    // Negative test (pure AND): one cause FALSE -> effect FALSE
    if (causeAddrs.length >= 1) {
      const negId = `ce-${r + 1}-neg`;
      const oneCauseOff = { ...arrangeInputs };
      const firstInput = causeAddrs.find((a) => a.startsWith("I"));
      if (firstInput) {
        oneCauseOff[firstInput] = false;
        tests.push({
          id: negId,
          name: `C&E ${r + 1}: one cause OFF → effect OFF`,
          arrange: { inputs: oneCauseOff },
          act: { scans: 10 },
          assert: { outputs: Object.fromEntries(effectAddrs.filter((a) => a.startsWith("Q")).map((a) => [a, false])) },
          notes: `With ${firstInput} OFF, effects should be OFF`
        });
      }
    }
  }

  return tests;
}

/**
 * Run one virtual scan: build ctx from io, call execLadder once.
 * Timers advance with simTimeMs (deterministic), not wall clock.
 */
async function runOneScan(ir, io, { simTimeMs = 0, scanMs = 50, scanIndex = 1 } = {}) {
  const I = io.inputImage();
  const Q = io.bankProxy("Q");
  const M = io.bankProxy("M");
  const ctx = {
    I,
    Q,
    M,
    DIAG: { pyErrors: [] },
    FEATURES: {},
    SIM_TIME_MS: simTimeMs + scanMs,
    TON: (name, presetMs, enable) => {
      const t = io.ensureTimer(name, presetMs);
      if (!enable) {
        t.startMs = null;
        t.done = false;
        t.elapsedMs = 0;
        t._accruedScan = null;
        return { done: false, elapsedMs: 0 };
      }
      if (t._accruedScan !== scanIndex) {
        t.elapsedMs = (Number(t.elapsedMs) || 0) + scanMs;
        t._accruedScan = scanIndex;
        if (t.startMs === null) t.startMs = simTimeMs;
      }
      t.done = t.elapsedMs >= t.presetMs;
      return { done: t.done, elapsedMs: t.elapsedMs };
    }
  };
  if (io.analogInputs) ctx.A = { ...io.analogInputs };
  if (io.analogOutputs) ctx.B = io.analogOutputs;
  await execLadder(ir, ctx, {});
}

/**
 * Run tests against IR. Uses independent IOModel per test; virtual scans in a tight loop.
 * @param {{ ir: object, tests: array, scanMs?: number, maxScansPerStep?: number }} opts
 * @returns {{ summary: { total, passed, failed }, results: array }}
 */
export async function runTests({ ir, tests = [], scanMs = 50, maxScansPerStep = 20 }) {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const io = new IOModel();
    const arrange = test.arrange || {};
    const inputs = arrange.inputs || {};
    for (const [k, v] of Object.entries(inputs)) {
      io.ensureInput(k);
      io.setInput(k, !!v);
    }
    if (arrange.analog && typeof io.setAnalog === "function") {
      for (const [k, v] of Object.entries(arrange.analog)) {
        io.setAnalog(k, Number(v));
      }
    }

    const initialSnapshot = io.snapshot();

    const nScans = Math.min(maxScansPerStep, Math.max(1, test.act?.scans ?? 10));
    let simTimeMs = 0;
    for (let i = 0; i < nScans; i++) {
      await runOneScan(ir, io, { simTimeMs, scanMs, scanIndex: i + 1 });
      simTimeMs += scanMs;
    }

    const finalSnapshot = io.snapshot();
    const assert = test.assert || {};
    const outputDiffs = [];
    const memDiffs = [];

    for (const [varName, expected] of Object.entries(assert.outputs || {})) {
      const actual = !!finalSnapshot.outputs?.[varName];
      if (actual !== !!expected) {
        outputDiffs.push({ var: varName, expected: !!expected, actual });
      }
    }
    for (const [varName, expected] of Object.entries(assert.mem || {})) {
      const actual = !!finalSnapshot.mem?.[varName];
      if (actual !== !!expected) {
        memDiffs.push({ var: varName, expected: !!expected, actual });
      }
    }

    const fail = outputDiffs.length > 0 || memDiffs.length > 0;
    if (fail) failed++; else passed++;

    results.push({
      id: test.id,
      name: test.name,
      pass: !fail,
      scanCount: nScans,
      initialSnapshot,
      finalSnapshot,
      outputDiffs,
      memDiffs,
      notes: test.notes
    });
  }

  return {
    summary: { total: tests.length, passed, failed },
    results
  };
}
