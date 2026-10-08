import fs from "fs";
import path from "path";
import crypto from "crypto";

// Lightweight audit log (OT-friendly trace).
// - In-memory ring buffer
// - Best-effort append to server/audit.log (JSONL) for local debugging
// - Tamper-evident: prevHash + hash chain (sha256)

const MAX = 400;
const events = [];
let lastHash = "0";

const LOG_PATH = path.join(process.cwd(), "server", "audit.log");

function safeWrite(line) {
  try {
    fs.appendFile(LOG_PATH, line + "\n", () => {});
  } catch {
    // ignore
  }
}

function chainHash(prevHash, ev) {
  const payload = prevHash + JSON.stringify({ at: ev.at, type: ev.type, data: ev.data });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function audit(type, data = {}) {
  const ev = {
    at: new Date().toISOString(),
    type: String(type || "event"),
    data: data && typeof data === "object" ? data : { value: data }
  };
  ev.prevHash = lastHash;
  ev.hash = chainHash(lastHash, ev);
  lastHash = ev.hash;
  events.push(ev);
  if (events.length > MAX) events.shift();
  safeWrite(JSON.stringify(ev));
  return ev;
}

export function listAudit({ limit = 200 } = {}) {
  const n = Math.max(1, Math.min(400, Number(limit || 200)));
  return events.slice(-n);
}

/** Verify audit log chain; returns { ok, lastHash, brokenAt? } */
export function verifyAuditChain() {
  let prev = "0";
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const expected = chainHash(prev, ev);
    if (ev.hash !== expected) {
      return { ok: false, lastHash: prev, brokenAt: i, expected, got: ev.hash };
    }
    prev = ev.hash;
  }
  return { ok: true, lastHash: prev };
}

