import { parse as csvParse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { normalizeIoType, normalizeTag } from "./doc_normalize.js";

function toUtf8(buf) {
  return Buffer.isBuffer(buf) ? buf.toString("utf-8") : String(buf || "");
}

function parseFromRows(rows) {
  const entries = [];
  for (const r of rows) {
    const rawTag =
      r["Tag Number"] ?? r["Tag"] ?? r["TagNumber"] ?? r["TAG"] ?? r["TagNumber "] ?? r["Tag No."] ?? r["Tag No"] ?? r["tag"];
    const tag = normalizeTag(rawTag);
    if (!tag) continue;

    const ioType = normalizeIoType(r["IO Type"] ?? r["I/O Type"] ?? r["IOType"] ?? r["Type"] ?? r["ioType"]);
    const address = String(r["Address"] ?? r["address"] ?? r["IO Address"] ?? r["Channel"] ?? "").trim();
    const entry = {
      tag,
      ioAddress: address || undefined,
      loopNumber: String(r["Loop Number"] ?? r["Loop"] ?? r["LoopNumber"] ?? r["loop"] ?? "").trim(),
      instrumentType: String(r["Instrument Type"] ?? r["Instrument"] ?? r["Inst Type"] ?? r["instrumentType"] ?? "").trim(),
      location: String(r["Location"] ?? r["location"] ?? "").trim(),
      service: String(r["Service"] ?? r["service"] ?? "").trim(),
      pidNo: String(r["P&ID No."] ?? r["P&ID No"] ?? r["PID No"] ?? r["P&ID"] ?? "").trim(),
      ioType,
      system: String(r["System"] ?? r["system"] ?? "").trim(),
      setPoint: String(r["Set Point"] ?? r["SetPoint"] ?? r["setPoint"] ?? "").trim(),
      engUnit: String(r["Engg Unit"] ?? r["Eng Unit"] ?? r["Unit"] ?? r["engUnit"] ?? "").trim(),
      remark: String(r["Remark"] ?? r["remark"] ?? "").trim()
    };

    entries.push(entry);
  }

  // Deduplicate (some lists have multiple rows for same tag with different IO types, like AO+AI)
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.tag}|${e.ioType || "-"}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }

  return Array.from(byKey.values());
}

export function parseIoListFromCsvText(csvText) {
  const records = csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  });
  return parseFromRows(records);
}

export function parseIoListFromXlsxBuffer(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return parseFromRows(json);
}

// Heuristic for PDF-text IO lists: find (tag, IO type) on same line.
export function parseIoListFromLooseText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    const io = (line.match(/\b(DI|DO|AI|AO)\b/i) || [])[1];
    if (!io) continue;

    // grab first tag-like thing on the line (FS313, FIC313, XV 312, PT-312, etc)
    const tagMatch =
      line.match(/\b([A-Z]{1,6}\s*[- ]?\s*\d{1,6}[A-Z]?)\b/i) ||
      line.match(/\b([A-Z]{1,6}\d{1,6}[A-Z]?)\b/i);
    if (!tagMatch) continue;

    const tag = normalizeTag(tagMatch[1]);
    if (!tag) continue;

    entries.push({ tag, ioType: normalizeIoType(io) });
  }

  // Dedup
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.tag}|${e.ioType || "-"}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return Array.from(byKey.values());
}

export function parseIoListFile({ buffer, filename = "", mimetype = "" }) {
  const name = filename.toLowerCase();
  const mt = String(mimetype || "").toLowerCase();

  if (name.endsWith(".csv") || mt.includes("text/csv") || mt.includes("application/csv")) {
    return { entries: parseIoListFromCsvText(toUtf8(buffer)), warnings: [] };
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mt.includes("spreadsheet") || mt.includes("excel")) {
    return { entries: parseIoListFromXlsxBuffer(buffer), warnings: [] };
  }

  // If it’s a PDF, caller should pass pdf-extracted text into parseIoListFromLooseText
  return { entries: [], warnings: [`Unsupported IO list format '${filename || mimetype}'. Use CSV/XLSX or provide PDF text.`] };
}

