/**
 * P&ID Parser - Extracts instruments, valves, pumps, and control loops from P&ID documents
 * 
 * This module provides both:
 * 1. Structured JSON parser (for manual/API input)
 * 2. Basic image/PDF text extraction (for automated parsing)
 */

/**
 * Parse a structured P&ID description (JSON format)
 * Expected format:
 * {
 *   instruments: [{ tag: "PT-101", type: "pressure_transmitter", range: [0, 100] }],
 *   valves: [{ tag: "XV-101", type: "on_off", normally: "closed" }],
 *   pumps: [{ tag: "P-101", interlock: "PT-101" }],
 *   control_loops: [{ tag: "LC-101", sensor: "LT-101", valve: "LV-101", setpoint: 50 }]
 * }
 */
export function parseStructuredPID(pidData) {
  const elements = {
    instruments: [],
    valves: [],
    pumps: [],
    controlLoops: [],
    tags: new Map()
  };

  // Parse instruments
  if (pidData.instruments && Array.isArray(pidData.instruments)) {
    for (const inst of pidData.instruments) {
      const element = {
        tag: inst.tag || `INST-${elements.instruments.length + 1}`,
        type: inst.type || "sensor",
        range: inst.range || [0, 100],
        unit: inst.unit || "",
        description: inst.description || ""
      };
      elements.instruments.push(element);
      elements.tags.set(element.tag, { type: "instrument", element });
    }
  }

  // Parse valves
  if (pidData.valves && Array.isArray(pidData.valves)) {
    for (const valve of pidData.valves) {
      const element = {
        tag: valve.tag || `VALVE-${elements.valves.length + 1}`,
        type: valve.type || "on_off",
        normally: valve.normally || "closed",
        description: valve.description || ""
      };
      elements.valves.push(element);
      elements.tags.set(element.tag, { type: "valve", element });
    }
  }

  // Parse pumps
  if (pidData.pumps && Array.isArray(pidData.pumps)) {
    for (const pump of pidData.pumps) {
      const element = {
        tag: pump.tag || `PUMP-${elements.pumps.length + 1}`,
        interlock: pump.interlock || null,
        description: pump.description || ""
      };
      elements.pumps.push(element);
      elements.tags.set(element.tag, { type: "pump", element });
    }
  }

  // Parse control loops
  if (pidData.control_loops && Array.isArray(pidData.control_loops)) {
    for (const loop of pidData.control_loops) {
      const element = {
        tag: loop.tag || `LOOP-${elements.controlLoops.length + 1}`,
        sensor: loop.sensor || "",
        actuator: loop.actuator || loop.valve || "",
        setpoint: loop.setpoint || 0,
        type: loop.type || "pid",
        description: loop.description || ""
      };
      elements.controlLoops.push(element);
      elements.tags.set(element.tag, { type: "control_loop", element });
    }
  }

  return elements;
}

/**
 * Extract text from image/PDF/CSV.
 * PDFs: pdf-parse (searchable). Images: tesseract.js OCR.
 * Scanned PDFs with little text fall back to a clear low-confidence warning
 * (full page raster OCR requires a PDF→image pipeline; use PNG/JPEG for scans).
 */
export async function extractTextFromFile(fileBuffer, mimeType) {
  const { extractText, mineCandidates } = await import("./ocr_ingest.js");
  const mt = mimeType || "application/octet-stream";

  if (
    mt === "application/pdf" ||
    mt.startsWith("image/") ||
    mt.includes("csv") ||
    mt.includes("text/")
  ) {
    const extracted = await extractText(fileBuffer, mt);
    // Searchable PDF with almost no text → likely scanned; do not fake success
    if (mt.includes("pdf") && !(extracted.text || "").trim()) {
      return {
        text: "",
        elements: [],
        confidence: 0,
        engine: extracted.engine,
        warning:
          "PDF contained no extractable text (likely scanned). " +
          "Export pages as PNG/JPEG and re-upload for OCR, or use JSON input.",
        candidates: []
      };
    }
    const candidates = mineCandidates(extracted.text || "");
    return {
      text: extracted.text || "",
      elements: [],
      confidence: extracted.confidence,
      engine: extracted.engine,
      warning: extracted.warning,
      dataClassHint: extracted.dataClassHint,
      candidates
    };
  }

  throw new Error(`Unsupported file type: ${mimeType}. Supported: PDF, PNG, JPG, JPEG, CSV`);
}

/**
 * Parse extracted text to find P&ID elements
 * Uses pattern matching to find tags, instruments, valves, etc.
 */
export function parseTextForPIDElements(text) {
  const elements = {
    instruments: [],
    valves: [],
    pumps: [],
    controlLoops: [],
    equipment: [],
    tags: new Map()
  };

  // More robust tag extraction:
  // - ISA-style instrument tags can be 1-4 letters + '-' + 1-6 digits (e.g., PT-101, LIC-101, FIC-12)
  // - Valves often use XV/LV/FV/TV/AV/etc.
  // - Equipment tags often use P/E/T/D/C/HX/V/R/CT/etc. (e.g., P-131, E-102, T-103, D-113)
  //
  // NOTE: This is still pattern-based; it does NOT understand drawing connectivity/symbol semantics.
  const allTagPattern = /\b([A-Z]{1,4})-(\d{1,6})\b/g;

  const valvePrefixes = new Set(["XV", "LV", "FV", "TV", "AV", "PV", "SV", "DV", "HV", "CV", "PCV", "FCV", "LCV", "TCV"]);
  const instrumentFirstLetterType = {
    P: "pressure",
    F: "flow",
    L: "level",
    T: "temperature",
    A: "analysis",
    D: "density",
    S: "speed"
  };
  const equipmentPrefixes = new Set(["P", "E", "T", "D", "C", "V", "HX", "R", "K", "M", "CY", "TR"]);

  // Deduplicate by tag text
  const seen = new Set();

  let match;
  while ((match = allTagPattern.exec(text)) !== null) {
    const prefixRaw = match[1].toUpperCase();
    const num = match[2];
    const tag = `${prefixRaw}-${num}`;
    if (seen.has(tag)) continue;
    seen.add(tag);

    // Classify
    if (valvePrefixes.has(prefixRaw)) {
      const element = { tag, type: prefixRaw === "XV" ? "on_off" : "control" };
      elements.valves.push(element);
      elements.tags.set(tag, { type: "valve", element });
      continue;
    }

    // Pumps: only prefix exactly "P" (avoid misclassifying "PC" etc. as pump)
    if (prefixRaw === "P") {
      const element = { tag };
      elements.pumps.push(element);
      elements.tags.set(tag, { type: "pump", element });
      continue;
    }

    // Control loops: common controller prefixes
    if (["LC", "FC", "TC", "PC", "AC", "LIC", "FIC", "TIC", "PIC"].includes(prefixRaw)) {
      const element = {
        tag,
        type:
          prefixRaw.startsWith("L") ? "level_control" :
          prefixRaw.startsWith("F") ? "flow_control" :
          prefixRaw.startsWith("T") ? "temperature_control" :
          prefixRaw.startsWith("P") ? "pressure_control" : "control"
      };
      elements.controlLoops.push(element);
      elements.tags.set(tag, { type: "control_loop", element });
      continue;
    }

    // Instruments: tags where first letter implies measured variable and includes T/I/S/C/E etc.
    // Example: PT, FT, LT, TT, PS, LS, TE, PI, etc.
    if (instrumentFirstLetterType[prefixRaw[0]]) {
      const element = { tag, type: "instrument" };
      elements.instruments.push(element);
      elements.tags.set(tag, { type: "instrument", element });
      continue;
    }

    // Equipment fallback (helps for documents like BarkelB-PIDs that include many equipment examples)
    if (equipmentPrefixes.has(prefixRaw) || equipmentPrefixes.has(prefixRaw.slice(0, 2))) {
      const element = { tag, type: "equipment" };
      elements.equipment.push(element);
      elements.tags.set(tag, { type: "equipment", element });
      continue;
    }

    // Unknown but tag-shaped; store as equipment to avoid dropping useful inventory
    const element = { tag, type: "unknown" };
    elements.equipment.push(element);
    elements.tags.set(tag, { type: "unknown", element });
  }

  return elements;
}
