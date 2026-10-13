/**
 * Phase 18 — OCR / text extraction for engineering docs.
 * Returns candidates with confidence; never auto-approves.
 */

import { createWorker } from "tesseract.js";

/**
 * @returns {Promise<{ text: string, confidence: number|null, engine: string, warning?: string }>}
 */
export async function extractText(buffer, mimeType = "") {
  const mt = String(mimeType || "").toLowerCase();

  if (mt === "application/pdf" || mt.includes("pdf")) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      const text = data.text || "";
      return {
        text,
        confidence: text.trim() ? 0.85 : 0.2,
        engine: "pdf-parse",
        dataClassHint: "EXTRACTED_FACT"
      };
    } catch (e) {
      return { text: "", confidence: 0, engine: "pdf-parse", warning: String(e?.message || e) };
    }
  }

  if (mt.startsWith("image/") || /\b(png|jpe?g|webp|bmp)\b/.test(mt)) {
    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(buffer);
      const text = result?.data?.text || "";
      const confidence = typeof result?.data?.confidence === "number"
        ? result.data.confidence / 100
        : (text.trim() ? 0.6 : 0.1);
      const unfinished =
        "LIMIT: Scanned image OCR is unfinished — results are ENGINEERING_INFERENCE only; " +
        "empty/low-confidence tags are expected on drawings. Prefer text/PDF/CSV or typed equipment lists.";
      return {
        text,
        confidence,
        engine: "tesseract.js",
        dataClassHint: "ENGINEERING_INFERENCE",
        unfinished: true,
        warning: text.trim()
          ? `${unfinished} Candidates require engineer review before approval.`
          : `${unfinished} No usable text extracted from this image.`
      };
    } finally {
      await worker.terminate();
    }
  }

  if (mt.includes("csv") || mt.includes("text/")) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
    return { text, confidence: 0.9, engine: "utf8", dataClassHint: "EXTRACTED_FACT" };
  }

  throw new Error(`Unsupported mime for OCR ingest: ${mimeType}`);
}

/** Tags that appear in shipped reference demos — flag so engineers can filter training P&IDs. */
export const DEMO_REFERENCE_TAGS = new Set([
  "TANK-101", "TANK-102", "PUMP-101", "VALVE-101", "LT-101", "ESD-101", "FIT-101",
  "P-101", "M-101", "XV-101", "LSH-101", "ESTOP-101"
]);

/**
 * Classify whether a mined tag likely matches a bundled demo fixture vs net-new extraction.
 * @returns {"demo_reference"|"extracted"}
 */
export function classifyTagOrigin(tag) {
  const t = String(tag || "").toUpperCase();
  if (DEMO_REFERENCE_TAGS.has(t)) return "demo_reference";
  return "extracted";
}

/** Naive tag mining with low/medium confidence scores */
export function mineCandidates(text) {
  const candidates = [];
  const seen = new Set();
  // Prefer longer ISA-style prefixes (ESTOP, TANK, LSH, XV) before short ones (P, M)
  const re =
    /\b((?:ESTOP|ESD|PUMP|VALVE|TANK|FIT|LSH|LSL|LT|PT|TT|XV|TK|FT|FE|ES|[A-Z]{1,4})-?\d{2,4}[A-Z]?)\b/gi;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const tag = m[1].toUpperCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    let type = "equipment";
    if (/ESTOP|ESD|^ES\d/i.test(tag)) type = "emergency_stop_input";
    else if (/^TANK|^TK/i.test(tag) || /^T-?\d/i.test(tag)) type = "tank";
    else if (/^FIT|^FT|^FE/i.test(tag)) type = "flow_transmitter";
    else if (/^PT|^PI/i.test(tag)) type = "pressure_transmitter";
    else if (/^TT|^TI/i.test(tag)) type = "temperature_transmitter";
    else if (/^LSH|^LSL|^LT|^LI/i.test(tag)) type = "level_transmitter";
    else if (/^XV|^HV|^FV|^VALVE|^V-?\d/i.test(tag)) type = "valve";
    else if (/^PUMP|^P-?\d|^P\d/i.test(tag)) type = "pump";
    else if (/^MOTOR|^M-?\d|^M\d/i.test(tag)) type = "motor";
    const tagOrigin = classifyTagOrigin(tag);
    candidates.push({
      tag,
      type,
      confidence: tagOrigin === "demo_reference" ? 0.72 : 0.55,
      dataClass: "ENGINEERING_INFERENCE",
      source: "ocr_mine",
      tagOrigin
    });
  }
  return candidates;
}
