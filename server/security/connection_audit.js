/**
 * Phase 14 — connection / integration audit trail.
 */

import fs from "fs";
import path from "path";

function auditPath() {
  const cwd = process.cwd();
  const base = path.basename(cwd) === "server"
    ? path.join(cwd, "data")
    : path.join(cwd, "server", "data");
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, "connection_audit.jsonl");
}

export function logConnectionEvent(event) {
  const row = {
    at: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(auditPath(), JSON.stringify(row) + "\n", "utf8");
  return row;
}

export function listConnectionEvents({ limit = 100 } = {}) {
  const p = auditPath();
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-Math.max(1, limit)).map((l) => {
    try { return JSON.parse(l); } catch { return { raw: l }; }
  }).reverse();
}
