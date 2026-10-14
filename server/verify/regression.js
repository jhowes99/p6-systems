/**
 * Impact-linked Verify regression: re-run catalog tests affected by model changes.
 */

import { analyzeImpact } from "../model/impact.js";
import { getExecutableCatalogIds, getAllCatalogIds, getCatalogTest } from "./catalog.js";
import { runVerifySuite } from "./runner.js";
import { saveVerifyResults } from "./results_store.js";

/**
 * Resolve which catalog tests to re-run from impact analysis or explicit list.
 */
export function resolveRegressionTestIds(project, { entityType, entityId, tag, testIds } = {}) {
  if (Array.isArray(testIds) && testIds.length) {
    return [...new Set(testIds.map(String))];
  }

  if (entityType || tag) {
    const impact = analyzeImpact(project?.id, { entityType, entityId, tag });
    const refs = [
      ...(impact.affected?.verifyCatalogRefs || []),
      ...(impact.affected?.testCases || [])
    ];
    const resolved = [];
    for (const name of refs) {
      const cat = getCatalogTest(name);
      if (cat) resolved.push(cat.id);
    }
    // If impact names LSH / ESTOP equipment, expand to related catalog
    const eq = (impact.affected?.equipment || []).map((t) => String(t).toUpperCase());
    for (const id of getAllCatalogIds()) {
      const t = getCatalogTest(id);
      if (!t) continue;
      if ((t.equipment || []).some((e) => eq.includes(String(e).toUpperCase()))) {
        resolved.push(t.id);
      }
    }
    return [...new Set(resolved)];
  }

  // Default: all executable catalog tests
  return getExecutableCatalogIds();
}

/**
 * @returns {Promise<object>}
 */
export async function runImpactRegression(project, opts = {}) {
  const ids = resolveRegressionTestIds(project, opts);
  const meta = {
    projectId: project?.id || null,
    modelVersion: project?.modelVersion ?? null
  };

  if (!ids.length) {
    const empty = {
      ok: true,
      mode: "impact_regression",
      testIds: [],
      summary: { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0, allPassed: true },
      results: [],
      note: "No Verify catalog tests linked to the change — nothing re-run.",
      evidenceClass: "VIRTUAL",
      executedAt: new Date().toISOString()
    };
    saveVerifyResults(empty);
    return empty;
  }

  const suite = await runVerifySuite(ids, meta);
  const out = {
    ...suite,
    mode: "impact_regression",
    testIds: ids,
    impact: opts.entityType || opts.tag
      ? analyzeImpact(project?.id, {
          entityType: opts.entityType,
          entityId: opts.entityId,
          tag: opts.tag
        })
      : null
  };
  saveVerifyResults(out);
  return out;
}
