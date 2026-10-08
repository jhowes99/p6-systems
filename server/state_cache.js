/**
 * In-memory cache for status header: last validation + last test run.
 * Used by GET /api/status and GET /api/tests/last.
 */

let lastValidation = null;
let lastTestsSummary = null;
let lastTestsResults = null;

export function setLastValidation(result) {
  if (!result) {
    lastValidation = null;
    return;
  }
  lastValidation = {
    score: result.score,
    errors: result.errors?.length ?? result.stats?.errorCount ?? 0,
    warnings: result.warnings?.length ?? result.stats?.warningCount ?? 0,
    lastRunAt: new Date().toISOString(),
    errorsList: result.errors || [],
    warningsList: result.warnings || []
  };
}

export function getLastValidation() {
  return lastValidation;
}

export function setLastTestsRun(summary, results = null) {
  lastTestsSummary = summary ? {
    passed: summary.passed ?? 0,
    failed: summary.failed ?? 0,
    total: summary.total ?? 0,
    status: (summary.failed ?? 0) > 0 ? "FAIL" : (summary.total ?? 0) > 0 ? "PASS" : "NONE",
    lastRunAt: new Date().toISOString()
  } : null;
  lastTestsResults = results || null;
}

export function getLastTestsSummary() {
  return lastTestsSummary;
}

export function getLastTestsResults() {
  return lastTestsResults;
}
