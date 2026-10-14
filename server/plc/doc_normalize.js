/**
 * Normalize tag for consistent comparison and registry key.
 * - Trim whitespace
 * - Force UPPER case
 * - Standardize separators: underscore and spaces to single hyphen
 * - Remove double separators
 */
export function normalizeTag(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  // Common cleanup: collapse whitespace, remove stray punctuation around tags
  s = s.replace(/[()]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // Convert forms like "XV 312" or "XV- 312" or "XV312" into "XV-312"
  const m = s.match(/^([A-Za-z]{1,6})\s*[- ]?\s*(\d{1,6}[A-Za-z]?)$/);
  if (m) s = `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
  else {
    // Already dashed but with spaces: "PT - 101"
    const m2 = s.match(/^([A-Za-z]{1,6})\s*-\s*(\d{1,6}[A-Za-z]?)$/);
    if (m2) s = `${m2[1].toUpperCase()}-${m2[2].toUpperCase()}`;
    else s = s.toUpperCase();
  }
  // Standardize separators: underscore and spaces between parts to hyphen
  s = s.replace(/_/g, "-").replace(/\s+/g, "-");
  // Remove double separators
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s || "";
}

export function normalizeIoType(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  if (["DI", "DO", "AI", "AO"].includes(s)) return s;
  return "";
}

