/**
 * Engineering package zip — approved model + config + artifacts + verify evidence.
 * Deployment-oriented artifacts require explicit engineer approval.
 * Never auto-writes to physical PLCs.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import { collectEngineeringArtifacts } from "./engineering_artifacts.js";
import { generatePreliminaryHmiConfig } from "./hmi_config.js";
import { getConnectArchitecture } from "../connect/adapters.js";
import { buildAllFatDocs } from "../verify/fat_docs.js";
import { loadVerifyResults, loadLastAcceptance } from "../verify/results_store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPROVAL_DIR = path.join(__dirname, "..", "data", "exports");

function ensureDir() {
  if (!fs.existsSync(APPROVAL_DIR)) fs.mkdirSync(APPROVAL_DIR, { recursive: true });
}

function approvalPath(projectId) {
  return path.join(APPROVAL_DIR, `package_approval_${projectId || "default"}.json`);
}

export function getPackageApproval(projectId) {
  const file = approvalPath(projectId);
  if (!fs.existsSync(file)) {
    return {
      approved: false,
      projectId: projectId || null,
      actor: null,
      approvedAt: null,
      note: "Engineer approval required before deployment-oriented package download."
    };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { approved: false, projectId, error: "Corrupt approval file" };
  }
}

export function approveEngineeringPackage(projectId, { actor = "engineer", note = "" } = {}) {
  ensureDir();
  const body = {
    approved: true,
    projectId: projectId || null,
    actor: String(actor),
    note: String(note || ""),
    approvedAt: new Date().toISOString(),
    neverAutoWritePhysicalPlc: true,
    honestyLabel:
      "Approval authorizes download of VIRTUAL engineering package artifacts — not physical PLC deploy."
  };
  fs.writeFileSync(approvalPath(projectId), JSON.stringify(body, null, 2), "utf8");
  return body;
}

export function revokeEngineeringPackageApproval(projectId) {
  const file = approvalPath(projectId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { approved: false, projectId };
}

/**
 * Build package contents object (no zip yet).
 */
export function buildPackageManifest(project, { verifyReport = null, acceptance = null } = {}) {
  const verify = verifyReport || loadVerifyResults();
  const accept = acceptance || loadLastAcceptance();
  const artifacts = collectEngineeringArtifacts(project, {
    verifyReport: verify,
    simResults: accept?.baseline || null
  });
  const hmi = generatePreliminaryHmiConfig(project);
  const connect = getConnectArchitecture(project?.id);
  const fatDocs = buildAllFatDocs(project, verify);
  const approval = getPackageApproval(project?.id);

  const warnings = [
    "VIRTUAL test evidence only — physical FAT not complete",
    "Ignition live path unproven (KI-019)",
    "Allen-Bradley export is placeholder",
    "Never auto-write to physical PLCs",
    ...(artifacts.missingKinds.length
      ? [`Missing artifact kinds (no data): ${artifacts.missingKinds.join(", ")}`]
      : [])
  ];

  return {
    ok: true,
    packageVersion: 1,
    projectId: project?.id || null,
    projectName: project?.name || null,
    modelVersion: project?.modelVersion ?? null,
    generatedAt: new Date().toISOString(),
    approval,
    evidenceClass: "VIRTUAL",
    honestyLabel:
      "Engineering package for review / virtual commissioning. Not a completed physical FAT and not a live PLC deployment.",
    neverAutoWritePhysicalPlc: true,
    artifacts,
    hmi,
    connect,
    fatDocs,
    verify,
    acceptanceSummary: accept
      ? {
          id: accept.id,
          executedAt: accept.executedAt,
          failEvidenceMatched: accept.failEvidence?.matchedExpectation ?? null,
          correctedStatus: accept.correctedRerun?.status ?? null
        }
      : null,
    warnings,
    modelSnapshot: {
      id: project?.id,
      name: project?.name,
      modelVersion: project?.modelVersion,
      schemaVersion: project?.schemaVersion,
      equipmentCount: project?.equipment?.length || 0,
      signalCount: project?.signals?.length || 0,
      interlockCount: project?.interlocks?.length || 0,
      testCaseCount: project?.testCases?.length || 0,
      dataClassificationNote: "Full approved model JSON included when package is built"
    }
  };
}

/**
 * @returns {Promise<{ buffer: Buffer, manifest: object, filename: string }>}
 */
export async function buildEngineeringPackageZip(project, opts = {}) {
  const forcePreview = !!opts.forcePreview;
  const approval = getPackageApproval(project?.id);
  if (!approval.approved && !forcePreview) {
    const err = new Error(
      "Engineering package not approved. Call POST /api/exports/package/approve first, or pass forcePreview=1 for review-only download."
    );
    err.code = "NOT_APPROVED";
    throw err;
  }

  const manifest = buildPackageManifest(project, opts);
  const zip = new JSZip();

  zip.file("MANIFEST.json", JSON.stringify(manifest, null, 2));
  zip.file(
    "README.txt",
    [
      "P6 Systems — Engineering Package",
      `Generated: ${manifest.generatedAt}`,
      `Project: ${manifest.projectName || manifest.projectId}`,
      `Model version: ${manifest.modelVersion}`,
      `Approval: ${approval.approved ? `yes by ${approval.actor} @ ${approval.approvedAt}` : "PREVIEW ONLY"}`,
      "",
      "EVIDENCE CLASS: VIRTUAL",
      "Do not claim physical FAT complete.",
      "Do not treat this zip as authorization to write physical PLCs.",
      "Ignition live deploy is not claimed.",
      "",
      "Warnings:",
      ...manifest.warnings.map((w) => `- ${w}`),
      ""
    ].join("\r\n")
  );

  // Approved model (system of record snapshot)
  zip.file("model/project.json", JSON.stringify(project, null, 2));

  // Artifacts
  for (const a of manifest.artifacts.artifacts || []) {
    if (!a.present) continue;
    if (a.csv) zip.file(`artifacts/${a.kind}.csv`, a.csv);
    if (a.markdown) zip.file(`artifacts/${a.kind}.md`, a.markdown);
    if (a.json) zip.file(`artifacts/${a.kind}.json`, JSON.stringify(a.json, null, 2));
    if (a.kind === "st") {
      if (a.codesys) zip.file("artifacts/program.st", String(a.codesys));
      if (a.siemens) zip.file("artifacts/program.scl", String(a.siemens));
      if (a.allenBradley != null) {
        zip.file(
          "artifacts/allen_bradley_placeholder.json",
          typeof a.allenBradley === "string"
            ? a.allenBradley
            : JSON.stringify(a.allenBradley, null, 2)
        );
      }
    }
  }

  zip.file("hmi/preliminary_screen.json", JSON.stringify(manifest.hmi, null, 2));
  zip.file("connect/architecture.json", JSON.stringify(manifest.connect, null, 2));
  zip.file("verify/fat_docs.json", JSON.stringify(manifest.fatDocs, null, 2));
  if (manifest.verify) {
    zip.file("verify/last_results.json", JSON.stringify(manifest.verify, null, 2));
  }
  zip.file("approval.json", JSON.stringify(approval, null, 2));
  zip.file(
    "WARNINGS.txt",
    manifest.warnings.join("\r\n") +
      "\r\n\r\nNEVER AUTO-WRITE TO PHYSICAL PLCs.\r\n"
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `p6_engineering_package_${project?.id || "project"}_v${project?.modelVersion ?? 0}_${stamp}.zip`;

  return { buffer, manifest, filename, approval, forcePreview };
}
