/**
 * P6 Engineer REST API — mount at /api/engineer
 * Preliminary controls deliverables from approved CEM. Engineer oversight required.
 */

import { Router } from "express";
import { loadProject, updateProject, getActiveProject } from "../model/store.js";
import { attachLastValidation } from "../model/validate.js";
import { analyzeImpact } from "../model/impact.js";
import { listTemplates, getTemplate, suggestTemplatesForEquipment } from "./templates.js";
import {
  applyTemplateToEquipment,
  suggestAndApplyDefaults,
  approveTemplateApplication,
  emptyEngineerState
} from "./apply_template.js";
import { generateIoList, persistIoProposal, approveIoAddresses } from "./io_generate.js";
import { suggestStrategies, persistStrategySuggestions } from "./strategy.js";
import { generateStructuredText, persistStArtifact } from "./st_generate.js";
import { listVendors, generateForVendor } from "./vendors.js";
import {
  reviewLogic,
  regenerateAfterReview,
  listLogicArtifacts,
  getLogicSource
} from "./review.js";
import { analyzeSafetyScope, approveSafetyScope, SAFETY_DISCLAIMER } from "./safety.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_ST_DIR = path.join(__dirname, "..", "data", "engineer_samples");

function resolveProject(id) {
  if (id && id !== "active") {
    const p = loadProject(id);
    if (!p) return null;
    return p;
  }
  return getActiveProject();
}

function saveMutate(projectId, mutator) {
  return updateProject(projectId, (p) => {
    p.engineer = p.engineer || emptyEngineerState();
    mutator(p);
    attachLastValidation(p);
    return p;
  });
}

export function createEngineerRouter({ audit = () => {} } = {}) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "p6-engineer",
      disclaimer:
        "Automated preliminary controls engineering — engineer approval required. Not deployable PLC packages by default.",
      safetyDisclaimer: SAFETY_DISCLAIMER
    });
  });

  // --- Templates ---
  router.get("/templates", (_req, res) => {
    res.json({ ok: true, templates: listTemplates() });
  });

  router.get("/templates/:id", (req, res) => {
    const t = getTemplate(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: "Template not found" });
    res.json({ ok: true, template: t });
  });

  router.get("/projects/:id/template-suggestions", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      const suggestions = (project.equipment || []).map((eq) => ({
        equipmentId: eq.id,
        equipmentTag: eq.tag,
        type: eq.type,
        currentTemplateId: eq.properties?.controlTemplateId || null,
        templates: suggestTemplatesForEquipment(eq).map((t) => t.id)
      }));
      res.json({ ok: true, suggestions });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/templates/apply", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = applyTemplateToEquipment(p, {
          equipmentId: req.body?.equipmentId,
          templateId: req.body?.templateId,
          fieldValues: req.body?.fieldValues || {},
          createMissingSignals: req.body?.createMissingSignals !== false
        });
      });
      audit("engineer.template.apply", {
        projectId: saved.id,
        templateId: req.body?.templateId,
        equipmentId: req.body?.equipmentId
      });
      res.status(201).json({ ok: true, ...result, modelVersion: saved.modelVersion, projectId: saved.id });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/templates/apply-defaults", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = suggestAndApplyDefaults(p, { apply: req.body?.apply === true });
      });
      audit("engineer.template.apply_defaults", { projectId: saved.id, apply: !!req.body?.apply });
      res.json({ ok: true, ...result, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/templates/approve", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = approveTemplateApplication(p, req.body?.applicationId);
      });
      audit("engineer.template.approve", { projectId: saved.id, applicationId: req.body?.applicationId });
      res.json({ ok: true, ...result, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- I/O generation ---
  router.get("/projects/:id/io", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      const proposal = generateIoList(project, {
        onlyApprovedEquipment: req.query.onlyApproved === "1"
      });
      res.json({ ok: true, proposal });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/io/generate", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let proposal;
      const saved = saveMutate(project.id, (p) => {
        proposal = generateIoList(p, { onlyApprovedEquipment: !!req.body?.onlyApprovedEquipment });
        persistIoProposal(p, proposal);
      });
      audit("engineer.io.generate", { projectId: saved.id, counts: proposal.counts });
      res.status(201).json({ ok: true, proposal, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/io/approve-addresses", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = approveIoAddresses(p, req.body?.mappings || []);
      });
      audit("engineer.io.approve_addresses", { projectId: saved.id, count: (req.body?.mappings || []).length });
      res.json({ ok: result.ok, ...result, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Strategies ---
  router.get("/projects/:id/strategies", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      const payload = suggestStrategies(project);
      res.json(payload);
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/strategies/generate", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let payload;
      const saved = saveMutate(project.id, (p) => {
        payload = suggestStrategies(p);
        persistStrategySuggestions(p, payload);
      });
      audit("engineer.strategies.generate", { projectId: saved.id });
      res.json({ ...payload, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- ST / vendor codegen ---
  router.get("/vendors", (_req, res) => {
    res.json({ ok: true, vendors: listVendors() });
  });

  router.post("/projects/:id/st/generate", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      const vendor = req.body?.vendor || "iec61131_st";
      let out;
      let persisted;
      const saved = saveMutate(project.id, (p) => {
        out = generateForVendor(p, vendor);
        if (!out.ok) return;
        persisted = persistStArtifact(p, out.artifact, { force: !!req.body?.force });
        if (persisted.ok && req.body?.writeSample !== false) {
          try {
            fs.mkdirSync(SAMPLE_ST_DIR, { recursive: true });
            const samplePath = path.join(SAMPLE_ST_DIR, `${p.id}_preliminary.st`);
            fs.writeFileSync(samplePath, out.artifact.st, "utf8");
            out.samplePath = samplePath;
            out.sampleRelative = path.relative(path.join(__dirname, "..", ".."), samplePath);
          } catch (err) {
            out.sampleWriteError = String(err?.message || err);
          }
        }
      });
      if (!out?.ok) return res.status(400).json(out);
      if (persisted && !persisted.ok) {
        return res.status(409).json({ ok: false, ...persisted, artifactPreview: out.artifact?.st?.slice(0, 400) });
      }
      audit("engineer.st.generate", { projectId: saved.id, vendor, artifactId: out.artifact?.id });
      res.status(201).json({
        ok: true,
        deployable: false,
        vendor: out.vendor,
        message: out.message,
        artifact: {
          id: out.artifact.id,
          status: out.artifact.status,
          dataClass: out.artifact.dataClass,
          language: out.artifact.language,
          standard: out.artifact.standard,
          limitations: out.artifact.limitations,
          traceability: out.artifact.traceability,
          st: out.artifact.st
        },
        samplePath: out.sampleRelative || out.samplePath || null,
        modelVersion: saved.modelVersion
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/projects/:id/logic", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      res.json(listLogicArtifacts(project));
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/projects/:id/logic/:artifactId", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      res.json(getLogicSource(project, req.params.artifactId));
    } catch (e) {
      res.status(404).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/logic/review", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = reviewLogic(p, req.body || {});
      });
      audit("engineer.logic.review", {
        projectId: saved.id,
        decision: req.body?.decision,
        artifactId: req.body?.artifactId
      });
      res.json({ ...result, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/logic/regenerate", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = regenerateAfterReview(p, {
          force: !!req.body?.force,
          forceOverwriteManual: !!req.body?.forceOverwriteManual
        });
      });
      if (!result.ok) return res.status(409).json(result);
      audit("engineer.logic.regenerate", { projectId: saved.id });
      res.status(201).json({ ...result, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Safety (separate path) ---
  router.get("/projects/:id/safety", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      res.json(analyzeSafetyScope(project));
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/:id/safety/approve", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      let result;
      const saved = saveMutate(project.id, (p) => {
        result = approveSafetyScope(p, req.body || {});
      });
      audit("engineer.safety.approve", { projectId: saved.id, approver: req.body?.approver });
      res.json({ ...result, modelVersion: saved.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Change impact (engineer-facing wrapper) ---
  router.get("/projects/:id/impact", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      const impact = analyzeImpact(project.id, {
        entityType: req.query.entityType ? String(req.query.entityType) : null,
        entityId: req.query.entityId ? String(req.query.entityId) : null,
        tag: req.query.tag ? String(req.query.tag) : null
      });
      res.json(impact);
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /**
   * Water-transfer acceptance helper: permissives → ST → traceability → impact threshold → regenerate gate.
   */
  router.post("/projects/:id/acceptance/water-transfer", (req, res) => {
    try {
      const project = resolveProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });

      const steps = [];
      let saved = project;

      saved = saveMutate(project.id, (p) => {
        // 1 templates for key equipment
        for (const eq of p.equipment || []) {
          if (eq.properties?.controlTemplateId) continue;
          const map = {
            pump: "pump",
            motor: "motor",
            valve: "valve",
            tank: "tank",
            level_switch: "level_instrument",
            emergency_stop_input: "emergency_stop"
          };
          const tid = map[String(eq.type).toLowerCase()];
          if (tid) {
            applyTemplateToEquipment(p, { equipmentId: eq.id, templateId: tid });
          }
        }
        steps.push({ step: "templates", ok: true });

        const strategies = suggestStrategies(p);
        persistStrategySuggestions(p, strategies);
        steps.push({
          step: "permissives_strategies",
          ok: true,
          missingRequirements: strategies.missingRequirements,
          suggestions: strategies.suggestions.map((s) => s.kind)
        });

        const io = generateIoList(p);
        persistIoProposal(p, io);
        steps.push({
          step: "io_list",
          ok: true,
          counts: io.counts,
          inventedAddresses: 0,
          note: "No physical addresses invented"
        });

        const artifact = generateStructuredText(p, {});
        const persisted = persistStArtifact(p, artifact, { force: !!req.body?.force });
        steps.push({
          step: "st_generate",
          ok: persisted.ok,
          artifactId: persisted.ok ? artifact.id : null,
          error: persisted.ok ? null : persisted.error,
          traceability: artifact.traceability
        });

        try {
          fs.mkdirSync(SAMPLE_ST_DIR, { recursive: true });
          const samplePath = path.join(SAMPLE_ST_DIR, `water_transfer_preliminary.st`);
          fs.writeFileSync(samplePath, artifact.st, "utf8");
          steps.push({
            step: "sample_st_write",
            ok: true,
            path: path.relative(path.join(__dirname, "..", ".."), samplePath)
          });
        } catch (err) {
          steps.push({ step: "sample_st_write", ok: false, error: String(err?.message || err) });
        }
      });

      const pump = (saved.equipment || []).find((e) => e.type === "pump");
      const impact = pump
        ? analyzeImpact(saved.id, { entityType: "equipment", entityId: pump.id })
        : analyzeImpact(saved.id, { tag: "P101" });

      const changeThreshold = {
        signalsTouched: (impact.affected?.signals || []).length,
        interlocksTouched: (impact.affected?.interlocks || []).length,
        logicArtifacts: (impact.affected?.logic || []).length,
        regenerateRecommended: true
      };

      steps.push({ step: "impact", ok: true, affected: impact.affected, changeThreshold });

      const gaps = [];
      const strat = steps.find((s) => s.step === "permissives_strategies");
      if (strat?.missingRequirements?.length) {
        gaps.push(...strat.missingRequirements.map((m) => m.message));
      }
      const stStep = steps.find((s) => s.step === "st_generate");
      if (!stStep?.ok) gaps.push(stStep?.error || "ST persist failed");

      const acceptance = {
        ok: gaps.length === 0 || (stStep?.ok && (impact.affected?.signals || []).length > 0),
        projectId: saved.id,
        modelVersion: saved.modelVersion,
        steps,
        gaps,
        approvalGates: [
          "Template associations → engineer approve",
          "I/O hardware addresses → engineer approve (not auto-assigned)",
          "ST artifact → review approve/reject/modify",
          "Safety scope → separate qualified approve (sim-only acknowledgement)",
          "Regenerate after model change → blocked if manual approved ST exists"
        ],
        samplePath: steps.find((s) => s.step === "sample_st_write")?.path || null,
        note: "Acceptance path produces preliminary deliverables. Not a deployable multi-vendor PLC package."
      };

      audit("engineer.acceptance.water_transfer", { projectId: saved.id, ok: acceptance.ok });
      res.json(acceptance);
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
