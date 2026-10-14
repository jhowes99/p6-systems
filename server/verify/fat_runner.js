/**
 * P6 Verify — FAT runner (compat shim).
 * Implementation lives in catalog.js + runner.js; this file keeps prior import paths working.
 */

export {
  P101_ESTOP_SHUTDOWN,
  runFatTest,
  buildFatPdf
} from "./runner.js";

export {
  VERIFY_CATALOG,
  listCatalogSummaries,
  getCatalogTest,
  getExecutableCatalogIds,
  VerifyStatus,
  REQUIREMENT_TEMPLATES
} from "./catalog.js";
