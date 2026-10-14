/**
 * P6 Verify + engineering export HTTP routes (Phase 6 / M09–M11).
 */

import { Router } from "express";
import { getActiveProject, loadProject } from "../model/store.js";
import {
  listCatalogSummaries,
  getCatalogTest,
  getExecutableCatalogIds,
  getAllCatalogIds,
  VerifyStatus,
  REQUIREMENT_TEMPLATES
} from "./catalog.js";
import { runVerifyTestById, runVerifySuite, buildFatPdf, runFatTest } from "./runner.js";
import { generateTestsFromApprovedRequirements } from "./generate.js";
import { runImpactRegression, resolveRegressionTestIds } from "./regression.js";
import { buildFatProcedure, buildAllFatDocs } from "./fat_docs.js";
import { runAcceptancePath } from "./acceptance.js";
import { loadVerifyResults, saveVerifyResults, loadLastAcceptance } from "./results_store.js";
import {
  buildEngineeringPackageZip,
  buildPackageManifest,
  approveEngineeringPackage,
  getPackageApproval,
  revokeEngineeringPackageApproval
} from "../exports/engineering_package.js";
import { collectEngineeringArtifacts } from "../exports/engineering_artifacts.js";
import { generatePreliminaryHmiConfig } from "../exports/hmi_config.js";
import { getConnectArchitecture } from "../connect/adapters.js";
import { analyzeImpact } from "../model/impact.js";

function resolveProject(req) {
  const id = req.body?.projectId || req.query?.projectId || null;
  if (id) return loadProject(id);
  return getActiveProject();
}

export function createVerifyRouter({ audit = () => {} } = {}) {
  const router = Router();

  router.get("/tests", (_req, res) => {
    const tests = listCatalogSummaries();
    res.json({
      ok: true,
      tests,
      requirements: REQUIREMENT_TEMPLATES,
      executableIds: getExecutableCatalogIds(),
      statuses: Object.values(VerifyStatus),
      limits: [
        "Catalog tests execute against Water Transfer VirtualPLC Runtime only.",
        "P101_MOTOR_FAULT_ALARM is BLOCKED until Runtime raises P101.Fault / alarm coil.",
        "All evidence is VIRTUAL — never claim physical FAT complete.",
        "Tank Transfer FATs still require dedicated assertions before catalog expansion."
      ],
      evidenceClass: "VIRTUAL"
    });
  });

  router.post("/generate", (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const out = generateTestsFromApprovedRequirements(project);
      audit("verify.generate", {
        projectId: project.id,
        count: out.generated?.length || 0
      });
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/run", async (req, res) => {
    try {
      const project = resolveProject(req);
      const meta = {
        projectId: project?.id || null,
        modelVersion: project?.modelVersion ?? null
      };
      const suite = req.body?.suite === true || Array.isArray(req.body?.testIds);
      if (suite) {
        const ids =
          Array.isArray(req.body?.testIds) && req.body.testIds.length
            ? req.body.testIds
            : getExecutableCatalogIds();
        const out = await runVerifySuite(ids, meta);
        saveVerifyResults({ ...out, testIds: ids, mode: "suite" });
        audit("verify.run_suite", { count: ids.length, summary: out.summary });
        return res.json(out);
      }

      const testId = req.body?.testId || "P101_ESTOP_SHUTDOWN";
      const { pass, status, result } = await runVerifyTestById(testId, meta);
      saveVerifyResults({
        mode: "single",
        testIds: [testId],
        summary: {
          total: 1,
          passed: status === "PASS" ? 1 : 0,
          failed: status === "FAIL" ? 1 : 0,
          blocked: status === "BLOCKED" ? 1 : 0,
          notRun: status === "NOT_RUN" ? 1 : 0
        },
        results: [result],
        evidenceClass: "VIRTUAL"
      });
      audit("verify.run", { testId, pass, status });
      res.json({ ok: true, pass, status, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/run.pdf", async (req, res) => {
    try {
      const project = resolveProject(req);
      const testId = req.body?.testId || "P101_ESTOP_SHUTDOWN";
      const { pass, status, result } = await runVerifyTestById(testId, {
        projectId: project?.id || null,
        modelVersion: project?.modelVersion ?? null
      });
      const pdf = await buildFatPdf(result);
      audit("verify.run_pdf", { testId, pass, status, bytes: pdf.length });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.testId || testId}_${status || (pass ? "PASS" : "FAIL")}.pdf"`
      );
      res.send(pdf);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/regression", async (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const out = await runImpactRegression(project, {
        entityType: req.body?.entityType,
        entityId: req.body?.entityId,
        tag: req.body?.tag,
        testIds: req.body?.testIds
      });
      audit("verify.regression", {
        projectId: project.id,
        testIds: out.testIds,
        summary: out.summary
      });
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/results", (_req, res) => {
    const stored = loadVerifyResults();
    res.json({
      ok: true,
      results: stored,
      acceptance: loadLastAcceptance(),
      evidenceClass: "VIRTUAL"
    });
  });

  router.get("/fat-docs", (req, res) => {
    try {
      const project = resolveProject(req);
      const testId = req.query?.testId;
      if (testId) {
        const stored = loadVerifyResults();
        const last = (stored?.results || []).find((r) => r.testId === testId) || null;
        return res.json(buildFatProcedure(testId, { lastResult: last, project }));
      }
      res.json(buildAllFatDocs(project));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/acceptance", async (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const acceptance = await runAcceptancePath(project);
      audit("verify.acceptance", {
        projectId: project.id,
        failMatched: acceptance.failEvidence?.matchedExpectation,
        corrected: acceptance.correctedRerun?.status
      });
      res.json(acceptance);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Engineering exports / package (M11) ---

  router.get("/exports/artifacts", (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const verify = loadVerifyResults();
      res.json(collectEngineeringArtifacts(project, { verifyReport: verify }));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/exports/hmi", (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      res.json(generatePreliminaryHmiConfig(project));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/exports/package/manifest", (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      res.json(buildPackageManifest(project));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/exports/package/approval", (req, res) => {
    const project = resolveProject(req);
    res.json({ ok: true, ...getPackageApproval(project?.id) });
  });

  router.post("/exports/package/approve", (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const approval = approveEngineeringPackage(project.id, {
        actor: req.body?.actor || "engineer",
        note: req.body?.note || ""
      });
      audit("exports.package.approve", { projectId: project.id, actor: approval.actor });
      res.json({ ok: true, approval });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/exports/package/revoke", (req, res) => {
    const project = resolveProject(req);
    const out = revokeEngineeringPackageApproval(project?.id);
    audit("exports.package.revoke", { projectId: project?.id });
    res.json({ ok: true, ...out });
  });

  router.get("/exports/package/download", async (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const forcePreview =
        req.query?.forcePreview === "1" || req.query?.forcePreview === "true";
      const { buffer, filename, approval, forcePreview: preview } =
        await buildEngineeringPackageZip(project, { forcePreview });
      audit("exports.package.download", {
        projectId: project.id,
        bytes: buffer.length,
        preview: !!preview,
        approved: !!approval.approved
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (e) {
      if (e?.code === "NOT_APPROVED") {
        return res.status(403).json({
          ok: false,
          error: e.message,
          code: "NOT_APPROVED",
          hint: "POST /api/verify/exports/package/approve or use ?forcePreview=1"
        });
      }
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Connect architecture (also under verify for package wiring; primary under /api/connect)
  router.get("/connect/architecture", (req, res) => {
    const project = resolveProject(req);
    res.json(getConnectArchitecture(project?.id));
  });

  // Impact helper for UI (thin wrap)
  router.get("/impact-tests", (req, res) => {
    try {
      const project = resolveProject(req);
      if (!project) return res.status(404).json({ ok: false, error: "No active project" });
      const impact = analyzeImpact(project.id, {
        entityType: req.query?.entityType,
        entityId: req.query?.entityId,
        tag: req.query?.tag
      });
      const testIds = resolveRegressionTestIds(project, {
        entityType: req.query?.entityType,
        entityId: req.query?.entityId,
        tag: req.query?.tag
      });
      res.json({ ok: true, impact, regressionTestIds: testIds });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Legacy single-test helper used by older clients
  router.post("/run-legacy-estop", async (req, res) => {
    const project = resolveProject(req);
    const { pass, result } = await runFatTest(undefined, {
      projectId: project?.id || null,
      modelVersion: project?.modelVersion ?? null
    });
    res.json({ ok: true, pass, result });
  });

  void getAllCatalogIds;
  void getCatalogTest;

  return router;
}
