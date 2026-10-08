/**
 * Validation exceptions: in-tool "accept as exception" so findings don't count against score.
 * Stored in memory; optional persist to server/data/validation_exceptions.json.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const FILE_PATH = path.join(DATA_DIR, "validation_exceptions.json");

let list = [];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir(DATA_DIR);
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, "utf8");
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } else list = [];
  } catch (e) {
    list = [];
  }
}

function save() {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(FILE_PATH, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    // ignore
  }
}

function matchFinding(ex, finding) {
  if (ex.rule !== (finding.rule || "")) return false;
  if (ex.tag != null && ex.tag !== "") return ex.tag === (finding.tag != null ? String(finding.tag) : "");
  return true;
}

export function getExceptions() {
  if (list.length === 0) load();
  return [...list];
}

export function addException({ rule, tag, acceptedBy }) {
  if (list.length === 0) load();
  const id = "ex_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  const acceptedAt = new Date().toISOString();
  list.push({
    id,
    rule: String(rule || ""),
    tag: tag != null ? String(tag) : null,
    acceptedAt,
    acceptedBy: acceptedBy != null ? String(acceptedBy).trim() : null
  });
  save();
  return id;
}

export function removeException(id) {
  if (list.length === 0) load();
  const before = list.length;
  list = list.filter((e) => e.id !== id);
  if (list.length < before) save();
  return before > list.length;
}

export function clearExceptions() {
  list = [];
  save();
}

/**
 * For each orphan_io warning (IO in list but not in Cause&Effect), add an exception if not already
 * present so validation speeds up over time and changes are accepted automatically.
 */
export function addOrphanIoExceptions(rawValidation) {
  const warnings = rawValidation?.warnings || [];
  const orphanWarnings = warnings.filter((w) => w.rule === "orphan_io");
  if (orphanWarnings.length === 0) return 0;
  const exceptions = getExceptions();
  let added = 0;
  for (const w of orphanWarnings) {
    if (exceptions.some((ex) => matchFinding(ex, w))) continue;
    addException({ rule: "orphan_io", tag: w.tag != null ? String(w.tag) : "", acceptedBy: "auto" });
    added++;
  }
  return added;
}

export function applyExceptions(rawValidation) {
  const exceptions = getExceptions();
  if (exceptions.length === 0) return rawValidation;
  const errors = (rawValidation.errors || []).filter((f) => !exceptions.some((ex) => matchFinding(ex, f)));
  const warnings = (rawValidation.warnings || []).filter((f) => !exceptions.some((ex) => matchFinding(ex, f)));
  const score = Math.max(0, Math.min(100, 100 - 10 * errors.length - 2 * warnings.length));
  const stats = { ...(rawValidation.stats || {}), errorCount: errors.length, warningCount: warnings.length };
  return { ...rawValidation, errors, warnings, score, stats, ok: errors.length === 0 };
}

load();
