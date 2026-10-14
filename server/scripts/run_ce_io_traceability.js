#!/usr/bin/env node
/**
 * CLI runner for C&E ↔ I/O traceability pipeline.
 * Reads cause_effect.* and io_list.* (csv/xlsx/json), optional tag_registry.*, writes all artifacts to --out dir.
 *
 * Usage (from server directory):
 *   node scripts/run_ce_io_traceability.js --ce path/cause_effect.csv --io path/io_list.csv [--registry path/tag_registry.csv] [--out ./traceability_out]
 *
 * Or with defaults: --ce cause_effect.csv --io io_list.csv --out ./traceability_out
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCauseEffectCsvText, parseCauseEffectXlsxBuffer } from "../plc/cause_effect_parser.js";
import { parseIoListFromCsvText, parseIoListFromXlsxBuffer } from "../plc/io_list_parser.js";
import { parse as csvParse } from "csv-parse/sync";
import {
  runTraceabilityPipeline,
  rowsToCsv,
} from "../plc/ce_io_traceability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ce" && args[i + 1]) out.cePath = args[++i];
    else if (args[i] === "--io" && args[i + 1]) out.ioPath = args[++i];
    else if (args[i] === "--registry" && args[i + 1]) out.registryPath = args[++i];
    else if (args[i] === "--out" && args[i + 1]) out.outDir = args[++i];
  }
  return out;
}

function loadCauseEffect(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === ".json") {
    const data = JSON.parse(buf.toString("utf-8"));
    const arr = Array.isArray(data) ? data : data.rules || data.rows || [];
    return arr.map((row) => {
      const cause = row.cause ?? row.cause_tag ?? row.Cause ?? row.CAUSE ?? "";
      const effect = row.effect ?? row.effect_tag ?? row.Effect ?? row.EFFECT ?? "";
      const causes = Array.isArray(row.causes) ? row.causes : [cause].filter(Boolean);
      const effects = Array.isArray(row.effects) ? row.effects : [effect].filter(Boolean);
      return { causes, effects };
    });
  }
  if (ext === ".csv") {
    const parsed = parseCauseEffectCsvText(buf.toString("utf-8"));
    return parsed.rules;
  }
  if (ext === ".xlsx" || ext === ".xls") {
    const parsed = parseCauseEffectXlsxBuffer(buf);
    return parsed.rules;
  }
  throw new Error(`Unsupported cause_effect format: ${ext}`);
}

function loadIoList(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === ".json") {
    const data = JSON.parse(buf.toString("utf-8"));
    const arr = Array.isArray(data) ? data : data.ioList || data.entries || data.rows || [];
    return arr.map((row) => {
      const tag = row.tag ?? row.Tag ?? row.TAG ?? "";
      const ioType = row.ioType ?? row.type ?? row.Type ?? row.IOType ?? "";
      const ioAddress = row.ioAddress ?? row.address ?? row.Address ?? "";
      const remark = row.remark ?? row.Remark ?? "";
      const service = row.service ?? row.Service ?? "";
      return { tag, ioType, ioAddress, remark, service };
    });
  }
  if (ext === ".csv") {
    return parseIoListFromCsvText(buf.toString("utf-8"));
  }
  if (ext === ".xlsx" || ext === ".xls") {
    return parseIoListFromXlsxBuffer(buf);
  }
  throw new Error(`Unsupported io_list format: ${ext}`);
}

function loadTagRegistry(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  const rows = csvParse(text, { columns: true, skip_empty_lines: true, trim: true });
  return rows;
}

function writeCsv(filePath, rows) {
  const csv = rowsToCsv(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, "utf-8");
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

function main() {
  const { cePath, ioPath, registryPath, outDir } = parseArgs();
  if (!cePath || !ioPath) {
    console.error("Usage: node scripts/run_ce_io_traceability.js --ce <cause_effect.*> --io <io_list.*> [--registry tag_registry.csv] [--out ./traceability_out]");
    process.exit(1);
  }

  const out = path.resolve(outDir || path.join(__dirname, "..", "traceability_out"));
  const existingRegistry = registryPath && fs.existsSync(registryPath) ? loadTagRegistry(registryPath) : [];

  let ceRules, ioEntries;
  try {
    ceRules = loadCauseEffect(cePath);
    ioEntries = loadIoList(ioPath);
  } catch (e) {
    console.error("Load error:", e.message);
    process.exit(2);
  }

  console.log(`Loaded ${ceRules.length} C&E rules, ${ioEntries.length} I/O entries.`);
  const result = runTraceabilityPipeline(ceRules, ioEntries, existingRegistry);

  fs.mkdirSync(out, { recursive: true });

  writeCsv(path.join(out, "tag_registry_master.csv"), result.tag_registry_master);
  writeCsv(path.join(out, "ce_xref_report.csv"), result.ce_xref_report);
  writeCsv(path.join(out, "io_xref_report.csv"), result.io_xref_report);
  writeCsv(path.join(out, "exceptions_resolution_log.csv"), result.exceptions_resolution_log);

  const validationPayload = {
    pass: result.validation_results.pass,
    violations: result.validation_results.violations,
    timestamp: new Date().toISOString(),
  };
  writeJson(path.join(out, "validation_results.json"), validationPayload);

  // io_list_clean: flatten to rows with consistent columns for CSV
  const ioCleanRows = result.io_list_clean.map((e) => ({
    tag: e.tag,
    normalized_tag: e.normalized_tag,
    io_type: e.ioType,
    io_address: e.ioAddress,
    appears_in_ce: e.appears_in_ce,
    usage_category: e.usage_category,
    rationale_if_not_in_ce: e.rationale_if_not_in_ce,
    doc_reference: e.doc_reference,
    service: e.service,
    remark: e.remark,
  }));
  writeCsv(path.join(out, "io_list_clean.csv"), ioCleanRows);

  // cause_effect_clean: one row per rule with cause/effect as semicolon-separated
  const ceCleanRows = result.cause_effect_clean.map((r) => ({
    normalized_cause_tag: r.normalized_cause_tag,
    normalized_effect_tag: r.normalized_effect_tag,
    cause_class: r.cause_class,
    effect_class: r.effect_class,
  }));
  writeCsv(path.join(out, "cause_effect_clean.csv"), ceCleanRows);

  console.log(`Wrote artifacts to ${out}`);
  console.log(`  tag_registry_master.csv, ce_xref_report.csv, io_xref_report.csv`);
  console.log(`  exceptions_resolution_log.csv, validation_results.json`);
  console.log(`  io_list_clean.csv, cause_effect_clean.csv`);
  console.log(`Validation: ${result.validation_results.pass ? "PASS" : "FAIL"} (${result.validation_results.violations.length} violations)`);
  if (result.validation_results.violations.length) {
    result.validation_results.violations.forEach((v) => console.log(`  - ${v.rule}: ${v.message}`));
  }
}

main();
