/**
 * Safety-adjacent path — intentionally separate from normal controls codegen.
 * Does NOT infer SIL / safety functions from drawing geometry.
 * Requires qualified engineer approval. E-stop honesty preserved.
 */

import { DataClass } from "../model/schema.js";
import { emptyEngineerState } from "./apply_template.js";

export const SAFETY_DISCLAIMER =
  "Simulated E-stop and related model behaviors demonstrate control response only. " +
  "They are not certified physical safety functions. SIL ratings and safety PLC logic " +
  "are never inferred from P&ID geometry or automatic OCR.";

/**
 * Inventory safety-adjacent entities without inventing SIL claims.
 */
export function analyzeSafetyScope(project) {
  if (!project) throw new Error("Project required");
  const equipment = (project.equipment || []).filter((e) =>
    /emergency_stop|safety|esd/i.test(String(e.type)) || /ESTOP|ESD|E-STOP|SAFETY/i.test(e.tag)
  );
  const signals = (project.signals || []).filter((s) =>
    /ESTOP|ESD|E-STOP|SAFETY|SIL/i.test(s.tag)
  );
  const interlocks = (project.interlocks || []).filter((i) =>
    /ESTOP|ESD|SAFETY|SIL/i.test(i.name) || /safety|e-stop|estop/i.test(i.actionDescription || "")
  );

  const inferredSilAttempts = [];
  // Explicitly refuse geometry-based SIL
  if (project.ui?.graph || project.documents?.length) {
    inferredSilAttempts.push({
      refused: true,
      reason: "SIL/safety integrity level is never inferred from drawings, symbols, or document geometry"
    });
  }

  return {
    ok: true,
    projectId: project.id,
    modelVersion: project.modelVersion,
    path: "safety_separate",
    disclaimer: SAFETY_DISCLAIMER,
    equipment: equipment.map((e) => ({
      id: e.id,
      tag: e.tag,
      type: e.type,
      dataClass: e.dataClass,
      sil: null,
      note: "No SIL assigned by P6"
    })),
    signals: signals.map((s) => ({ id: s.id, tag: s.tag, dataClass: s.dataClass, address: s.address || null })),
    interlocks: interlocks.map((i) => ({ id: i.id, name: i.name, dataClass: i.dataClass })),
    silClaims: [],
    inferredSilAttempts,
    requiresQualifiedApproval: true,
    codegenIncluded: false,
    note: "Use POST /api/engineer/safety/approve for qualified acknowledgement. Normal ST codegen excludes certified safety logic."
  };
}

/**
 * Record qualified approval — does not generate safety PLC code.
 */
export function approveSafetyScope(project, { approver, statement, acknowledgeSimOnly = false } = {}) {
  if (!approver || !String(approver).trim()) throw new Error("approver (qualified person) required");
  if (!acknowledgeSimOnly) {
    throw new Error(
      "acknowledgeSimOnly:true required — you must acknowledge simulated E-stop is not a certified safety function"
    );
  }
  if (!statement || !String(statement).trim()) {
    throw new Error("statement required — describe what was reviewed (no SIL invention)");
  }

  project.engineer = project.engineer || emptyEngineerState();
  project.engineer.safetyApprovals = project.engineer.safetyApprovals || [];
  const record = {
    id: `saf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    approver: String(approver).trim(),
    statement: String(statement).trim(),
    acknowledgeSimOnly: true,
    silAssigned: null,
    dataClass: DataClass.ENGINEER_APPROVED,
    approvedAt: new Date().toISOString(),
    modelVersion: project.modelVersion,
    disclaimer: SAFETY_DISCLAIMER
  };
  project.engineer.safetyApprovals.push(record);
  return { ok: true, approval: record, codegen: false, message: "Safety scope acknowledged — no safety PLC package generated." };
}
