/**
 * Logic review / approval workflow.
 * review → approve | reject | modify → regenerate (with preserve rules).
 * Never silently overwrite engineer-approved manual logic.
 */

import { DataClass } from "../model/schema.js";
import { emptyEngineerState } from "./apply_template.js";
import { generateStructuredText, persistStArtifact } from "./st_generate.js";

export const ReviewStatus = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  MODIFIED: "modified"
});

function getArtifact(project, artifactId) {
  project.engineer = project.engineer || emptyEngineerState();
  const fromEng = (project.engineer.logicArtifacts || []).find((a) => a.id === artifactId);
  if (fromEng) return { kind: "engineer", artifact: fromEng };
  const fromLogic = (project.controlLogic || []).find((c) => c.id === artifactId);
  if (fromLogic) return { kind: "controlLogic", artifact: fromLogic };
  return null;
}

/**
 * Start or update a review record for a logic artifact.
 */
export function reviewLogic(project, { artifactId, decision, comment = "", modifiedSt = null, reviewer = "engineer" } = {}) {
  if (!artifactId) throw new Error("artifactId required");
  if (!decision) throw new Error("decision required: approve | reject | modify");
  const dec = String(decision).toLowerCase();
  if (!["approve", "reject", "modify"].includes(dec)) {
    throw new Error("decision must be approve | reject | modify");
  }

  const found = getArtifact(project, artifactId);
  if (!found) throw new Error("Logic artifact not found");

  project.engineer = project.engineer || emptyEngineerState();
  project.engineer.logicReviews = project.engineer.logicReviews || [];

  const review = {
    id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    artifactId,
    decision: dec,
    status:
      dec === "approve"
        ? ReviewStatus.APPROVED
        : dec === "reject"
          ? ReviewStatus.REJECTED
          : ReviewStatus.MODIFIED,
    comment: String(comment || ""),
    reviewer,
    reviewedAt: new Date().toISOString(),
    modelVersion: project.modelVersion
  };

  const art = found.artifact;
  if (dec === "approve") {
    art.status = "approved";
    art.dataClass = DataClass.ENGINEER_APPROVED;
    art.approvedAt = review.reviewedAt;
    art.approvedBy = reviewer;
    // Mirror on controlLogic
    const cl = (project.controlLogic || []).find((c) => c.id === artifactId);
    if (cl) {
      cl.dataClass = DataClass.ENGINEER_APPROVED;
      cl.status = "approved";
      cl.updatedAt = review.reviewedAt;
    }
  } else if (dec === "reject") {
    art.status = "rejected";
    art.rejectedAt = review.reviewedAt;
    art.rejectReason = comment;
    const cl = (project.controlLogic || []).find((c) => c.id === artifactId);
    if (cl) {
      cl.status = "rejected";
      cl.updatedAt = review.reviewedAt;
    }
  } else if (dec === "modify") {
    if (modifiedSt == null || !String(modifiedSt).trim()) {
      throw new Error("modifiedSt required for modify decision");
    }
    art.st = String(modifiedSt);
    art.status = "modified";
    art.dataClass = DataClass.ENGINEER_APPROVED;
    art.manualEdits = true;
    art.modifiedAt = review.reviewedAt;
    art.modifiedBy = reviewer;
    const cl = (project.controlLogic || []).find((c) => c.id === artifactId);
    if (cl) {
      cl.sourceText = art.st;
      cl.manualEdits = true;
      cl.dataClass = DataClass.ENGINEER_APPROVED;
      cl.status = "modified";
      cl.updatedAt = review.reviewedAt;
    }
    review.preservedManualEdits = true;
  }

  project.engineer.logicReviews.push(review);
  return { ok: true, review, artifact: summarizeArtifact(art) };
}

function summarizeArtifact(art) {
  return {
    id: art.id,
    status: art.status,
    dataClass: art.dataClass,
    language: art.language,
    manualEdits: !!art.manualEdits,
    modelVersion: art.modelVersion,
    generatedAt: art.generatedAt,
    stLength: art.st ? art.st.length : art.sourceText ? art.sourceText.length : 0
  };
}

/**
 * Regenerate ST after review. Preserves approved manual edits unless forceOverwriteManual.
 */
export function regenerateAfterReview(project, { force = false, forceOverwriteManual = false } = {}) {
  const manual = (project.engineer?.logicArtifacts || []).find((a) => a.manualEdits && a.dataClass === DataClass.ENGINEER_APPROVED);
  if (manual && !forceOverwriteManual) {
    return {
      ok: false,
      error:
        "Manual engineer-approved ST edits present — regenerate blocked to preserve edits. Pass forceOverwriteManual:true only with explicit acknowledgement.",
      artifactId: manual.id
    };
  }

  const artifact = generateStructuredText(project, {});
  const persisted = persistStArtifact(project, artifact, { force: force || forceOverwriteManual });
  if (!persisted.ok) return persisted;

  project.engineer.logicReviews = project.engineer.logicReviews || [];
  project.engineer.logicReviews.push({
    id: `rev_${Date.now().toString(36)}`,
    artifactId: artifact.id,
    decision: "regenerate",
    status: ReviewStatus.PENDING,
    comment: forceOverwriteManual ? "Regenerated with forceOverwriteManual" : "Regenerated after review gate",
    reviewedAt: new Date().toISOString(),
    modelVersion: project.modelVersion
  });

  return { ok: true, artifact: summarizeArtifact(artifact), full: artifact };
}

export function listLogicArtifacts(project) {
  project.engineer = project.engineer || emptyEngineerState();
  const arts = project.engineer.logicArtifacts || [];
  return {
    ok: true,
    artifacts: arts.map(summarizeArtifact),
    reviews: project.engineer.logicReviews || [],
    controlLogic: (project.controlLogic || []).map((c) => ({
      id: c.id,
      name: c.name,
      language: c.language,
      status: c.status,
      dataClass: c.dataClass,
      manualEdits: !!c.manualEdits,
      version: c.version
    }))
  };
}

export function getLogicSource(project, artifactId) {
  const found = getArtifact(project, artifactId);
  if (!found) throw new Error("Artifact not found");
  const art = found.artifact;
  return {
    ok: true,
    id: art.id,
    status: art.status,
    dataClass: art.dataClass,
    language: art.language || "st",
    st: art.st || art.sourceText || "",
    manualEdits: !!art.manualEdits,
    traceability: art.traceability || null,
    limitations: art.limitations || []
  };
}
