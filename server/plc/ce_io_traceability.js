/**
 * C&E ↔ I/O Traceability & Validation
 * Builds tag registry, cross-reference reports, exception log, validations, and clean outputs.
 */

import { normalizeTag } from "./doc_normalize.js";

// --- Tag classes and constants ---
const TAG_CLASS = {
  PHYSICAL_IO: "PHYSICAL_IO",
  SOFT_DERIVED: "SOFT_DERIVED",
  SPARE_FUTURE: "SPARE_FUTURE",
  REMOVE: "REMOVE",
  UNKNOWN: "UNKNOWN",
};

const SOURCE = { IO: "IO", CE: "CE", BOTH: "BOTH" };

const MISSING_REASON = {
  OK: "OK",
  CAUSE_MISSING: "CAUSE_MISSING",
  EFFECT_MISSING: "EFFECT_MISSING",
  BOTH_MISSING: "BOTH_MISSING",
};

const USAGE_CATEGORY = {
  AUTO_ACTION: "AUTO_ACTION",
  PERMISSIVE: "PERMISSIVE",
  ALARM_ONLY: "ALARM_ONLY",
  INDICATION_ONLY: "INDICATION_ONLY",
  MONITORING: "MONITORING",
  MAINT_DIAG: "MAINT_DIAG",
  SPARE_FUTURE: "SPARE_FUTURE",
  REMOVE: "REMOVE",
  UNKNOWN: "UNKNOWN",
};

// --- Step 1: Normalization (uses doc_normalize.normalizeTag) ---
export function normalizeTagForRegistry(raw) {
  return normalizeTag(raw) || "";
}

// --- Fuzzy match for suggested_match (simple Levenshtein-like) ---
function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  const d = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}

function bestFuzzyMatch(tag, registryTags, maxDistance = 4) {
  if (!tag || !registryTags.length) return "";
  const norm = normalizeTagForRegistry(tag);
  let best = "";
  let bestDist = maxDistance + 1;
  for (const t of registryTags) {
    const d = editDistance(norm, t);
    if (d < bestDist && d <= maxDistance) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

// --- Infer IO class from remark/label ---
function inferIoClass(entry) {
  const remark = String(entry.remark || "").toUpperCase();
  const tag = String(entry.tag || "").toUpperCase();
  if (/SPARE|FUTURE|RESERVED|TBD/i.test(remark) || /SPARE|FUTURE|RESERVED/i.test(tag)) return TAG_CLASS.SPARE_FUTURE;
  if (/OBSOLETE|REMOVE|DUPLICATE|DELETE/i.test(remark)) return TAG_CLASS.REMOVE;
  return TAG_CLASS.PHYSICAL_IO;
}

// --- Step 2: Build canonical master tag registry ---
/**
 * @param {Array<{ causes: string[], effects: string[], raw?: object }>} ceRules
 * @param {Array<{ tag: string, ioType?: string, ioAddress?: string, remark?: string, [k: string]: any }>} ioEntries
 * @param {Array<{ tag: string, class?: string, [k: string]: any }>} [existingRegistry]
 * @returns {Array<object>} tag_registry_master rows
 */
export function buildTagRegistry(ceRules, ioEntries, existingRegistry = []) {
  const byNorm = new Map(); // normalized tag -> { originalExamples, class, source, ioType, ioAddress, docRef }

  // From existing registry
  for (const r of existingRegistry) {
    const norm = normalizeTagForRegistry(r.tag);
    if (!norm) continue;
    const src = r.source === SOURCE.CE || r.source === SOURCE.IO || r.source === SOURCE.BOTH ? r.source : SOURCE.IO;
    const rec = byNorm.get(norm) || { originalExamples: new Set(), class: r.class || TAG_CLASS.UNKNOWN, source: src, ioType: r.io_type || "", ioAddress: r.io_address || "", docRef: r.doc_ref || "" };
    rec.originalExamples.add(String(r.tag).trim());
    if (r.original_tag_examples) r.original_tag_examples.split(",").forEach((t) => rec.originalExamples.add(String(t).trim()));
    byNorm.set(norm, rec);
  }

  // From I/O list
  for (const e of ioEntries) {
    const norm = normalizeTagForRegistry(e.tag);
    if (!norm) continue;
    const rec = byNorm.get(norm);
    if (rec) {
      rec.source = rec.source === "CE" ? SOURCE.BOTH : SOURCE.BOTH;
      rec.originalExamples.add(String(e.tag).trim());
      rec.ioType = rec.ioType || e.ioType || "";
      rec.ioAddress = rec.ioAddress || e.ioAddress || "";
      rec.class = rec.class === TAG_CLASS.UNKNOWN ? inferIoClass(e) : rec.class;
    } else {
      byNorm.set(norm, {
        originalExamples: new Set([String(e.tag).trim()]),
        class: inferIoClass(e),
        source: SOURCE.IO,
        ioType: e.ioType || "",
        ioAddress: e.ioAddress || "",
        docRef: "",
      });
    }
  }

  // From C&E
  const addCeTag = (rawTag) => {
    const norm = normalizeTagForRegistry(rawTag);
    if (!norm) return;
    const rec = byNorm.get(norm);
    if (rec) {
      rec.source = rec.source === "IO" ? SOURCE.BOTH : SOURCE.BOTH;
      rec.originalExamples.add(String(rawTag).trim());
    } else {
      byNorm.set(norm, {
        originalExamples: new Set([String(rawTag).trim()]),
        class: TAG_CLASS.UNKNOWN,
        source: SOURCE.CE,
        ioType: "",
        ioAddress: "",
        docRef: "",
      });
    }
  };
  for (const rule of ceRules) {
    for (const c of rule.causes || []) addCeTag(c);
    for (const e of rule.effects || []) addCeTag(e);
  }

  const registryTags = Array.from(byNorm.keys());
  return registryTags.map((tag) => {
    const r = byNorm.get(tag);
    return {
      tag,
      original_tag_examples: Array.from(r.originalExamples).slice(0, 20).join(","),
      class: r.class,
      source: r.source,
      io_type: r.ioType || "",
      io_address: r.ioAddress || "",
      doc_ref: r.docRef || "",
    };
  });
}

// --- Step 3A: C&E → I/O cross-reference (gaps) ---
/**
 * Expands rules into one row per (cause, effect) pair. ce_row_id = rule index (0-based).
 */
export function generateCeXrefReport(ceRules, registry) {
  const regMap = new Map(registry.map((r) => [r.tag, r]));
  const registryTags = registry.map((r) => r.tag);
  const rows = [];

  ceRules.forEach((rule, ceRowId) => {
    const causes = rule.causes || [];
    const effects = rule.effects || [];
    if (!causes.length || !effects.length) return;
    for (const causeRaw of causes) {
      for (const effectRaw of effects) {
        const causeTag = normalizeTagForRegistry(causeRaw);
        const effectTag = normalizeTagForRegistry(effectRaw);
        const causeRec = regMap.get(causeTag);
        const effectRec = regMap.get(effectTag);
        const causeInRegistry = !!causeRec;
        const effectInRegistry = !!effectRec;
        let missingReason = MISSING_REASON.OK;
        if (!causeInRegistry && !effectInRegistry) missingReason = MISSING_REASON.BOTH_MISSING;
        else if (!causeInRegistry) missingReason = MISSING_REASON.CAUSE_MISSING;
        else if (!effectInRegistry) missingReason = MISSING_REASON.EFFECT_MISSING;
        const suggested_match = causeInRegistry && effectInRegistry ? "" : [causeInRegistry ? "" : bestFuzzyMatch(causeTag, registryTags), effectInRegistry ? "" : bestFuzzyMatch(effectTag, registryTags)].filter(Boolean).join("; ") || "";
        rows.push({
          ce_row_id: ceRowId + 1,
          cause_tag: causeTag || String(causeRaw),
          effect_tag: effectTag || String(effectRaw),
          cause_in_registry: causeInRegistry ? "Y" : "N",
          cause_class: causeRec ? causeRec.class : "",
          effect_in_registry: effectInRegistry ? "Y" : "N",
          effect_class: effectRec ? effectRec.class : "",
          missing_reason: missingReason,
          suggested_match: suggested_match || "",
        });
      }
    }
  });

  const order = [MISSING_REASON.BOTH_MISSING, MISSING_REASON.CAUSE_MISSING, MISSING_REASON.EFFECT_MISSING, MISSING_REASON.OK];
  rows.sort((a, b) => order.indexOf(a.missing_reason) - order.indexOf(b.missing_reason));
  return rows;
}

// --- Step 3B: I/O → C&E orphans ---
function inferUsageCategory(entry, inCe, registryClass) {
  if (registryClass === TAG_CLASS.SPARE_FUTURE) return USAGE_CATEGORY.SPARE_FUTURE;
  if (registryClass === TAG_CLASS.REMOVE) return USAGE_CATEGORY.REMOVE;
  if (inCe) return USAGE_CATEGORY.AUTO_ACTION; // default for CE-referenced; could refine to PERMISSIVE if needed
  const tag = String(entry.tag || "").toUpperCase();
  const remark = String(entry.remark || "").toUpperCase();
  const service = String(entry.service || "").toUpperCase();
  if (/SPARE|FUTURE|RESERVED/i.test(remark) || /SPARE|FUTURE/i.test(tag)) return USAGE_CATEGORY.SPARE_FUTURE;
  if (/COMMS|HEARTBEAT|WATCHDOG|DIAG/i.test(tag) || /COMMS|HEARTBEAT|DIAG/i.test(service)) return USAGE_CATEGORY.MAINT_DIAG;
  if (entry.ioType === "AI" || entry.ioType === "AO") return USAGE_CATEGORY.MONITORING;
  return USAGE_CATEGORY.INDICATION_ONLY; // default orphan: status/feedback
}

/**
 * @param {Array<object>} ioEntries
 * @param {Set<string>} ceTagSet normalized tags that appear in C&E
 * @param {Array<object>} registry
 */
export function generateIoXrefReport(ioEntries, ceTagSet, registry) {
  const regMap = new Map(registry.map((r) => [r.tag, r]));
  const rows = ioEntries.map((e) => {
    const norm = normalizeTagForRegistry(e.tag);
    const inCe = ceTagSet.has(norm);
    const rec = regMap.get(norm);
    const usage_category = inferUsageCategory(e, inCe, rec ? rec.class : TAG_CLASS.PHYSICAL_IO);
    return {
      io_tag: norm || e.tag,
      io_type: e.ioType || "",
      io_address: e.ioAddress || "",
      appears_in_ce: inCe ? "Y" : "N",
      usage_category,
      rationale_if_not_in_ce: inCe ? "" : usage_category === USAGE_CATEGORY.INDICATION_ONLY ? "Indication/feedback only" : usage_category === USAGE_CATEGORY.MONITORING ? "Monitoring/trending only" : usage_category === USAGE_CATEGORY.MAINT_DIAG ? "Comms/diagnostic" : usage_category === USAGE_CATEGORY.SPARE_FUTURE ? "Spare/future" : "",
      doc_reference: "",
    };
  });
  rows.sort((a, b) => {
    const unk = (x) => (x.usage_category === USAGE_CATEGORY.UNKNOWN ? 0 : 1);
    if (unk(a) !== unk(b)) return unk(a) - unk(b);
    const autoNotInCe = (x) => (x.appears_in_ce === "N" && (x.usage_category === USAGE_CATEGORY.AUTO_ACTION || x.usage_category === USAGE_CATEGORY.PERMISSIVE) ? 0 : 1);
    if (autoNotInCe(a) !== autoNotInCe(b)) return autoNotInCe(a) - autoNotInCe(b);
    return 0;
  });
  return rows;
}

/** Get set of normalized tags that appear in C&E (causes or effects). */
export function getCeTagSet(ceRules) {
  const set = new Set();
  for (const rule of ceRules) {
    for (const c of rule.causes || []) set.add(normalizeTagForRegistry(c));
    for (const e of rule.effects || []) set.add(normalizeTagForRegistry(e));
  }
  return set;
}

// --- Step 4: Exceptions resolution log (structure; resolutions filled by user or policy) ---
/**
 * Build initial exceptions from registry + reports. Resolution/notes can be filled later.
 */
export function buildExceptionsResolutionLog(ceXrefRows, ioXrefRows, registry) {
  const log = [];
  const seen = new Set();
  let changeId = 0;

  for (const row of ceXrefRows) {
    if (row.missing_reason === MISSING_REASON.OK) continue;
    for (const t of [row.cause_tag, row.effect_tag]) {
      if (!t || seen.has(t)) continue;
      const inIo = registry.some((r) => r.tag === t && (r.source === SOURCE.IO || r.source === SOURCE.BOTH));
      const inCe = registry.some((r) => r.tag === t && (r.source === SOURCE.CE || r.source === SOURCE.BOTH));
      seen.add(t);
      changeId += 1;
      log.push({
        tag: t,
        found_in: inCe && inIo ? "BOTH" : inCe ? "CE" : "IO",
        issue_type: !inIo && inCe ? "CE_REF_NOT_IN_IO" : "NAMING_MISMATCH",
        resolution: "",
        notes: "",
        changed_files: "",
        change_id: changeId,
      });
    }
  }

  for (const row of ioXrefRows) {
    if (row.appears_in_ce === "Y" && row.usage_category !== USAGE_CATEGORY.UNKNOWN) continue;
    if (row.usage_category === USAGE_CATEGORY.UNKNOWN) {
      if (seen.has(row.io_tag)) continue;
      seen.add(row.io_tag);
      changeId += 1;
      log.push({
        tag: row.io_tag,
        found_in: "IO",
        issue_type: "IO_ORPHAN",
        resolution: "",
        notes: "",
        changed_files: "",
        change_id: changeId,
      });
    }
  }

  // CE tags with class UNKNOWN must be triaged (CLASSIFY_SOFT or ADD_TO_IO, etc.)
  for (const r of registry) {
    if (r.class !== TAG_CLASS.UNKNOWN || r.source === SOURCE.IO) continue;
    if (seen.has(r.tag)) continue;
    seen.add(r.tag);
    changeId += 1;
    log.push({
      tag: r.tag,
      found_in: r.source === SOURCE.CE ? "CE" : "BOTH",
      issue_type: "CE_REF_NOT_IN_IO",
      resolution: "",
      notes: "Class UNKNOWN: triage as SOFT_DERIVED or add to I/O",
      changed_files: "",
      change_id: changeId,
    });
  }

  return log;
}

// --- Step 5: Validation ---
export function runValidations(registry, ceRules, ioXrefReport) {
  const regMap = new Map(registry.map((r) => [r.tag, r]));
  const ceTagSet = getCeTagSet(ceRules);
  const violations = [];

  // 1) Every C&E tag must exist in tag registry
  for (const tag of ceTagSet) {
    if (!tag) continue;
    if (!regMap.has(tag)) violations.push({ rule: "CE_TAG_IN_REGISTRY", message: `C&E tag '${tag}' not in registry`, tag });
  }

  // 2) Every C&E tag must be classed as PHYSICAL_IO or SOFT_DERIVED (not UNKNOWN)
  for (const tag of ceTagSet) {
    if (!tag) continue;
    const r = regMap.get(tag);
    if (r && r.class === TAG_CLASS.UNKNOWN) violations.push({ rule: "CE_TAG_CLASSED", message: `C&E tag '${tag}' has class UNKNOWN`, tag });
  }

  // 3) Any PHYSICAL_IO with usage_category AUTO_ACTION or PERMISSIVE must appear in C&E
  for (const row of ioXrefReport) {
    if (regMap.get(row.io_tag)?.class !== TAG_CLASS.PHYSICAL_IO) continue;
    if ((row.usage_category === USAGE_CATEGORY.AUTO_ACTION || row.usage_category === USAGE_CATEGORY.PERMISSIVE) && row.appears_in_ce !== "Y")
      violations.push({ rule: "PHYSICAL_IO_AUTO_IN_CE", message: `PHYSICAL_IO '${row.io_tag}' has AUTO_ACTION/PERMISSIVE but not in C&E`, tag: row.io_tag });
  }

  // 4) Any PHYSICAL_IO not in C&E must have non-empty rationale_if_not_in_ce
  for (const row of ioXrefReport) {
    if (regMap.get(row.io_tag)?.class !== TAG_CLASS.PHYSICAL_IO) continue;
    if (row.appears_in_ce === "N" && !String(row.rationale_if_not_in_ce || "").trim())
      violations.push({ rule: "PHYSICAL_IO_RATIONALE", message: `PHYSICAL_IO '${row.io_tag}' not in C&E but rationale empty`, tag: row.io_tag });
  }

  // 5) No duplicate normalized tags with conflicting IO types/addresses
  const byTag = new Map();
  for (const r of registry) {
    if (r.source === SOURCE.CE || !r.io_type) continue;
    const key = r.tag;
    const val = `${r.io_type}|${r.io_address || ""}`;
    if (byTag.has(key) && byTag.get(key) !== val) violations.push({ rule: "NO_CONFLICTING_IO", message: `Tag '${key}' has conflicting IO type/address`, tag: key });
    else byTag.set(key, val);
  }

  const pass = violations.length === 0;
  return { pass, violations };
}

// --- Step 6: Clean outputs ---
/**
 * Enrich IO entries with normalized_tag, appears_in_ce, usage_category, rationale_if_not_in_ce, doc_reference from ioXrefReport.
 */
export function buildIoListClean(ioEntries, ioXrefReport) {
  const xrefByNorm = new Map(ioXrefReport.map((r) => [r.io_tag, r]));
  return ioEntries.map((e) => {
    const norm = normalizeTagForRegistry(e.tag);
    const xref = xrefByNorm.get(norm) || {};
    return {
      ...e,
      normalized_tag: norm,
      appears_in_ce: xref.appears_in_ce || "N",
      usage_category: xref.usage_category || USAGE_CATEGORY.UNKNOWN,
      rationale_if_not_in_ce: xref.rationale_if_not_in_ce || "",
      doc_reference: xref.doc_reference || "",
    };
  });
}

/**
 * Enrich CE rules with normalized cause/effect and class from registry.
 */
export function buildCauseEffectClean(ceRules, registry) {
  const regMap = new Map(registry.map((r) => [r.tag, r]));
  return ceRules.map((rule) => {
    const causes = rule.causes || [];
    const effects = rule.effects || [];
    const normCauses = causes.map((c) => normalizeTagForRegistry(c));
    const normEffects = effects.map((e) => normalizeTagForRegistry(e));
    const causeClass = normCauses.map((t) => regMap.get(t)?.class || "").join(";");
    const effectClass = normEffects.map((t) => regMap.get(t)?.class || "").join(";");
    return {
      ...rule,
      normalized_cause_tag: normCauses.join(";"),
      normalized_effect_tag: normEffects.join(";"),
      cause_class: causeClass,
      effect_class: effectClass,
    };
  });
}

// --- Full pipeline ---
/**
 * Run full pipeline: registry -> CE xref -> IO xref -> exceptions log -> validation -> clean outputs.
 * Inputs: ceRules (from cause_effect_parser), ioEntries (from io_list_parser), optional existingRegistry (array of rows).
 * Returns object with all artifacts for writing to files.
 */
export function runTraceabilityPipeline(ceRules, ioEntries, existingRegistry = []) {
  const registry = buildTagRegistry(ceRules, ioEntries, existingRegistry);
  const ceTagSet = getCeTagSet(ceRules);
  const ceXrefReport = generateCeXrefReport(ceRules, registry);
  const ioXrefReport = generateIoXrefReport(ioEntries, ceTagSet, registry);
  const exceptionsLog = buildExceptionsResolutionLog(ceXrefReport, ioXrefReport, registry);
  const validation = runValidations(registry, ceRules, ioXrefReport);
  const ioListClean = buildIoListClean(ioEntries, ioXrefReport);
  const causeEffectClean = buildCauseEffectClean(ceRules, registry);

  return {
    tag_registry_master: registry,
    ce_xref_report: ceXrefReport,
    io_xref_report: ioXrefReport,
    exceptions_resolution_log: exceptionsLog,
    validation_results: { pass: validation.pass, violations: validation.violations },
    io_list_clean: ioListClean,
    cause_effect_clean: causeEffectClean,
  };
}

/** Escape a CSV field (quotes and commas). */
function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convert array of objects to CSV string (first object's keys = header). */
export function rowsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

export { TAG_CLASS, SOURCE, MISSING_REASON, USAGE_CATEGORY };
