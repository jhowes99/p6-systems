/**
 * Extensible vendor codegen framework.
 * Primary: IEC 61131-3 ST. Others are adapters with honest capability claims.
 */

import { generateStructuredText } from "./st_generate.js";
import { exportSiemensSCL, exportAllenBradleyPlaceholder } from "../plc/exporters.js";

/** @typedef {{ id: string, name: string, languages: string[], deployableClaim: string, status: string }} VendorAdapter */

/** @type {Record<string, VendorAdapter>} */
export const VendorAdapters = {
  iec61131_st: {
    id: "iec61131_st",
    name: "IEC 61131-3 Structured Text (generic)",
    languages: ["st"],
    deployableClaim: "preliminary_review_only",
    status: "supported",
    notes: "Preferred export. Readable ST for engineer review — not auto-deployed to plant PLCs."
  },
  codesys: {
    id: "codesys",
    name: "CODESYS / IEC ST dialect",
    languages: ["st"],
    deployableClaim: "preliminary_review_only",
    status: "supported_via_st",
    notes: "Uses IEC ST output; CODESYS project packaging not generated."
  },
  siemens_scl: {
    id: "siemens_scl",
    name: "Siemens SCL (partial)",
    languages: ["scl"],
    deployableClaim: "not_validated_package",
    status: "partial",
    notes: "Best-effort SCL from ladder IR when present; model-first ST preferred."
  },
  allen_bradley: {
    id: "allen_bradley",
    name: "Allen-Bradley / Studio 5000",
    languages: ["placeholder"],
    deployableClaim: "placeholder_only",
    status: "placeholder",
    notes: "No validated L5X/ACD export — placeholder text only (KI-007)."
  }
};

export function listVendors() {
  return Object.values(VendorAdapters);
}

export function getVendor(id) {
  return VendorAdapters[id] || null;
}

/**
 * Generate vendor-targeted artifact with honesty metadata.
 */
export function generateForVendor(project, vendorId = "iec61131_st") {
  const vendor = getVendor(vendorId) || VendorAdapters.iec61131_st;

  if (vendor.id === "iec61131_st" || vendor.id === "codesys") {
    const artifact = generateStructuredText(project, { vendor: vendor.id });
    return {
      ok: true,
      vendor,
      artifact,
      deployable: false,
      message: "Preliminary ST generated. Engineer review required. Not a full vendor project package."
    };
  }

  if (vendor.id === "siemens_scl") {
    const st = generateStructuredText(project, { vendor: vendor.id });
    let scl = `(* Siemens SCL — preliminary wrapper around P6 ST *)\n${st.st}`;
    if (project.legacy?.ladderIR) {
      try {
        scl = exportSiemensSCL(project.legacy.ladderIR) + "\n\n" + scl;
      } catch {
        /* keep ST body */
      }
    }
    return {
      ok: true,
      vendor,
      artifact: { ...st, language: "scl", st: scl, limitations: [...st.limitations, vendor.notes] },
      deployable: false,
      message: "Partial SCL export — not a validated TIA Portal package."
    };
  }

  if (vendor.id === "allen_bradley") {
    const stub = exportAllenBradleyPlaceholder(project.legacy?.ladderIR || { networks: [] });
    return {
      ok: true,
      vendor,
      artifact: {
        id: `ab_${Date.now().toString(36)}`,
        language: "placeholder",
        vendor: vendor.id,
        generatedAt: new Date().toISOString(),
        modelVersion: project.modelVersion,
        status: "placeholder",
        st: stub,
        limitations: [vendor.notes, "Do not claim deployable Allen-Bradley package"]
      },
      deployable: false,
      message: "Allen-Bradley export is a placeholder only."
    };
  }

  return { ok: false, error: `Unknown vendor: ${vendorId}`, vendor: null };
}
