/**
 * Apply a control template to equipment in a CEM project.
 * Creates missing ENGINEERING_INFERENCE signals; never invents PLC addresses.
 * Does not overwrite ENGINEER_APPROVED signal definitions silently.
 */

import {
  DataClass,
  DataType,
  SignalDirection,
  createSignal,
  ValidationStatus
} from "../model/schema.js";
import { getTemplate, signalTagFor, suggestTemplatesForEquipment } from "./templates.js";

function ioClassToDirection(ioClass) {
  if (ioClass === "DI" || ioClass === "AI") return SignalDirection.INPUT;
  if (ioClass === "DO" || ioClass === "AO") return SignalDirection.OUTPUT;
  return SignalDirection.INTERNAL;
}

function dataTypeFrom(roleSig) {
  const t = String(roleSig?.dataType || "BOOL").toUpperCase();
  if (Object.values(DataType).includes(t)) return t;
  return DataType.BOOL;
}

/**
 * @param {object} project
 * @param {{ equipmentId: string, templateId: string, fieldValues?: object, createMissingSignals?: boolean }} opts
 */
export function applyTemplateToEquipment(project, opts = {}) {
  const { equipmentId, templateId, fieldValues = {}, createMissingSignals = true } = opts;
  if (!project) throw new Error("Project required");
  const eq = (project.equipment || []).find((e) => e.id === equipmentId);
  if (!eq) throw new Error("Equipment not found");
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);

  if (template.safetyRelated) {
    // Allowed to apply metadata; safety path still needs separate approval
  }

  const matchingTypes = template.equipmentTypes.map((t) => t.toLowerCase());
  const typeOk = matchingTypes.includes("*") || matchingTypes.includes(String(eq.type).toLowerCase());
  if (!typeOk) {
    throw new Error(
      `Template "${templateId}" does not match equipment type "${eq.type}" (allowed: ${matchingTypes.join(", ")})`
    );
  }

  eq.properties = eq.properties || {};
  eq.properties.controlTemplateId = template.id;
  eq.properties.controlTemplateFields = { ...(eq.properties.controlTemplateFields || {}), ...fieldValues };
  eq.properties.controlTemplateAppliedAt = new Date().toISOString();
  if (eq.dataClass !== DataClass.ENGINEER_APPROVED) {
    eq.validationStatus = ValidationStatus.WARNING;
  }
  eq.updatedAt = new Date().toISOString();

  const created = [];
  const skipped = [];
  const existing = [];

  for (const roleSig of template.signals || []) {
    const tag = signalTagFor(eq.tag, roleSig.role);
    const found = (project.signals || []).find((s) => s.tag === tag);
    if (found) {
      existing.push({ tag, id: found.id, dataClass: found.dataClass });
      // Do not silently change engineer-approved signals
      if (found.dataClass === DataClass.ENGINEER_APPROVED) {
        skipped.push({ tag, reason: "ENGINEER_APPROVED_PRESERVED" });
        continue;
      }
      found.description = found.description || roleSig.description;
      found.units = found.units || roleSig.units || "";
      continue;
    }
    if (!createMissingSignals) {
      skipped.push({ tag, reason: "CREATE_DISABLED" });
      continue;
    }
    const sig = createSignal({
      projectId: project.id,
      tag,
      dataType: dataTypeFrom(roleSig),
      units: roleSig.units || "",
      direction: ioClassToDirection(roleSig.ioClass),
      initialValue: roleSig.dataType === "REAL" || roleSig.dataType === "INT" ? 0 : false,
      equipmentId: eq.id,
      address: null, // NEVER invent physical PLC address
      dataClass: DataClass.ENGINEERING_INFERENCE,
      source: `p6.engineer.template.${template.id}`
    });
    sig.ioClass = roleSig.ioClass;
    sig.role = roleSig.role;
    sig.description = roleSig.description;
    project.signals.push(sig);
    created.push({ tag: sig.tag, id: sig.id, ioClass: roleSig.ioClass });
  }

  project.engineer = project.engineer || emptyEngineerState();
  const app = {
    id: `tapp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    templateId: template.id,
    equipmentId: eq.id,
    equipmentTag: eq.tag,
    fieldValues,
    createdSignalTags: created.map((c) => c.tag),
    status: "proposed",
    dataClass: DataClass.ENGINEERING_INFERENCE,
    appliedAt: new Date().toISOString(),
    disclaimer: template.disclaimer || null
  };
  project.engineer.templateApplications = project.engineer.templateApplications || [];
  project.engineer.templateApplications.push(app);

  return {
    ok: true,
    application: app,
    equipment: { id: eq.id, tag: eq.tag, type: eq.type },
    template: { id: template.id, name: template.name },
    signals: { created, existing, skipped },
    note:
      "Template applied as ENGINEERING_INFERENCE. Physical PLC addresses remain unset until engineer approval. Not deployable hardware mapping."
  };
}

export function emptyEngineerState() {
  return {
    templateApplications: [],
    ioProposals: [],
    logicArtifacts: [],
    logicReviews: [],
    strategySuggestions: [],
    safetyApprovals: [],
    lastGenerate: null
  };
}

/**
 * Auto-suggest + optionally apply default templates for all equipment lacking one.
 */
export function suggestAndApplyDefaults(project, { apply = false } = {}) {
  const suggestions = [];
  for (const eq of project.equipment || []) {
    if (eq.properties?.controlTemplateId) continue;
    const hits = suggestTemplatesForEquipment(eq);
    suggestions.push({
      equipmentId: eq.id,
      equipmentTag: eq.tag,
      type: eq.type,
      templates: hits.map((h) => h.id)
    });
    if (apply && hits[0]) {
      applyTemplateToEquipment(project, {
        equipmentId: eq.id,
        templateId: hits[0].id,
        createMissingSignals: true
      });
    }
  }
  return { ok: true, suggestions, applied: apply };
}

/**
 * Approve a template application (association only — not silent logic overwrite).
 */
export function approveTemplateApplication(project, applicationId) {
  project.engineer = project.engineer || emptyEngineerState();
  const app = (project.engineer.templateApplications || []).find((a) => a.id === applicationId);
  if (!app) throw new Error("Template application not found");
  app.status = "approved";
  app.dataClass = DataClass.ENGINEER_APPROVED;
  app.approvedAt = new Date().toISOString();
  const eq = (project.equipment || []).find((e) => e.id === app.equipmentId);
  if (eq) {
    eq.properties = eq.properties || {};
    eq.properties.controlTemplateApproved = true;
    eq.updatedAt = new Date().toISOString();
  }
  return { ok: true, application: app };
}
