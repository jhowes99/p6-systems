/**
 * Commissioning packet log: save each downloaded packet to disk and keep a manifest
 * so users can re-download a previous packet after the project is reset.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const PACKETS_DIR = path.join(DATA_DIR, "commissioning_packets");
const LOG_FILE = path.join(DATA_DIR, "commissioning_packet_log.json");
const MAX_ENTRIES = 50;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadLog() {
  try {
    ensureDir(DATA_DIR);
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, "utf8");
      const data = JSON.parse(raw);
      return Array.isArray(data.entries) ? data.entries : [];
    }
  } catch (e) {
    // ignore
  }
  return [];
}

function saveLog(entries) {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(LOG_FILE, JSON.stringify({ entries }, null, 2), "utf8");
  } catch (e) {
    // ignore
  }
}

/**
 * Save a packet to disk and append to the log.
 * @param {{ buffer: Buffer, filename?: string, projectName?: string }} opts
 * @returns {{ id: string, createdAt: string, filename: string, size: number, projectName?: string }}
 */
export function logPacket(opts) {
  const { buffer, filename: suggestedName, projectName } = opts || {};
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("logPacket requires a buffer");

  ensureDir(PACKETS_DIR);
  const id = "pkt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  const filename = suggestedName || "commissioning_packet_" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".zip";
  const filePath = path.join(PACKETS_DIR, id + ".zip");
  fs.writeFileSync(filePath, buffer, "binary");

  const createdAt = new Date().toISOString();
  const entry = { id, createdAt, filename, size: buffer.length, projectName: projectName || null };

  const entries = loadLog();
  entries.unshift(entry);
  const trimmed = entries.slice(0, MAX_ENTRIES);
  saveLog(trimmed);

  // Remove old files that fell off the log
  const keptIds = new Set(trimmed.map((e) => e.id));
  try {
    const files = fs.readdirSync(PACKETS_DIR);
    for (const f of files) {
      const base = path.basename(f, ".zip");
      if (base.startsWith("pkt_") && !keptIds.has(base)) {
        try { fs.unlinkSync(path.join(PACKETS_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) {}

  return entry;
}

/**
 * List recent packets (newest first).
 * @returns {{ id: string, createdAt: string, filename: string, size: number, projectName?: string }[]}
 */
export function listPackets() {
  return loadLog();
}

/**
 * Get the file path for a packet id (if it exists).
 * @param {string} id
 * @returns {string|null}
 */
export function getPacketPath(id) {
  if (!id || typeof id !== "string") return null;
  if (!/^pkt_[a-zA-Z0-9_-]+$/.test(id)) return null;
  const filePath = path.join(PACKETS_DIR, id + ".zip");
  return fs.existsSync(filePath) ? filePath : null;
}
