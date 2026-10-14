/**
 * Phase 6 / M09–M11 — Verify + exports smoke (no server required for core runner).
 * Usage: node scripts/smoke_verify_phase6.mjs
 */

import assert from "assert";
import {
  listCatalogSummaries,
  getExecutableCatalogIds,
  getAllCatalogIds,
  VerifyStatus
} from "../server/verify/catalog.js";
import { runVerifySuite, runVerifyTestById } from "../server/verify/runner.js";
import { generateTestsFromApprovedRequirements } from "../server/verify/generate.js";
import { runAcceptancePath } from "../server/verify/acceptance.js";
import { buildAllFatDocs } from "../server/verify/fat_docs.js";
import { collectEngineeringArtifacts } from "../server/exports/engineering_artifacts.js";
import { generatePreliminaryHmiConfig } from "../server/exports/hmi_config.js";
import {
  buildEngineeringPackageZip,
  approveEngineeringPackage,
  revokeEngineeringPackageApproval
} from "../server/exports/engineering_package.js";
import { getConnectArchitecture } from "../server/connect/adapters.js";
import { ensureWaterTransferProject } from "../server/model/seed_water_transfer.js";
import { initStore, getActiveProject } from "../server/model/store.js";

initStore();
ensureWaterTransferProject();
const project = getActiveProject();
assert(project, "active water transfer project");

const catalog = listCatalogSummaries();
assert.equal(catalog.length, 7, "catalog has 7 tests");
assert.equal(getExecutableCatalogIds().length, 6, "6 executable");
assert.equal(getAllCatalogIds().includes("P101_MOTOR_FAULT_ALARM"), true);

const blocked = await runVerifyTestById("P101_MOTOR_FAULT_ALARM", {
  projectId: project.id,
  modelVersion: project.modelVersion
});
assert.equal(blocked.status, VerifyStatus.BLOCKED, "motor fault is BLOCKED not PASS");
assert.equal(blocked.pass, false);

const suite = await runVerifySuite(getExecutableCatalogIds(), {
  projectId: project.id,
  modelVersion: project.modelVersion
});
assert.equal(suite.summary.total, 6);
assert.equal(suite.summary.failed, 0, `executable suite must pass: ${JSON.stringify(suite.summary)}`);
assert.equal(suite.summary.passed, 6, "all 6 executable PASS against Runtime");
assert.equal(suite.evidenceClass, "VIRTUAL");

const gen = generateTestsFromApprovedRequirements(project);
assert.ok(gen.generated.length >= 5, "generated from approved requirements");
assert.ok(gen.generated.some((g) => g.id === "P101_MOTOR_FAULT_ALARM" && !g.executable));

const acceptance = await runAcceptancePath(project);
assert.equal(acceptance.failEvidence.matchedExpectation, true, "deliberate fail evidence recorded");
assert.equal(acceptance.correctedRerun.status, "PASS", "corrected rerun PASS");
assert.equal(acceptance.evidenceClass, "VIRTUAL");

const fatDocs = buildAllFatDocs(project, { results: suite.results });
assert.ok(fatDocs.documents.length >= 6);
assert.match(fatDocs.honestyLabel, /VIRTUAL/);

const artifacts = collectEngineeringArtifacts(project, { verifyReport: suite });
assert.ok(artifacts.presentKinds.includes("equipment_list"));
assert.ok(artifacts.presentKinds.includes("interlock_matrix"));
assert.ok(artifacts.presentKinds.includes("verify_report"));

const hmi = generatePreliminaryHmiConfig(project);
assert.equal(hmi.ignitionPath.liveProven, false);
assert.ok(hmi.screen.symbols.length > 0);

const arch = getConnectArchitecture(project.id);
assert.equal(arch.liveDeployClaimed, false);
assert.equal(arch.neverAutoWritePhysicalPlc, true);

revokeEngineeringPackageApproval(project.id);
let denied = false;
try {
  await buildEngineeringPackageZip(project, { forcePreview: false });
} catch (e) {
  denied = e.code === "NOT_APPROVED";
}
assert.ok(denied, "package download denied without approval");

approveEngineeringPackage(project.id, { actor: "smoke", note: "phase6" });
const pkg = await buildEngineeringPackageZip(project, { forcePreview: false });
assert.ok(pkg.buffer.length > 100, "zip buffer");
assert.match(pkg.filename, /\.zip$/);
assert.equal(pkg.manifest.evidenceClass, "VIRTUAL");

console.log(
  JSON.stringify(
    {
      ok: true,
      catalog: catalog.length,
      executablePass: suite.summary.passed,
      blocked: 1,
      acceptanceFailEvidence: true,
      packageBytes: pkg.buffer.length,
      presentArtifacts: artifacts.presentKinds
    },
    null,
    2
  )
);
console.log("smoke_verify_phase6: PASS");
