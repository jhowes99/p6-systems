/**
 * Cross-document OT sanity checks: P&ID ↔ IO List ↔ Cause&Effect.
 * validateProjectBundle({ pidElements, ioListEntries, causeEffectRules }) -> { ok, errors[], warnings[], stats, score, mappings }
 */

import { normalizeTag } from "./doc_normalize.js";

function tagKey(tag) {
  return normalizeTag(tag) || String(tag || "").trim().toUpperCase();
}

function nearDuplicate(a, b) {
  const x = String(a || "").replace(/[-_\s]/g, "").toUpperCase();
  const y = String(b || "").replace(/[-_\s]/g, "").toUpperCase();
  if (x === y) return true;
  // PUMP_01 vs PUMP01
  if (x.replace(/_/g, "") === y.replace(/_/g, "")) return true;
  return false;
}

export function validateProjectBundle({ pidElements = {}, ioListEntries = [], causeEffectRules = [] }) {
  const errors = [];
  const warnings = [];
  const stats = { ioCount: 0, ceRules: 0, pidTags: 0, tagsInCE: 0 };
  const mappings = { tagToIoType: {}, tagToIoEntry: {} };

  const ioEntries = Array.isArray(ioListEntries) ? ioListEntries : [];
  const ceRules = Array.isArray(causeEffectRules) ? causeEffectRules : [];

  // Build tag -> ioType from IO list (handle duplicate tag with different type => error)
  for (const e of ioEntries) {
    const tag = tagKey(e.tag);
    if (!tag) continue;
    stats.ioCount++;
    const ioType = String(e.ioType || "").toUpperCase().replace(/\s/g, "");
    const effective = ["DI", "DO", "AI", "AO"].includes(ioType) ? ioType : "";

    if (mappings.tagToIoType[tag] !== undefined && mappings.tagToIoType[tag] !== effective) {
      errors.push({
        rule: "duplicate_io_type",
        message: `Tag '${tag}' appears in IO list with different IO types: ${mappings.tagToIoType[tag]} and ${effective}.`,
        tag,
        refs: [tag]
      });
    }
    mappings.tagToIoType[tag] = effective;
    if (!mappings.tagToIoEntry[tag]) mappings.tagToIoEntry[tag] = e;
  }

  // Collect all tags referenced in C&E (causes and effects)
  const ceTags = new Set();
  const causeTags = new Set();
  const effectTags = new Set();
  const effectToRules = {}; // effect tag -> [rule indices]

  for (let i = 0; i < ceRules.length; i++) {
    const rule = ceRules[i];
    stats.ceRules++;
    for (const c of rule.causes || []) {
      const t = tagKey(c);
      if (t) {
        ceTags.add(t);
        causeTags.add(t);
      }
    }
    for (const eff of rule.effects || []) {
      const t = tagKey(eff);
      if (t) {
        ceTags.add(t);
        effectTags.add(t);
        if (!effectToRules[t]) effectToRules[t] = [];
        effectToRules[t].push(i);
      }
    }
  }
  stats.tagsInCE = ceTags.size;

  // A) Tag presence: every tag in C&E must exist in IO list (or flag)
  for (const tag of ceTags) {
    if (!mappings.tagToIoType[tag] && !mappings.tagToIoEntry[tag]) {
      errors.push({
        rule: "tag_missing_in_io",
        message: `Tag '${tag}' is referenced in Cause&Effect but not found in IO list.`,
        tag,
        refs: [tag]
      });
    }
  }

  // B) IO type correctness: effects -> DO/AO, causes -> DI/AI (warn if inconsistent)
  for (const tag of effectTags) {
    const ioType = mappings.tagToIoType[tag];
    if (ioType && ioType !== "DO" && ioType !== "AO") {
      warnings.push({
        rule: "effect_should_be_output",
        message: `Effect tag '${tag}' is typed as ${ioType} in IO list; effects typically map to DO or AO.`,
        tag,
        refs: [tag]
      });
    }
  }
  for (const tag of causeTags) {
    const ioType = mappings.tagToIoType[tag];
    if (ioType && ioType !== "DI" && ioType !== "AI") {
      warnings.push({
        rule: "cause_should_be_input",
        message: `Cause tag '${tag}' is typed as ${ioType} in IO list; causes typically map to DI or AI.`,
        tag,
        refs: [tag]
      });
    }
  }

  // C) Multiple C&E rules writing to same effect => warning with references
  for (const [effectTag, indices] of Object.entries(effectToRules)) {
    if (indices.length > 1) {
      warnings.push({
        rule: "multiple_rules_same_effect",
        message: `Multiple Cause&Effect rules write to effect '${effectTag}' (rules: ${indices.map(i => i + 1).join(", ")}).`,
        tag: effectTag,
        refs: indices.map(i => `rule ${i + 1}`)
      });
    }
  }

  // D) Orphan IO: in IO list but not referenced in C&E => warning
  for (const tag of Object.keys(mappings.tagToIoType)) {
    if (!ceTags.has(tag)) {
      warnings.push({
        rule: "orphan_io",
        message: `Tag '${tag}' is in IO list but not referenced in any Cause&Effect rule.`,
        tag,
        refs: [tag]
      });
    }
  }

  // D) Near-duplicate tags (e.g. PUMP_01 vs PUMP01) => warning
  const allTags = [...new Set([...Object.keys(mappings.tagToIoType), ...ceTags])];
  for (let i = 0; i < allTags.length; i++) {
    for (let j = i + 1; j < allTags.length; j++) {
      if (allTags[i] !== allTags[j] && nearDuplicate(allTags[i], allTags[j])) {
        warnings.push({
          rule: "near_duplicate_tag",
          message: `Possible duplicate tag: '${allTags[i]}' vs '${allTags[j]}'.`,
          tag: allTags[i],
          refs: [allTags[i], allTags[j]]
        });
      }
    }
  }

  // E) Safety presence: ESTOP / E-STOP / EMERGENCY should be DI and in input bank
  const safetyPattern = /ESTOP|E-STOP|EMERGENCY/i;
  for (const tag of [...causeTags, ...Object.keys(mappings.tagToIoType)]) {
    if (!safetyPattern.test(tag)) continue;
    const ioType = mappings.tagToIoType[tag];
    if (!ioType) {
      warnings.push({
        rule: "safety_tag_not_in_io",
        message: `Safety-related tag '${tag}' should be in IO list as DI.`,
        tag,
        refs: [tag]
      });
    } else if (ioType !== "DI") {
      errors.push({
        rule: "safety_should_be_di",
        message: `Safety-related tag '${tag}' should be DI (input); found ${ioType}.`,
        tag,
        refs: [tag]
      });
    }
  }

  // Score: 100 - 10*errors - 2*warnings, clamped 0..100
  const score = Math.max(0, Math.min(100, 100 - 10 * errors.length - 2 * warnings.length));
  const ok = errors.length === 0;

  return {
    ok,
    errors,
    warnings,
    stats: {
      ...stats,
      errorCount: errors.length,
      warningCount: warnings.length
    },
    score,
    mappings: {
      tagToIoType: mappings.tagToIoType,
      tagToIoEntry: Object.keys(mappings.tagToIoEntry).length ? mappings.tagToIoEntry : undefined
    }
  };
}

/**
 * Auto-fix validation issues by mutating IO list and/or C&E rules in place.
 * - tag_missing_in_io: add each C&E-referenced tag missing from IO into the IO list (causes -> DI, effects -> DO).
 * - multiple_rules_same_effect: merge all rules that write to the same effect into one rule with OR-of-ANDs (causeGroups).
 * - orphan_io_rules: for each IO in the list not referenced in any C&E rule, create a C&E rule (input -> ORPHAN_CE_EFFECT, ORPHAN_CE_CAUSE -> output) so validation passes and the project is complete.
 * @param {{ ioListEntries: Array, causeEffectRules: Array }} project - mutable project bundle
 * @returns {{ ioListEntries: Array, causeEffectRules: Array, applied: { tag_missing_in_io: string[], multiple_rules_same_effect: Array, orphan_io_rules: Array } }}
 */
export function applyAutoFixes({ ioListEntries = [], causeEffectRules = [] }) {
  const ioEntries = Array.isArray(ioListEntries) ? ioListEntries : [];
  const ceRules = Array.isArray(causeEffectRules) ? [...causeEffectRules] : [];
  const applied = { tag_missing_in_io: [], multiple_rules_same_effect: [], orphan_io_rules: [] };

  const ioTagSet = new Set(ioEntries.map((e) => tagKey(e.tag)).filter(Boolean));

  // Collect cause vs effect usage for each tag (effect wins for ioType when both)
  const tagAsCause = new Set();
  const tagAsEffect = new Set();
  const effectToRuleIndices = {}; // effect tag -> [rule index in ceRules]

  for (let i = 0; i < ceRules.length; i++) {
    const rule = ceRules[i];
    for (const c of rule.causes || []) {
      const t = tagKey(c);
      if (t) tagAsCause.add(t);
    }
    for (const eff of rule.effects || []) {
      const t = tagKey(eff);
      if (t) {
        tagAsEffect.add(t);
        if (!effectToRuleIndices[t]) effectToRuleIndices[t] = [];
        effectToRuleIndices[t].push(i);
      }
    }
  }

  // 1) Add missing tags to IO list (referenced in C&E but not in IO)
  for (const tag of new Set([...tagAsCause, ...tagAsEffect])) {
    if (ioTagSet.has(tag)) continue;
    const ioType = tagAsEffect.has(tag) ? "DO" : "DI";
    ioEntries.push({ tag, ioType });
    ioTagSet.add(tag);
    applied.tag_missing_in_io.push(tag);
  }

  // 2) Merge rules that write to the same effect into one rule per effect (OR-of-ANDs via causeGroups)
  const effectToMergedRule = {}; // effect tag -> { causeGroups, effects }
  const rulesToDrop = new Set(); // rule indices to remove after we've merged into another

  for (const [effectTag, indices] of Object.entries(effectToRuleIndices)) {
    if (indices.length <= 1) continue;
    const groups = [];
    for (const i of indices) {
      const rule = ceRules[i];
      if (Array.isArray(rule.causeGroups) && rule.causeGroups.length > 0) {
        for (const g of rule.causeGroups) groups.push([...(g || []).map((c) => tagKey(c)).filter(Boolean)]);
      } else {
        const causes = (rule.causes || []).map((c) => tagKey(c)).filter(Boolean);
        groups.push(causes.length ? causes : []);
      }
      rulesToDrop.add(i);
    }
    effectToMergedRule[effectTag] = {
      causeGroups: groups,
      effects: [effectTag]
    };
    applied.multiple_rules_same_effect.push({
      effect: effectTag,
      ruleIndices: indices.map((j) => j + 1),
      mergedCauseGroups: groups
    });
  }

  // Build new rule list: keep rules that are not merged; add one merged rule per effect; preserve order where possible
  const mergedRules = [];
  const addedMergedEffects = new Set();

  for (let i = 0; i < ceRules.length; i++) {
    if (rulesToDrop.has(i)) {
      const rule = ceRules[i];
      const effects = (rule.effects || []).map((e) => tagKey(e)).filter(Boolean);
      for (const eff of effects) {
        if (effectToMergedRule[eff] && !addedMergedEffects.has(eff)) {
          mergedRules.push(effectToMergedRule[eff]);
          addedMergedEffects.add(eff);
        }
      }
      continue;
    }
    mergedRules.push(ceRules[i]);
  }

  // Append any merged effect we didn't yet add (e.g. all rules for that effect were at the end)
  for (const [effectTag, merged] of Object.entries(effectToMergedRule)) {
    if (!addedMergedEffects.has(effectTag)) mergedRules.push(merged);
  }

  // 3) Orphan IO: create Cause & Effect rules so each IO is referenced (speeds up validation, keeps project complete)
  const ceTags = new Set();
  for (const rule of mergedRules) {
    if (Array.isArray(rule.causeGroups)) {
      for (const g of rule.causeGroups) {
        for (const c of g || []) ceTags.add(tagKey(c));
      }
    }
    for (const c of rule.causes || []) ceTags.add(tagKey(c));
    for (const e of rule.effects || []) ceTags.add(tagKey(e));
  }
  const tagToIoType = {};
  for (const e of ioEntries) {
    const t = tagKey(e.tag);
    if (t) tagToIoType[t] = String(e.ioType || "").toUpperCase().replace(/\s/g, "") || "";
  }
  const PLACEHOLDER_CAUSE = "ORPHAN_CE_CAUSE";
  const PLACEHOLDER_EFFECT = "ORPHAN_CE_EFFECT";
  const orphans = Object.keys(tagToIoType).filter((t) => !ceTags.has(t));
  let needPlaceholderCause = false;
  let needPlaceholderEffect = false;
  for (const tag of orphans) {
    const ioType = tagToIoType[tag];
    if (ioType === "DO" || ioType === "AO") {
      mergedRules.push({ causes: [PLACEHOLDER_CAUSE], effects: [tag], placeholder: true });
      applied.orphan_io_rules.push({ tag, role: "effect", rule: { causes: [PLACEHOLDER_CAUSE], effects: [tag] } });
      needPlaceholderCause = true;
    } else {
      mergedRules.push({ causes: [tag], effects: [PLACEHOLDER_EFFECT], placeholder: true });
      applied.orphan_io_rules.push({ tag, role: "cause", rule: { causes: [tag], effects: [PLACEHOLDER_EFFECT] } });
      needPlaceholderEffect = true;
    }
  }
  if (needPlaceholderCause && !ioTagSet.has(PLACEHOLDER_CAUSE)) {
    ioEntries.push({ tag: PLACEHOLDER_CAUSE, ioType: "DI" });
    ioTagSet.add(PLACEHOLDER_CAUSE);
  }
  if (needPlaceholderEffect && !ioTagSet.has(PLACEHOLDER_EFFECT)) {
    ioEntries.push({ tag: PLACEHOLDER_EFFECT, ioType: "DO" });
    ioTagSet.add(PLACEHOLDER_EFFECT);
  }

  return {
    ioListEntries: ioEntries,
    causeEffectRules: mergedRules,
    applied
  };
}
