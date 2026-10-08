import { parse as csvParse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { normalizeTag } from "./doc_normalize.js";

function toUtf8(buf) {
  return Buffer.isBuffer(buf) ? buf.toString("utf-8") : String(buf || "");
}

function normHeader(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function pickColumns(headers) {
  const hs = headers.map(h => ({ h, n: normHeader(h) }));
  const pickFirst = (pred) => (hs.find(x => pred(x.n)) || {}).h;

  const causeKey =
    pickFirst(n => n.includes("cause")) ||
    pickFirst(n => n.includes("trip")) ||
    pickFirst(n => n.includes("condition")) ||
    pickFirst(n => n.includes("input")) ||
    pickFirst(n => n.includes("shutdowncause")) ||
    pickFirst(n => n.includes("initiator"));

  const effectKey =
    pickFirst(n => n.includes("effect")) ||
    pickFirst(n => n.includes("action")) ||
    pickFirst(n => n.includes("output")) ||
    pickFirst(n => n.includes("shutdownaction")) ||
    pickFirst(n => n.includes("finalelement")) ||
    pickFirst(n => n.includes("result"));

  return { causeKey, effectKey, headers };
}

function rowToRule(r, cols) {
  // Flexible column names: use detected best keys first, then fall back to common names
  const causeRaw =
    (cols?.causeKey ? r[cols.causeKey] : undefined) ??
    r["Cause"] ?? r["CAUSE"] ?? r["Trip"] ?? r["Condition"] ?? r["Input"] ?? r["cause"];

  const effectRaw =
    (cols?.effectKey ? r[cols.effectKey] : undefined) ??
    r["Effect"] ?? r["EFFECT"] ?? r["Action"] ?? r["Output"] ?? r["effect"];

  if (!causeRaw || !effectRaw) return null;

  // Support multiple causes split by comma/and/+
  const causes = String(causeRaw)
    .split(/,|;|\+|\band\b/gi)
    .map(s => normalizeTag(s))
    .filter(Boolean);
  const effects = String(effectRaw)
    .split(/,|;|\+|\band\b/gi)
    .map(s => normalizeTag(s))
    .filter(Boolean);

  if (!causes.length || !effects.length) return null;
  return { causes, effects, raw: { cause: String(causeRaw), effect: String(effectRaw) } };
}

export function parseCauseEffectCsvText(csvText) {
  const records = csvParse(csvText, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  const cols = pickColumns(Object.keys(records?.[0] || {}));
  const rules = [];
  for (const r of records) {
    const rule = rowToRule(r, cols);
    if (rule) rules.push(rule);
  }
  return { rules, diagnostics: cols };
}

export function parseCauseEffectXlsxBuffer(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const cols = pickColumns(Object.keys(json?.[0] || {}));
  const rules = [];
  for (const r of json) {
    const rule = rowToRule(r, cols);
    if (rule) rules.push(rule);
  }
  return { rules, diagnostics: cols };
}

export function parseCauseEffectLooseText(text) {
  // Very light heuristic: find lines with 2+ tags; treat first as cause, rest as effects.
  const lines = String(text || "").split(/\r?\n/);
  const rules = [];
  for (const line of lines) {
    const matches = Array.from(line.matchAll(/\b([A-Z]{1,6}\s*[- ]?\s*\d{1,6}[A-Z]?)\b/gi));
    const tags = matches.map(m => normalizeTag(m[1])).filter(Boolean);
    const uniq = Array.from(new Set(tags));
    if (uniq.length >= 2) rules.push({ causes: [uniq[0]], effects: uniq.slice(1), rawLine: line.trim() });
  }
  return rules;
}

export function parseCauseEffectFile({ buffer, filename = "", mimetype = "" }) {
  const name = filename.toLowerCase();
  const mt = String(mimetype || "").toLowerCase();

  if (name.endsWith(".csv") || mt.includes("text/csv") || mt.includes("application/csv")) {
    const parsed = parseCauseEffectCsvText(toUtf8(buffer));
    return { rules: parsed.rules, warnings: [], diagnostics: parsed.diagnostics };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mt.includes("spreadsheet") || mt.includes("excel")) {
    const parsed = parseCauseEffectXlsxBuffer(buffer);
    return { rules: parsed.rules, warnings: [], diagnostics: parsed.diagnostics };
  }

  return { rules: [], warnings: [`Unsupported Cause&Effect format '${filename || mimetype}'. Use CSV/XLSX or provide text.`], diagnostics: { headers: [] } };
}

