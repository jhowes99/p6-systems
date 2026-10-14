/**
 * Human-readable commissioning reports (PDF and DOCX) for non-technical users.
 * Complements the JSON/CSV files in the commissioning packet.
 */

import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

/**
 * Build PDF buffer: Validation, Accepted Exceptions, Test Results in plain language.
 * @param {{ validation?: object, exceptions?: object, tests?: object, generatedAt: string }} data
 * @returns {Promise<Buffer>}
 */
export function buildCommissioningReportPDF(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50 });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { validation, exceptions, tests, generatedAt } = data;

    doc.fontSize(18).text("Commissioning Report", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text("Generated: " + (generatedAt || new Date().toISOString()), { align: "center" });
    doc.moveDown(2);

    // --- Validation ---
    doc.fontSize(14).text("1. Validation Summary", { underline: true });
    doc.moveDown(0.5);
    if (validation) {
      doc.fontSize(11).text("Last run: " + (validation.lastRunAt || "—"));
      doc.text("Score: " + (validation.score ?? "—") + "  |  Errors: " + (validation.errorCount ?? 0) + "  |  Warnings: " + (validation.warningCount ?? 0));
      doc.moveDown(0.5);
      const errList = validation.errors || [];
      const warnList = validation.warnings || [];
      if (errList.length > 0) {
        doc.fontSize(10).text("Errors:", { continued: false });
        errList.forEach((e) => doc.fontSize(9).text("  • " + (typeof e === "string" ? e : (e.message || e.rule || JSON.stringify(e)))));
        doc.moveDown(0.3);
      }
      if (warnList.length > 0) {
        doc.fontSize(10).text("Warnings:", { continued: false });
        warnList.forEach((w) => doc.fontSize(9).text("  • " + (typeof w === "string" ? w : (w.message || w.rule || JSON.stringify(w)))));
      }
    } else {
      doc.text("No validation data available.");
    }
    doc.moveDown(1.5);

    // --- Accepted Exceptions ---
    doc.fontSize(14).text("2. Accepted Exceptions (Traceability)", { underline: true });
    doc.moveDown(0.5);
    const exList = exceptions?.exceptions || [];
    if (exList.length > 0) {
      doc.fontSize(10).text("Findings that were accepted as exceptions (who accepted, when):");
      doc.moveDown(0.3);
      exList.forEach((ex) => {
        doc.fontSize(9).text("  • " + (ex.rule || ex.id || "") + (ex.tag ? " — " + ex.tag : "") + " — Accepted by " + (ex.acceptedBy || "—") + " on " + (ex.acceptedAt || "—"));
      });
    } else {
      doc.text("No accepted exceptions.");
    }
    doc.moveDown(1.5);

    // --- Test Results ---
    doc.fontSize(14).text("3. Test Results (FAT/SAT)", { underline: true });
    doc.moveDown(0.5);
    const summary = tests?.summary;
    const results = tests?.results || [];
    if (summary) {
      doc.fontSize(11).text("Last run: " + (summary.lastRunAt || "—"));
      doc.text("Status: " + (summary.status || "—") + "  |  Passed: " + (summary.passed ?? 0) + "  |  Failed: " + (summary.failed ?? 0) + "  |  Total: " + (summary.total ?? 0));
      doc.moveDown(0.5);
      if (results.length > 0) {
        doc.fontSize(10).text("Results:");
        results.forEach((r) => {
          const name = r.name ?? r.test ?? r.id ?? "—";
          const ok = r.passed ?? r.pass;
          const msg = r.message ?? r.error ?? "";
          doc.fontSize(9).text("  • " + name + " — " + (ok ? "PASS" : "FAIL") + (msg ? ": " + msg : ""));
        });
      }
    } else {
      doc.text("No test run data available.");
    }

    doc.moveDown(2);
    doc.fontSize(9).text("This report is generated from the same data as the JSON files in this packet. Use the JSON files for automated traceability.", { align: "center" });
    doc.end();
  });
}

/**
 * Build DOCX buffer: same content as PDF, in Word format.
 * @param {{ validation?: object, exceptions?: object, tests?: object, generatedAt: string }} data
 * @returns {Promise<Buffer>}
 */
export async function buildCommissioningReportDOCX(data) {
  const { validation, exceptions, tests, generatedAt } = data;
  const generated = generatedAt || new Date().toISOString();

  const children = [
    new Paragraph({
      text: "Commissioning Report",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER
    }),
    new Paragraph({
      children: [new TextRun({ text: "Generated: " + generated, size: 20 })],
      alignment: AlignmentType.CENTER
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      text: "1. Validation Summary",
      heading: HeadingLevel.HEADING_1
    })
  ];

  if (validation) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Last run: " + (validation.lastRunAt || "—") + "  |  Score: " + (validation.score ?? "—") + "  |  Errors: " + (validation.errorCount ?? 0) + "  |  Warnings: " + (validation.warningCount ?? 0)
          })
        ]
      })
    );
    const errList = validation.errors || [];
    const warnList = validation.warnings || [];
    if (errList.length > 0) {
      children.push(new Paragraph({ text: "Errors:", heading: HeadingLevel.HEADING_2 }));
      errList.forEach((e) =>
        children.push(new Paragraph({ children: [new TextRun({ text: "• " + (typeof e === "string" ? e : (e.message || e.rule || JSON.stringify(e))), size: 18 })] }))
      );
    }
    if (warnList.length > 0) {
      children.push(new Paragraph({ text: "Warnings:", heading: HeadingLevel.HEADING_2 }));
      warnList.forEach((w) =>
        children.push(new Paragraph({ children: [new TextRun({ text: "• " + (typeof w === "string" ? w : (w.message || w.rule || JSON.stringify(w))), size: 18 })] }))
      );
    }
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: "No validation data available." })] }));
  }

  children.push(new Paragraph({ text: "" }), new Paragraph({ text: "2. Accepted Exceptions (Traceability)", heading: HeadingLevel.HEADING_1 }));

  const exList = exceptions?.exceptions || [];
  if (exList.length > 0) {
    children.push(new Paragraph({ children: [new TextRun("Findings accepted as exceptions (who, when):")] }));
    exList.forEach((ex) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "• " + (ex.rule || ex.id || "") + (ex.tag ? " — " + ex.tag : "") + " — Accepted by " + (ex.acceptedBy || "—") + " on " + (ex.acceptedAt || "—"),
              size: 18
            })
          ]
        })
      );
    });
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: "No accepted exceptions." })] }));
  }

  children.push(new Paragraph({ text: "" }), new Paragraph({ text: "3. Test Results (FAT/SAT)", heading: HeadingLevel.HEADING_1 }));

  const summary = tests?.summary;
  const results = tests?.results || [];
  if (summary) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Last run: " + (summary.lastRunAt || "—") + "  |  Status: " + (summary.status || "—") + "  |  Passed: " + (summary.passed ?? 0) + "  |  Failed: " + (summary.failed ?? 0) + "  |  Total: " + (summary.total ?? 0)
          })
        ]
      })
    );
    if (results.length > 0) {
      results.forEach((r) => {
        const name = r.name ?? r.test ?? r.id ?? "—";
        const ok = r.passed ?? r.pass;
        const msg = r.message ?? r.error ?? "";
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "• " + name + " — " + (ok ? "PASS" : "FAIL") + (msg ? ": " + msg : ""), size: 18 })]
          })
        );
      });
    }
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: "No test run data available." })] }));
  }

  children.push(
    new Paragraph({ text: "" }),
    new Paragraph({
      children: [
        new TextRun({
          text: "This report is generated from the same data as the JSON files in this packet. Use the JSON files for automated traceability.",
          italics: true,
          size: 18
        })
      ],
      alignment: AlignmentType.CENTER
    })
  );

  const doc = new Document({
    title: "Commissioning Report",
    creator: "P6 Systems",
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBuffer(doc);
}
