/**
 * P6 Vision / Phase 04 — engineering document extract.
 * Returns candidates with confidence + source refs; never auto-approves.
 * Image OCR remains unfinished (KI-003) — labeled honestly.
 */

import { createWorker } from "tesseract.js";

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

function normalizeMime(mimeType = "", filename = "") {
  const mt = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  if (mt.includes("pdf") || name.endsWith(".pdf")) return "application/pdf";
  if (mt.includes("svg") || name.endsWith(".svg")) return "image/svg+xml";
  if (mt.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/.test(name)) {
    if (name.endsWith(".png")) return "image/png";
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    return mt.startsWith("image/") ? mt : "image/png";
  }
  if (mt.includes("csv") || name.endsWith(".csv")) return "text/csv";
  if (mt.includes("text/") || /\.(txt|md)$/.test(name)) return "text/plain";
  return mt || "application/octet-stream";
}

/** Split PDF/text into pages using form-feed when present; otherwise single page. */
export function splitPages(text) {
  const raw = String(text || "");
  if (!raw.includes("\f")) {
    return [{ page: 1, text: raw }];
  }
  return raw
    .split("\f")
    .map((t, i) => ({ page: i + 1, text: t }))
    .filter((p) => p.text.trim().length || p.page === 1);
}

/** Extract text nodes from SVG (vector-friendly path; no raster OCR). */
export function extractSvgText(buffer) {
  const xml = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  const chunks = [];
  const textRe = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = textRe.exec(xml)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (inner) chunks.push(inner);
  }
  const titleRe = /<(?:title|desc)\b[^>]*>([\s\S]*?)<\/(?:title|desc)>/gi;
  while ((m = titleRe.exec(xml)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (inner) chunks.push(inner);
  }
  // Bare tag-like strings in the markup (e.g. id="TANK-101")
  const attrTags = xml.match(/\b(?:ESTOP|ESD|PUMP|VALVE|TANK|FIT|LSH|LSL|LT|PT|TT|XV|TK|FT|FE|ES|[A-Z]{1,4})-?\d{2,4}[A-Z]?\b/gi) || [];
  for (const t of attrTags) chunks.push(t.toUpperCase());
  const text = [...new Set(chunks)].join("\n");
  const pathCount = (xml.match(/<path\b/gi) || []).length;
  const lineCount = (xml.match(/<line\b/gi) || []).length;
  return {
    text,
    confidence: text.trim() ? 0.8 : 0.15,
    engine: "svg-text",
    dataClassHint: "EXTRACTED_FACT",
    vectorSummary: {
      pathCount,
      lineCount,
      textNodes: chunks.length,
      note: "SVG text/id mining only — geometry→topology mapping unfinished"
    }
  };
}

/**
 * @returns {Promise<{ text: string, confidence: number|null, engine: string, warning?: string, unfinished?: boolean, pages?: Array, vectorSummary?: object }>}
 */
export async function extractText(buffer, mimeType = "", filename = "") {
  const mt = normalizeMime(mimeType, filename);

  if (mt === "application/pdf" || mt.includes("pdf")) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      const text = data.text || "";
      const pages = splitPages(text);
      const numpages = data.numpages || pages.length || 1;
      return {
        text,
        confidence: text.trim() ? 0.85 : 0.2,
        engine: "pdf-parse",
        dataClassHint: "EXTRACTED_FACT",
        pageCount: numpages,
        pages: pages.length ? pages : [{ page: 1, text }],
        warning: text.trim()
          ? undefined
          : "PDF contained no extractable text (likely scanned). Image OCR unfinished — export pages as PNG/JPEG or use text/CSV."
      };
    } catch (e) {
      return { text: "", confidence: 0, engine: "pdf-parse", warning: String(e?.message || e), pages: [] };
    }
  }

  if (mt.includes("svg") || (filename || "").toLowerCase().endsWith(".svg")) {
    const svg = extractSvgText(buffer);
    return {
      ...svg,
      pageCount: 1,
      pages: [{ page: 1, text: svg.text }]
    };
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
        pageCount: 1,
        pages: [{ page: 1, text }],
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
    return {
      text,
      confidence: 0.9,
      engine: "utf8",
      dataClassHint: "EXTRACTED_FACT",
      pageCount: 1,
      pages: [{ page: 1, text }]
    };
  }

  throw new Error(`Unsupported mime for OCR ingest: ${mimeType || filename || "unknown"}`);
}

function classifyTagType(tag) {
  const t = String(tag || "").toUpperCase();
  if (/ESTOP|ESD|^ES\d/i.test(t)) return "emergency_stop_input";
  if (/^TANK|^TK/i.test(t) || /^T-?\d/i.test(t)) return "tank";
  if (/^FIT|^FT|^FE/i.test(t)) return "flow_transmitter";
  if (/^PT|^PI/i.test(t)) return "pressure_transmitter";
  if (/^TT|^TI/i.test(t)) return "temperature_transmitter";
  if (/^LSH|^LSL|^LT|^LI/i.test(t)) return "level_transmitter";
  if (/^XV|^HV|^FV|^VALVE|^V-?\d/i.test(t)) return "valve";
  if (/^PUMP|^P-?\d|^P\d/i.test(t)) return "pump";
  if (/^MOTOR|^M-?\d|^M\d/i.test(t)) return "motor";
  return "equipment";
}

/**
 * Mine equipment/instrument tag candidates with source references.
 * @param {string} text
 * @param {{ documentIndex?: number, documentName?: string, page?: number }} meta
 */
export function mineCandidates(text, meta = {}) {
  const candidates = [];
  const seen = new Set();
  const re =
    /\b((?:ESTOP|ESD|PUMP|VALVE|TANK|FIT|LSH|LSL|LT|PT|TT|XV|TK|FT|FE|ES|[A-Z]{1,4})-?\d{2,4}[A-Z]?)\b/gi;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const tag = m[1].toUpperCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    const type = classifyTagType(tag);
    const tagOrigin = classifyTagOrigin(tag);
    const start = m.index;
    const end = start + m[1].length;
    const lineStart = Math.max(0, (text || "").lastIndexOf("\n", start) + 1);
    const lineEnd = (() => {
      const n = (text || "").indexOf("\n", end);
      return n < 0 ? (text || "").length : n;
    })();
    const excerpt = String(text || "").slice(lineStart, lineEnd).trim().slice(0, 160);
    candidates.push({
      id: `cand-${tag}-${meta.documentIndex ?? 0}-${start}`,
      tag,
      type,
      classification: type,
      confidence: tagOrigin === "demo_reference" ? 0.72 : 0.55,
      uncertainty: tagOrigin === "demo_reference" ? "demo_fixture_match" : "pattern_match_unverified",
      dataClass: "ENGINEERING_INFERENCE",
      source: "ocr_mine",
      tagOrigin,
      status: "proposed",
      include: false,
      sourceRef: {
        documentIndex: meta.documentIndex ?? 0,
        documentName: meta.documentName || null,
        page: meta.page ?? 1,
        region: { start, end },
        excerpt
      }
    });
  }
  return candidates;
}

/**
 * Infer process/mechanical connections from explicit text or cautious heuristics.
 * Ambiguous proposals are flagged — never silent topology.
 */
export function inferConnections(text, candidates = []) {
  const byTag = new Map(candidates.map((c) => [c.tag, c]));
  const tags = [...byTag.keys()];
  const connections = [];
  const seen = new Set();
  const push = (fromTag, toTag, connectionType, confidence, ambiguous, reason, evidence) => {
    const a = String(fromTag || "").toUpperCase();
    const b = String(toTag || "").toUpperCase();
    if (!a || !b || a === b) return;
    if (!byTag.has(a) || !byTag.has(b)) return;
    const key = `${a}>${b}:${connectionType}`;
    if (seen.has(key)) return;
    seen.add(key);
    connections.push({
      id: `conn-${a}-${b}-${connectionType}`,
      fromTag: a,
      toTag: b,
      connectionType,
      confidence,
      ambiguous: !!ambiguous,
      include: !ambiguous && confidence >= 0.65,
      dataClass: "ENGINEERING_INFERENCE",
      reason,
      evidence: evidence || null,
      status: ambiguous ? "ambiguous" : "proposed"
    });
  };

  const body = String(text || "");
  // Explicit arrows / from-to language
  const explicit = [
    /\b([A-Z]{1,6}-?\d{2,4}[A-Z]?)\s*(?:→|->|=>|to|into|feeds?|discharges?\s+to)\s*([A-Z]{1,6}-?\d{2,4}[A-Z]?)\b/gi,
    /\bfrom\s+([A-Z]{1,6}-?\d{2,4}[A-Z]?)\s+to\s+([A-Z]{1,6}-?\d{2,4}[A-Z]?)\b/gi
  ];
  for (const re of explicit) {
    let m;
    while ((m = re.exec(body)) !== null) {
      push(m[1], m[2], "process", 0.7, false, "Explicit connectivity language in source text", m[0]);
    }
  }

  // Motor ↔ pump same numeric suffix → mechanical (medium confidence)
  for (const t of tags) {
    if (!/^M-?\d/i.test(t) && !/^MOTOR/i.test(t)) continue;
    const num = t.match(/(\d{2,4})/)?.[1];
    if (!num) continue;
    const pump = tags.find((p) => /^(P|PUMP)-?/i.test(p) && p.includes(num));
    if (pump) {
      push(t, pump, "mechanical", 0.62, true, "Motor/pump numeric suffix match — verify coupling on drawing", null);
    }
  }

  // Water-transfer style chain when source/dest tanks + pump + valve present — always ambiguous
  const tanks = tags.filter((t) => byTag.get(t)?.type === "tank");
  const pumps = tags.filter((t) => byTag.get(t)?.type === "pump");
  const valves = tags.filter((t) => byTag.get(t)?.type === "valve");
  if (tanks.length >= 1 && pumps.length >= 1) {
    push(tanks[0], pumps[0], "process", 0.45, true, "Heuristic: first tank → first pump (topology not proven from drawing geometry)", null);
  }
  if (pumps.length >= 1 && valves.length >= 1) {
    push(pumps[0], valves[0], "process", 0.45, true, "Heuristic: first pump → first valve (ambiguous — confirm on P&ID)", null);
  }
  if (valves.length >= 1 && tanks.length >= 2) {
    push(valves[0], tanks[1], "process", 0.4, true, "Heuristic: valve → second tank (ambiguous transfer path)", null);
  } else if (valves.length >= 1 && tanks.length === 1 && pumps.length >= 1) {
    // single-tank loop not invented
  }

  // Instrument on equipment when same loop number
  for (const t of tags) {
    const c = byTag.get(t);
    if (!c || !/transmitter|level_|flow_|pressure_|temperature_/i.test(c.type)) continue;
    const num = t.match(/(\d{2,4})/)?.[1];
    if (!num) continue;
    const tank = tanks.find((x) => x.includes(num));
    if (tank) {
      push(t, tank, "instrument", 0.5, true, "Instrument/tank loop number match — association unverified", null);
    }
  }

  return connections;
}

/**
 * Engineer-language gap decisions for missing specs (reviewable, not silent defaults).
 */
export function analyzeEngineeringGaps(candidates = [], connections = []) {
  const gaps = [];
  const byType = (re) => candidates.filter((c) => re.test(c.type) || re.test(c.tag));
  const tanks = byType(/tank/i);
  const pumps = byType(/pump/i);
  const motors = byType(/motor/i);
  const valves = byType(/valve/i);
  const levels = byType(/level_/i);
  const esds = byType(/emergency_stop/i);
  const includedConns = connections.filter((c) => c.include && !c.ambiguous);

  for (const tank of tanks) {
    gaps.push({
      id: `gap-tank-capacity-${tank.tag}`,
      severity: "decision",
      topic: "Tank capacity / geometry",
      message: `${tank.tag}: working volume, height, and high-level setpoint are not specified in the import — engineer must confirm before simulation sizing is trusted.`,
      relatedTags: [tank.tag],
      status: "open"
    });
    if (!levels.length) {
      gaps.push({
        id: `gap-tank-level-${tank.tag}`,
        severity: "decision",
        topic: "Level instrumentation",
        message: `${tank.tag}: no level transmitter/switch was extracted — add instrumentation or accept that high-level protection is not modeled.`,
        relatedTags: [tank.tag],
        status: "open"
      });
    }
  }

  for (const pump of pumps) {
    const num = pump.tag.match(/(\d{2,4})/)?.[1];
    const hasMotor = motors.some((m) => !num || m.tag.includes(num));
    if (!hasMotor) {
      gaps.push({
        id: `gap-pump-motor-${pump.tag}`,
        severity: "decision",
        topic: "Pump drive",
        message: `${pump.tag}: no matching motor tag extracted — confirm drive coupling or add motor equipment before claiming a complete mechanical train.`,
        relatedTags: [pump.tag],
        status: "open"
      });
    }
    const hasValvePath = includedConns.some(
      (c) =>
        (c.fromTag === pump.tag || c.toTag === pump.tag) &&
        valves.some((v) => v.tag === c.fromTag || v.tag === c.toTag)
    );
    if (!hasValvePath && valves.length) {
      gaps.push({
        id: `gap-pump-valve-${pump.tag}`,
        severity: "decision",
        topic: "Discharge path",
        message: `${pump.tag}: discharge isolation valve association is ambiguous or not accepted — do not assume valve interlocks until the connection is confirmed.`,
        relatedTags: [pump.tag, ...valves.map((v) => v.tag)],
        status: "open"
      });
    }
  }

  if (pumps.length && !esds.length) {
    gaps.push({
      id: "gap-esd-missing",
      severity: "decision",
      topic: "Emergency stop",
      message:
        "Transfer pump(s) present but no ESD/E-stop tag extracted — safety shutdown path is incomplete until an engineer adds/approves an E-stop input (simulation only; not certified safety).",
      relatedTags: pumps.map((p) => p.tag),
      status: "open"
    });
  }

  if (!candidates.length) {
    gaps.push({
      id: "gap-no-candidates",
      severity: "blocker",
      topic: "Manual reconstruction",
      message:
        "No equipment tags were extracted. Use manual reconstruction: place equipment from the library, draw connections, and attach the original document as a reference. Do not fabricate confidence.",
      relatedTags: [],
      status: "open"
    });
  }

  const ambiguous = connections.filter((c) => c.ambiguous);
  if (ambiguous.length) {
    gaps.push({
      id: "gap-ambiguous-topology",
      severity: "decision",
      topic: "Process topology",
      message: `${ambiguous.length} proposed connection(s) are ambiguous — accept only after checking the drawing. Uncertain topology is never silently approved.`,
      relatedTags: [...new Set(ambiguous.flatMap((c) => [c.fromTag, c.toTag]))],
      status: "open"
    });
  }

  return gaps;
}

/**
 * Run extract → mine → connections → gaps for one or more uploaded files.
 * @param {Array<{ buffer: Buffer, mimetype?: string, originalname?: string }>} files
 */
export async function runIngestPipeline(files = []) {
  const stages = [];
  const mark = (id, status, detail = {}) => {
    stages.push({ id, status, ...detail, at: new Date().toISOString() });
  };

  mark("receive", "done", { fileCount: files.length });
  if (!files.length) {
    mark("extract", "failed", { error: "No files" });
    return {
      ok: false,
      error: "file required",
      stages,
      documents: [],
      candidates: [],
      connections: [],
      gaps: analyzeEngineeringGaps([], []),
      note: "Provide PDF, SVG, text/CSV, or images. Image OCR unfinished."
    };
  }

  const documents = [];
  const allCandidates = [];
  const textParts = [];
  let anyUnfinished = false;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = f.originalname || f.filename || `document-${i + 1}`;
    mark("extract", "running", { documentIndex: i, documentName: name });
    let extracted;
    try {
      extracted = await extractText(f.buffer, f.mimetype || "", name);
    } catch (e) {
      extracted = {
        text: "",
        confidence: 0,
        engine: "none",
        warning: String(e?.message || e),
        pages: []
      };
    }
    if (extracted.unfinished) anyUnfinished = true;
    const pages = extracted.pages?.length ? extracted.pages : [{ page: 1, text: extracted.text || "" }];
    const docCandidates = [];
    for (const page of pages) {
      const mined = mineCandidates(page.text || "", {
        documentIndex: i,
        documentName: name,
        page: page.page
      });
      docCandidates.push(...mined);
    }
    // Dedupe within document (keep first sourceRef)
    const seen = new Set();
    const unique = [];
    for (const c of docCandidates) {
      if (seen.has(c.tag)) continue;
      seen.add(c.tag);
      unique.push(c);
    }
    textParts.push(extracted.text || "");
    documents.push({
      documentIndex: i,
      name,
      mimeType: normalizeMime(f.mimetype || "", name),
      engine: extracted.engine,
      confidence: extracted.confidence,
      unfinished: !!extracted.unfinished,
      warning: extracted.warning || null,
      pageCount: extracted.pageCount || pages.length,
      vectorSummary: extracted.vectorSummary || null,
      text: extracted.text || "",
      candidateCount: unique.length
    });
    allCandidates.push(...unique);
    mark("extract", "done", {
      documentIndex: i,
      documentName: name,
      engine: extracted.engine,
      candidateCount: unique.length
    });
  }

  // Merge candidates across docs (prefer higher confidence / keep multi sourceRefs)
  const merged = new Map();
  for (const c of allCandidates) {
    const prev = merged.get(c.tag);
    if (!prev) {
      merged.set(c.tag, { ...c, sourceRefs: [c.sourceRef] });
      continue;
    }
    prev.sourceRefs = [...(prev.sourceRefs || [prev.sourceRef]), c.sourceRef];
    if ((c.confidence || 0) > (prev.confidence || 0)) {
      prev.confidence = c.confidence;
      prev.sourceRef = c.sourceRef;
    }
  }
  const candidates = [...merged.values()];
  mark("mine", "done", { candidateCount: candidates.length });

  const combinedText = textParts.join("\n\n");
  const connections = inferConnections(combinedText, candidates);
  mark("connections", "done", {
    proposed: connections.length,
    ambiguous: connections.filter((c) => c.ambiguous).length
  });

  const gaps = analyzeEngineeringGaps(candidates, connections);
  mark("gaps", "done", { gapCount: gaps.length });
  mark("review_required", "pending", {
    note: "Engineer must accept/reject/correct before promote — no silent approve"
  });

  const primary = documents[0] || {};
  return {
    ok: true,
    stages,
    documents,
    extracted: {
      text: combinedText,
      confidence: primary.confidence ?? null,
      engine: documents.length === 1 ? primary.engine : "multi-document",
      unfinished: anyUnfinished,
      warning: documents.map((d) => d.warning).filter(Boolean).join(" ") || undefined,
      pageCount: documents.reduce((n, d) => n + (d.pageCount || 1), 0),
      dataClassHint: anyUnfinished ? "ENGINEERING_INFERENCE" : "EXTRACTED_FACT"
    },
    candidates,
    connections,
    gaps,
    manualReconstructionSuggested: !candidates.length || anyUnfinished,
    note:
      "Candidates and connections are ENGINEERING_INFERENCE until explicitly promoted. " +
      "Ambiguous topology is never silently approved. " +
      (anyUnfinished ? "Image OCR unfinished (KI-003)." : "Prefer retaining originals as project document references.")
  };
}
