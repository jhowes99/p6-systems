/**
 * Phase 18 — OCR / candidate mining smoke (no Docker required).
 * Usage: node scripts/smoke_ocr.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractText, mineCandidates } from "../server/plc/ocr_ingest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = path.join(root, "server/data/samples/ocr_water_transfer.txt");

const buf = fs.readFileSync(sample);
const extracted = await extractText(buf, "text/plain");
const candidates = mineCandidates(extracted.text);

const need = ["P-101", "M-101", "XV-101", "TANK-101", "LSH-101", "ESTOP-101"];
const tags = new Set(candidates.map((c) => c.tag));
const missing = need.filter((t) => !tags.has(t));

console.log("engine=", extracted.engine, "confidence=", extracted.confidence);
console.log("candidates=", candidates.length, candidates.map((c) => c.tag).join(", "));

if (!extracted.text.trim()) {
  console.error("FAIL: empty extract");
  process.exit(1);
}
if (missing.length) {
  console.error("FAIL: missing tags", missing.join(", "));
  process.exit(1);
}
console.log("OCR smoke PASS");
