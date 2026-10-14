/**
 * Persist last Verify suite / acceptance results (JSON under server/data/verify).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "verify");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function saveVerifyResults(payload) {
  ensureDir();
  const file = path.join(DATA_DIR, "last_results.json");
  const body = {
    ...payload,
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return body;
}

export function loadVerifyResults() {
  const file = path.join(DATA_DIR, "last_results.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveAcceptanceRun(payload) {
  ensureDir();
  const id = `acceptance_${Date.now()}`;
  const file = path.join(DATA_DIR, `${id}.json`);
  const body = { id, ...payload, savedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  const latest = path.join(DATA_DIR, "last_acceptance.json");
  fs.writeFileSync(latest, JSON.stringify(body, null, 2), "utf8");
  return body;
}

export function loadLastAcceptance() {
  const file = path.join(DATA_DIR, "last_acceptance.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
