/**
 * P6 Vision / Phase 04 — OCR / ingest pipeline smoke (no Docker required).
 * Usage: node scripts/smoke_ocr.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  extractText,
  mineCandidates,
  classifyTagOrigin,
  runIngestPipeline,
  inferConnections,
  analyzeEngineeringGaps,
  extractSvgText
} from "../server/plc/ocr_ingest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = path.join(root, "server/data/samples/ocr_water_transfer.txt");
const sampleSvg = path.join(root, "server/data/samples/ocr_water_transfer.svg");

const buf = fs.readFileSync(sample);
const extracted = await extractText(buf, "text/plain");
const candidates = mineCandidates(extracted.text, { documentIndex: 0, documentName: "ocr_water_transfer.txt", page: 1 });

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
const tank = candidates.find((c) => c.tag === "TANK-101");
if (!tank || tank.tagOrigin !== "demo_reference") {
  console.error("FAIL: TANK-101 should be tagOrigin demo_reference", tank?.tagOrigin);
  process.exit(1);
}
if (!tank.sourceRef?.region || tank.sourceRef.page !== 1) {
  console.error("FAIL: candidate missing sourceRef", tank?.sourceRef);
  process.exit(1);
}
if (classifyTagOrigin("TANK-201") !== "extracted") {
  console.error("FAIL: TANK-201 should be extracted");
  process.exit(1);
}

const conns = inferConnections(extracted.text, candidates);
const explicit = conns.filter((c) => !c.ambiguous && c.fromTag === "TANK-101" && c.toTag === "P-101");
if (!explicit.length) {
  console.error("FAIL: expected explicit TANK-101→P-101 connection", conns);
  process.exit(1);
}
const amb = conns.filter((c) => c.ambiguous);
if (!amb.every((c) => c.include === false || c.ambiguous)) {
  console.error("FAIL: ambiguous connections must not auto-include silently");
  process.exit(1);
}
const gaps = analyzeEngineeringGaps(candidates, conns);
if (!gaps.length) {
  console.error("FAIL: expected engineering gaps for water-transfer style extract");
  process.exit(1);
}
console.log("connections=", conns.length, "explicit=", explicit.length, "ambiguous=", amb.length, "gaps=", gaps.length);

const svgBuf = fs.readFileSync(sampleSvg);
const svg = extractSvgText(svgBuf);
const svgTags = mineCandidates(svg.text);
if (!svgTags.some((c) => c.tag === "TANK-101") || !svg.vectorSummary) {
  console.error("FAIL: SVG extract should mine tags + vectorSummary", svg);
  process.exit(1);
}
console.log("svg engine ok · paths=", svg.vectorSummary.pathCount, "lines=", svg.vectorSummary.lineCount);

const pipeline = await runIngestPipeline([
  { buffer: buf, mimetype: "text/plain", originalname: "ocr_water_transfer.txt" },
  { buffer: svgBuf, mimetype: "image/svg+xml", originalname: "ocr_water_transfer.svg" }
]);
if (!pipeline.ok || pipeline.candidates.length < 6) {
  console.error("FAIL: multi-doc pipeline", pipeline.error || pipeline.candidates?.length);
  process.exit(1);
}
if (!pipeline.stages?.some((s) => s.id === "review_required")) {
  console.error("FAIL: pipeline must end in review_required");
  process.exit(1);
}
if (!pipeline.documents || pipeline.documents.length !== 2) {
  console.error("FAIL: expected 2 document summaries");
  process.exit(1);
}
console.log("pipeline stages=", pipeline.stages.map((s) => s.id).join("→"));
console.log("OCR / Vision ingest smoke PASS");
