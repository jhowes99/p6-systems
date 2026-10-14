/**
 * Acceptance path: generate → execute → inject fault → fail evidence → correct → rerun → package-ready.
 * All evidence VIRTUAL. Never invents PASS.
 */

import { WT_ADDR } from "../plc/equipment/water_transfer.js";
import { generateTestsFromApprovedRequirements } from "./generate.js";
import { getExecutableCatalogIds, getCatalogTest } from "./catalog.js";
import { runVerifySuite, runVerifyTest } from "./runner.js";
import { saveAcceptanceRun, saveVerifyResults } from "./results_store.js";
import { buildAllFatDocs } from "./fat_docs.js";

/**
 * Deliberate fail-evidence step: run START_VALID while valve feedback stuck — expects FAIL.
 */
async function runDeliberateFailEvidence(meta) {
  const base = getCatalogTest("P101_START_VALID");
  if (!base) {
    return {
      status: "NOT_RUN",
      pass: false,
      failureExplain: "P101_START_VALID missing from catalog",
      evidenceClass: "VIRTUAL"
    };
  }
  const failDef = {
    ...base,
    id: "ACCEPTANCE_FAULT_INJECT_EXPECT_FAIL",
    name: "ACCEPTANCE_FAULT_INJECT_EXPECT_FAIL",
    description:
      "Acceptance path: inject stuck valve feedback then run start-valid assertions — expected FAIL (fail evidence).",
    steps: [
      { action: "RESET" },
      { action: "SET", addr: WT_ADDR.ESTOP_HEALTHY, value: true },
      { action: "SET", addr: WT_ADDR.LSH_HIGH, value: false },
      { action: "FAULT", addr: WT_ADDR.VALVE_OPENED, mode: "stuck", value: false },
      { action: "PULSE", addr: WT_ADDR.START, scans: 1 },
      { action: "SCAN", scans: 6 },
      {
        action: "ASSERT",
        name: "expect_running_but_faulted",
        checks: [
          { addr: WT_ADDR.MOTOR, value: true },
          { addr: WT_ADDR.PUMP_RUNNING, value: true }
        ]
      },
      { action: "CLEAR_FAULT", addr: WT_ADDR.VALVE_OPENED }
    ]
  };
  return runVerifyTest(failDef, meta);
}

/**
 * @param {object} project
 * @param {{ buildPackage?: function }} opts — optional package builder inject
 */
export async function runAcceptancePath(project, opts = {}) {
  const meta = {
    projectId: project?.id || null,
    modelVersion: project?.modelVersion ?? null
  };

  const generated = generateTestsFromApprovedRequirements(project);
  const execIds = (generated.generated || [])
    .filter((g) => g.executable)
    .map((g) => g.id);
  const suiteIds = execIds.length ? execIds : getExecutableCatalogIds();

  const baseline = await runVerifySuite(suiteIds, meta);

  const failStep = await runDeliberateFailEvidence(meta);
  const failEvidence = failStep.result;

  // Correct + rerun start-valid (fault cleared inside runner reset)
  const corrected = await runVerifyTest(getCatalogTest("P101_START_VALID"), meta);

  const fatDocs = buildAllFatDocs(project, {
    results: [...baseline.results, failEvidence, corrected.result]
  });

  const acceptance = {
    ok: true,
    path: ["sim", "generate", "execute", "inject_fault", "fail_evidence", "correct", "rerun", "package"],
    evidenceClass: "VIRTUAL",
    honestyLabel:
      "VIRTUAL acceptance evidence. Physical FAT / plant commissioning is NOT complete.",
    generated,
    baseline,
    failEvidence: {
      expectedStatus: "FAIL",
      observedStatus: failEvidence.status,
      matchedExpectation: failEvidence.status === "FAIL",
      result: failEvidence
    },
    correctedRerun: corrected.result,
    fatDocs,
    modelVersion: project?.modelVersion ?? null,
    projectId: project?.id || null,
    executedAt: new Date().toISOString(),
    warnings: [
      "Ignition live deploy not claimed",
      "No auto-write to physical PLCs",
      "Motor fault alarm test remains BLOCKED until Runtime alarm path exists"
    ]
  };

  // Package optional (caller / route builds zip when approved)
  if (typeof opts.buildPackage === "function") {
    acceptance.packageMeta = await opts.buildPackage(acceptance);
  }

  saveAcceptanceRun(acceptance);
  saveVerifyResults({
    mode: "acceptance",
    summary: baseline.summary,
    results: baseline.results,
    testIds: suiteIds,
    failEvidence: acceptance.failEvidence,
    correctedRerun: acceptance.correctedRerun,
    evidenceClass: "VIRTUAL"
  });

  return acceptance;
}
