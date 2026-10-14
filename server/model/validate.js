/**
 * CEM 2.0 — centralized engineering validation (non-blocking by default).
 * Terminology: errors / warnings / info with stable codes for API + Studio.
 */

import { DataClass, SignalDirection } from "./schema.js";
import { EquipmentLibrary } from "../plc/equipment/library.js";

const KNOWN_EQUIP_TYPES = new Set(
  Object.values(EquipmentLibrary || {})
    .map((d) => String(d?.type || "").toLowerCase())
    .filter(Boolean)
);

/** @typedef {{ code: string, severity: 'error'|'warning'|'info', message: string, entityType?: string, entityId?: string, tag?: string }} ValidationIssue */

/**
 * @param {object} project
 * @returns {{ ok: boolean, errorCount: number, warningCount: number, infoCount: number, issues: ValidationIssue[], validatedAt: string }}
 */
export function validateProject(project) {
  const issues = /** @type {ValidationIssue[]} */ ([]);
  if (!project || typeof project !== "object") {
    return pack([{ code: "PROJECT_MISSING", severity: "error", message: "No project document" }]);
  }

  const eqById = new Map((project.equipment || []).map((e) => [e.id, e]));
  const eqTags = new Map();
  for (const e of project.equipment || []) {
    if (eqTags.has(e.tag)) {
      issues.push({
        code: "DUPLICATE_EQUIPMENT_TAG",
        severity: "error",
        message: `Duplicate equipment tag: ${e.tag}`,
        entityType: "equipment",
        entityId: e.id,
        tag: e.tag
      });
    }
    eqTags.set(e.tag, e.id);
    if (e.type && KNOWN_EQUIP_TYPES.size && !KNOWN_EQUIP_TYPES.has(String(e.type).toLowerCase())) {
      issues.push({
        code: "UNKNOWN_EQUIPMENT_TYPE",
        severity: "warning",
        message: `Equipment type "${e.type}" is not in EquipmentLibrary — Runtime sim may be limited`,
        entityType: "equipment",
        entityId: e.id,
        tag: e.tag
      });
    }
  }

  const sigTags = new Map();
  for (const s of project.signals || []) {
    if (sigTags.has(s.tag)) {
      issues.push({
        code: "DUPLICATE_SIGNAL_TAG",
        severity: "error",
        message: `Duplicate signal tag: ${s.tag}`,
        entityType: "signal",
        entityId: s.id,
        tag: s.tag
      });
    }
    sigTags.set(s.tag, s.id);
    if (s.equipmentId && !eqById.has(s.equipmentId)) {
      issues.push({
        code: "ORPHAN_SIGNAL_EQUIPMENT",
        severity: "error",
        message: `Signal ${s.tag} references missing equipment id ${s.equipmentId}`,
        entityType: "signal",
        entityId: s.id,
        tag: s.tag
      });
    }
    if (s.dataClass === DataClass.ENGINEER_APPROVED && !s.address && s.direction !== SignalDirection.INTERNAL) {
      issues.push({
        code: "APPROVED_SIGNAL_NO_ADDRESS",
        severity: "warning",
        message: `Approved signal ${s.tag} has no PLC address — Runtime bind may skip IO mapping`,
        entityType: "signal",
        entityId: s.id,
        tag: s.tag
      });
    }
  }

  for (const ilk of project.interlocks || []) {
    for (const sid of ilk.conditionSignalIds || []) {
      if (!(project.signals || []).some((s) => s.id === sid)) {
        issues.push({
          code: "INTERLOCK_UNKNOWN_SIGNAL",
          severity: "error",
          message: `Interlock "${ilk.name}" references missing signal id ${sid}`,
          entityType: "interlock",
          entityId: ilk.id,
          tag: ilk.name
        });
      }
    }
    for (const eid of ilk.inhibitsEquipmentIds || []) {
      if (!eqById.has(eid)) {
        issues.push({
          code: "INTERLOCK_UNKNOWN_EQUIPMENT",
          severity: "error",
          message: `Interlock "${ilk.name}" inhibits missing equipment id ${eid}`,
          entityType: "interlock",
          entityId: ilk.id,
          tag: ilk.name
        });
      }
    }
  }

  for (const inst of project.instruments || []) {
    if (inst.equipmentId && !eqById.has(inst.equipmentId)) {
      issues.push({
        code: "ORPHAN_INSTRUMENT",
        severity: "warning",
        message: `Instrument ${inst.tag} references missing equipment`,
        entityType: "instrument",
        entityId: inst.id,
        tag: inst.tag
      });
    }
  }

  for (const c of project.connections || []) {
    if (!eqById.has(c.fromEquipmentId) || !eqById.has(c.toEquipmentId)) {
      issues.push({
        code: "CONNECTION_BROKEN_ENDPOINT",
        severity: "warning",
        message: `Connection ${c.id} has invalid equipment endpoint(s)`,
        entityType: "connection",
        entityId: c.id
      });
    }
  }

  const unapprovedEq = (project.equipment || []).filter((e) => e.dataClass !== DataClass.ENGINEER_APPROVED).length;
  if (unapprovedEq > 0) {
    issues.push({
      code: "UNAPPROVED_EQUIPMENT",
      severity: "info",
      message: `${unapprovedEq} equipment item(s) not ENGINEER_APPROVED — Connect export should wait for approval`,
      entityType: "project",
      entityId: project.id
    });
  }

  if (!(project.testCases || []).length) {
    issues.push({
      code: "NO_TEST_CASES",
      severity: "info",
      message: "No verification test cases defined on project",
      entityType: "project",
      entityId: project.id
    });
  }

  return pack(issues);
}

function pack(issues) {
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
    validatedAt: new Date().toISOString()
  };
}

/**
 * Compact snapshot for project.lastValidation (non-blocking write-path attach).
 * Truncates issue list to keep JSON files bounded; full report remains via GET validation.
 */
export function snapshotValidation(project, { maxIssues = 40 } = {}) {
  const full = validateProject(project);
  return {
    ok: full.ok,
    errorCount: full.errorCount,
    warningCount: full.warningCount,
    infoCount: full.infoCount,
    validatedAt: full.validatedAt,
    issueCount: full.issues.length,
    issues: full.issues.slice(0, maxIssues)
  };
}

/** Mutate project in place — does not block incomplete engineering work. */
export function attachLastValidation(project) {
  if (!project || typeof project !== "object") return project;
  project.lastValidation = snapshotValidation(project);
  return project;
}
