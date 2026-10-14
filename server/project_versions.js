/**
 * Change control: local project snapshots + diff view.
 * Store under server/data/snapshots/<timestamp>_<label>/
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listSnapshotDirs() {
  ensureDir(SNAPSHOTS_DIR);
  const names = fs.readdirSync(SNAPSHOTS_DIR);
  const dirs = [];
  for (const n of names) {
    const full = path.join(SNAPSHOTS_DIR, n);
    if (fs.statSync(full).isDirectory()) dirs.push({ id: n, path: full });
  }
  return dirs.sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Create a snapshot. bundle = { pidElements?, ioListEntries?, causeEffectRules? }; ir, validation as returned from import/validate.
 * @returns { { id, label, createdAt, path } }
 */
export function createSnapshot({ label = "", bundle = {}, ir = null, validation = null }) {
  ensureDir(SNAPSHOTS_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeLabel = (label || "snapshot").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const dirName = `${ts}_${safeLabel}`;
  const dirPath = path.join(SNAPSHOTS_DIR, dirName);
  fs.mkdirSync(dirPath, { recursive: true });

  if (bundle.pidElements) {
    fs.writeFileSync(path.join(dirPath, "pidElements.json"), JSON.stringify(bundle.pidElements, null, 2));
  }
  if (bundle.ioListEntries) {
    fs.writeFileSync(path.join(dirPath, "ioList.json"), JSON.stringify(bundle.ioListEntries, null, 2));
  }
  if (bundle.causeEffectRules) {
    fs.writeFileSync(path.join(dirPath, "causeEffect.json"), JSON.stringify(bundle.causeEffectRules, null, 2));
  }
  if (ir) {
    fs.writeFileSync(path.join(dirPath, "ir.json"), JSON.stringify(ir, null, 2));
  }
  const ioMap = ir?.ioMap || {};
  fs.writeFileSync(path.join(dirPath, "ioMap.json"), JSON.stringify(ioMap, null, 2));
  if (validation) {
    fs.writeFileSync(path.join(dirPath, "validation.json"), JSON.stringify(validation, null, 2));
  }

  const meta = {
    id: dirName,
    label: safeLabel,
    createdAt: new Date().toISOString(),
    path: dirPath
  };
  fs.writeFileSync(path.join(dirPath, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * List all snapshots (meta only).
 * @returns {Array<{ id, label, createdAt }>}
 */
export function listSnapshots() {
  const dirs = listSnapshotDirs();
  const out = [];
  for (const { id, path: dirPath } of dirs) {
    const metaPath = path.join(dirPath, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        out.push({ id: meta.id || id, label: meta.label, createdAt: meta.createdAt });
      } catch {
        out.push({ id, label: id, createdAt: null });
      }
    } else {
      out.push({ id, label: id, createdAt: null });
    }
  }
  return out;
}

function readJsonSafe(filePath, defaultVal = null) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {}
  return defaultVal;
}

/**
 * Get one snapshot by id (full meta + artifacts paths).
 */
export function getSnapshot(id) {
  const dirPath = path.join(SNAPSHOTS_DIR, id);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null;
  const meta = readJsonSafe(path.join(dirPath, "meta.json"), { id, label: id, createdAt: null });
  const pidElements = readJsonSafe(path.join(dirPath, "pidElements.json"));
  const ioList = readJsonSafe(path.join(dirPath, "ioList.json"));
  const causeEffect = readJsonSafe(path.join(dirPath, "causeEffect.json"));
  const ir = readJsonSafe(path.join(dirPath, "ir.json"));
  const ioMap = readJsonSafe(path.join(dirPath, "ioMap.json"), {});
  const validation = readJsonSafe(path.join(dirPath, "validation.json"));
  return {
    ...meta,
    pidElements,
    ioListEntries: ioList,
    causeEffectRules: causeEffect,
    ir,
    ioMap,
    validation
  };
}

/**
 * Diff two snapshots: tags added/removed/renamed, C&E rules added/removed/changed, IR change counts, safety config diffs.
 * @returns { { tagsAdded, tagsRemoved, tagsChanged, ceAdded, ceRemoved, ceChanged, irStatsA, irStatsB, safetyDiff } }
 */
export function diffSnapshots(idA, idB) {
  const a = getSnapshot(idA);
  const b = getSnapshot(idB);
  if (!a || !b) return null;

  const tagsA = new Set(Object.keys(a.ioMap || {}));
  const tagsB = new Set(Object.keys(b.ioMap || {}));
  const tagsAdded = [...tagsB].filter((t) => !tagsA.has(t));
  const tagsRemoved = [...tagsA].filter((t) => !tagsB.has(t));
  const tagsChanged = [];
  for (const t of tagsA) {
    if (tagsB.has(t) && a.ioMap[t] !== b.ioMap[t]) tagsChanged.push({ tag: t, addrA: a.ioMap[t], addrB: b.ioMap[t] });
  }

  const ceA = (a.causeEffectRules || []).map((r) => JSON.stringify({ c: (r.causes || []).sort(), e: (r.effects || []).sort() }));
  const ceB = (b.causeEffectRules || []).map((r) => JSON.stringify({ c: (r.causes || []).sort(), e: (r.effects || []).sort() }));
  const setA = new Set(ceA);
  const setB = new Set(ceB);
  const ceAdded = ceB.filter((x) => !setA.has(x)).length;
  const ceRemoved = ceA.filter((x) => !setB.has(x)).length;
  const ceChanged = ceAdded + ceRemoved;

  function irStats(ir) {
    let rungs = 0;
    let nets = 0;
    for (const net of ir?.networks || []) {
      nets++;
      rungs += (net.rungs || []).length;
    }
    return { networks: nets, rungs };
  }
  const irStatsA = irStats(a.ir);
  const irStatsB = irStats(b.ir);

  const safetyA = (a.validation?.mappings?.tagToIoType || {});
  const safetyB = (b.validation?.mappings?.tagToIoType || {});
  const safetyDiff = [];
  for (const tag of new Set([...Object.keys(safetyA), ...Object.keys(safetyB)])) {
    if (safetyA[tag] !== safetyB[tag]) safetyDiff.push({ tag, typeA: safetyA[tag], typeB: safetyB[tag] });
  }

  return {
    tagsAdded,
    tagsRemoved,
    tagsChanged,
    ceAdded,
    ceRemoved,
    ceChanged,
    irStatsA,
    irStatsB,
    safetyDiff
  };
}
