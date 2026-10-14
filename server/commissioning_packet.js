/**
 * Commissioning packet: single download (.zip) with validation, tests, IO list, exports, IR, README.
 */

import JSZip from "jszip";
import { getLastValidation, getLastTestsSummary, getLastTestsResults } from "./state_cache.js";
import { getExceptions } from "./validation_exceptions.js";
import { exportIOList } from "./plc/io_list_export.js";
import { exportTerminalPlan, exportWireSchedule, exportIOCheckout } from "./plc/wiring_export.js";
import { exportCodesysST, exportSiemensSCL } from "./plc/exporters.js";
import { buildCommissioningReportPDF, buildCommissioningReportDOCX } from "./commissioning_reports.js";

/**
 * Build commissioning packet as .zip buffer (async).
 * @param {{ LAST_PROJECT, plc }} deps - injected to avoid circular deps
 * @returns {Promise<Buffer>}
 */
export async function buildCommissioningPacket(deps) {
  const { LAST_PROJECT, plc } = deps;
  const zip = new JSZip();
  const now = new Date().toISOString();

  function add(name, content) {
    const str = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    zip.file(name, str);
  }

  const validation = getLastValidation();
  if (validation) {
    add("validation.json", {
      score: validation.score,
      errorCount: validation.errors,
      warningCount: validation.warnings,
      lastRunAt: validation.lastRunAt,
      errors: validation.errorsList || [],
      warnings: validation.warningsList || []
    });
  }
  const exceptions = getExceptions();
  if (exceptions.length > 0) {
    add("accepted_exceptions.json", {
      generatedAt: new Date().toISOString(),
      description: "Validation findings accepted as exceptions (who accepted, when). Use for traceability.",
      exceptions: exceptions.map((ex) => ({
        id: ex.id,
        rule: ex.rule,
        tag: ex.tag,
        acceptedAt: ex.acceptedAt,
        acceptedBy: ex.acceptedBy
      }))
    });
  }
  const testsSummary = getLastTestsSummary();
  const testsResults = getLastTestsResults();
  if (testsSummary) {
    add("tests_last_run.json", {
      summary: testsSummary,
      results: testsResults || []
    });
  }

  const ir = plc?.programIR;
  if (ir) {
    add("program_ir.json", ir);
    try {
      add("io_list.csv", exportIOList(ir));
    } catch (e) {
      add("io_list.csv", "Tag,Address,Type,Description,Group\n");
    }
  }

  if (LAST_PROJECT?.ioEntries?.length) {
    try {
      add("terminal_plan.csv", exportTerminalPlan(LAST_PROJECT.ioEntries));
      add("wire_schedule.csv", exportWireSchedule(LAST_PROJECT.ioEntries));
      add("io_checkout.csv", exportIOCheckout(LAST_PROJECT.ioEntries, ir, LAST_PROJECT.ioMap || {}));
    } catch (e) {
      // ignore
    }
  }

  if (ir) {
    try {
      add("program.st", exportCodesysST(ir));
      add("program.scl", exportSiemensSCL(ir));
    } catch (e) {
      // ignore
    }
  }

  // Human-readable reports for non-coders (PDF + Word)
  const reportData = {
    generatedAt: now,
    validation: validation ? { score: validation.score, errorCount: validation.errors, warningCount: validation.warnings, lastRunAt: validation.lastRunAt, errors: validation.errorsList || [], warnings: validation.warningsList || [] } : null,
    exceptions: exceptions.length > 0 ? { exceptions: exceptions.map((ex) => ({ id: ex.id, rule: ex.rule, tag: ex.tag, acceptedAt: ex.acceptedAt, acceptedBy: ex.acceptedBy })) } : null,
    tests: testsSummary ? { summary: testsSummary, results: testsResults || [] } : null
  };
  try {
    const pdfBuf = await buildCommissioningReportPDF(reportData);
    zip.file("Commissioning_Report.pdf", pdfBuf);
    const docxBuf = await buildCommissioningReportDOCX(reportData);
    zip.file("Commissioning_Report.docx", docxBuf);
  } catch (e) {
    // If PDF/DOCX generation fails, packet still includes all JSON/CSV
  }

  const readme = [
    "Commissioning Packet",
    "Generated: " + now,
    "",
    "Contents:",
    "- Commissioning_Report.pdf / Commissioning_Report.docx — readable summary (validation, exceptions, test results). Start here if you prefer not to open JSON files.",
    "- validation.json: last validation result (score, errors, warnings)",
    "- accepted_exceptions.json: validation findings accepted as exceptions (who, when) — traceability",
    "- tests_last_run.json: last FAT/SAT test run summary and results",
    "- program_ir.json: ladder IR",
    "- io_list.csv: I/O list from program",
    "- terminal_plan.csv, wire_schedule.csv, io_checkout.csv: panel exports",
    "- program.st, program.scl: code exports",
    ""
  ].join("\r\n");
  add("README.txt", readme);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
