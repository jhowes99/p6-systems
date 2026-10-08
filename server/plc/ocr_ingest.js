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
      return {
        text,
        confidence,
        engine: "tesseract.js",
        dataClassHint: "ENGINEERING_INFERENCE",
        warning: "OCR candidates require engineer review before approval"
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

/** Naive tag mining with low/medium confidence scores */
export function mineCandidates(text) {
  const candidates = [];
  const seen = new Set();
  // Prefer longer ISA-style prefixes (ESTOP, TANK, LSH, XV) before short ones (P, M)
  const re =
    /\b((?:ESTOP|TANK|LSH|LSL|LT|XV|TK|ES|[A-Z]{1,3})-?\d{2,4}[A-Z]?)\b/gi;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const tag = m[1].toUpperCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    let type = "equipment";
    if (/^ESTOP|^ES\d/i.test(tag)) type = "emergency_stop_input";
    else if (/^TANK|^TK/i.test(tag) || /^T-?\d/i.test(tag)) type = "tank";
    else if (/^LSH|^LSL|^LT/i.test(tag)) type = "level_switch";
    else if (/^XV/i.test(tag) || /^V-?\d/i.test(tag)) type = "valve";
    else if (/^P-?\d/i.test(tag) || /^P\d/.test(tag)) type = "pump";
    else if (/^M-?\d/i.test(tag) || /^M\d/.test(tag)) type = "motor";
    candidates.push({
      tag,
      type,
      confidence: 0.55,
      dataClass: "ENGINEERING_INFERENCE",
      source: "ocr_mine"
    });
  }
  return candidates;
}
