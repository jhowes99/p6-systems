export function irContainsPython(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.op === "PY_CALL" || obj.op === "PY_FB") return true;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.some(irContainsPython)) return true;
    if (v && typeof v === "object" && irContainsPython(v)) return true;
  }
  return false;
}
