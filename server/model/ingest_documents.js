/**
 * Retain original engineering documents as project-referenced files.
 * Files live under server/data/uploads/<projectId>/ — not decorative-only.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataDir() {
  const cwd = process.cwd();
  if (path.basename(cwd) === "server") return path.join(cwd, "data");
  const fromCwd = path.join(cwd, "server", "data");
  if (fs.existsSync(path.join(cwd, "server")) || fs.existsSync(fromCwd)) return fromCwd;
  return path.join(__dirname, "..", "data");
}

function uploadsRoot() {
  return path.join(dataDir(), "uploads");
}

function safeName(name) {
  return String(name || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
}

/**
 * @param {string} projectId
 * @param {{ buffer: Buffer, originalname?: string, mimetype?: string }} file
 */
export function retainDocumentFile(projectId, file) {
  if (!projectId) throw new Error("projectId required to retain document");
  if (!file?.buffer) throw new Error("file buffer required");
  const dir = path.join(uploadsRoot(), String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const originalName = file.originalname || "document.bin";
  const filename = `${stamp}_${safeName(originalName)}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, file.buffer);
  const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const sourcePath = `uploads/${projectId}/${filename}`;
  return {
    sourcePath,
    absolutePath,
    checksum,
    bytes: file.buffer.length,
    originalName,
    mimeType: file.mimetype || null
  };
}

/** Resolve a retained sourcePath to an absolute filesystem path, or null. */
export function resolveRetainedPath(sourcePath) {
  if (!sourcePath) return null;
  const rel = String(sourcePath).replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (rel.includes("..")) return null;
  const parts = rel.split("/").filter(Boolean);
  if (parts[0] !== "uploads") return null;
  const absolute = path.join(dataDir(), ...parts);
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  return null;
}
