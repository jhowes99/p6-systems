/**
 * FAT documentation builder — procedures, expected/observed, logs, exceptions, outstanding.
 * Always labeled VIRTUAL test evidence.
 */

import { getCatalogTest, REQUIREMENT_TEMPLATES, getAllCatalogIds } from "./catalog.js";
import { loadVerifyResults } from "./results_store.js";

/**
 * Build a FAT procedure document for one catalog test (optionally merge last run evidence).
 */
export function buildFatProcedure(testId, { lastResult = null, project = null } = {}) {
  const def = getCatalogTest(testId);
  if (!def) {
    return {
      ok: false,
      error: `Unknown test: ${testId}`,
      evidenceClass: "VIRTUAL"
    };
  }

  const req = REQUIREMENT_TEMPLATES.find((r) => r.id === def.requirementRef) || null;
  const observed = lastResult && lastResult.testId === def.id ? lastResult : null;

  const procedureSteps = (def.steps || []).map((s, i) => {
    if (s.action === "ASSERT") {
      return {
        step: i + 1,
        type: "ASSERT",
        name: s.name,
        expected: (s.checks || []).map((c) => ({
          var: c.addr || c.mem,
          value: c.value
        }))
      };
    }
    return {
      step: i + 1,
      type: s.action,
      addr: s.addr || null,
      value: s.value != null ? s.value : null,
      mode: s.mode || null,
      scans: s.scans || null
    };
  });

  const outstanding = [];
  if (def.executable === false) {
    outstanding.push({
      item: def.blockReason || "Test not executable",
      status: "BLOCKED"
    });
  }
  if (observed?.status === "FAIL") {
    outstanding.push({
      item: observed.failureExplain || "Assertion failures — see evidence",
      status: "OPEN"
    });
  }

  return {
    ok: true,
    documentType: "FAT_PROCEDURE",
    evidenceClass: "VIRTUAL",
    honestyLabel:
      "VIRTUAL TEST EVIDENCE — Simulated Runtime only. Do not claim physical FAT complete.",
    testId: def.id,
    testName: def.name,
    testVersion: def.version,
    equipment: def.equipment,
    requirementRef: def.requirementRef,
    requirement: req,
    projectId: project?.id || observed?.projectId || null,
    modelVersion: project?.modelVersion ?? observed?.modelVersion ?? null,
    description: def.description,
    passFailCriteria: def.passFailCriteria,
    procedure: procedureSteps,
    expected: observed?.expected || null,
    observed: observed
      ? {
          status: observed.status,
          pass: observed.pass,
          actual: observed.actual,
          assertions: observed.assertions,
          executedAt: observed.executedAt,
          failureExplain: observed.failureExplain || null
        }
      : null,
    logs: observed?.inputSequence || [],
    exceptions: [],
    outstanding,
    disclaimer:
      "Simulated E-stop / faults demonstrate model behavior only — not certified physical safety. VIRTUAL evidence only."
  };
}

export function buildAllFatDocs(project, suiteResults = null) {
  const stored = suiteResults || loadVerifyResults();
  const byId = new Map((stored?.results || []).map((r) => [r.testId, r]));
  const fromResults = [...new Set((stored?.results || []).map((r) => r.testId).filter(Boolean))];
  const ids = fromResults.length ? fromResults : getAllCatalogIds();
  return {
    ok: true,
    evidenceClass: "VIRTUAL",
    honestyLabel:
      "VIRTUAL TEST EVIDENCE — never claim physical FAT complete from these documents alone.",
    projectId: project?.id || null,
    modelVersion: project?.modelVersion ?? null,
    documents: ids.map((id) => buildFatProcedure(id, { lastResult: byId.get(id) || null, project }))
  };
}
