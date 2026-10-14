/**
 * P6 Engineer — public module surface.
 */

export { ControlTemplates, listTemplates, getTemplate } from "./templates.js";
export { applyTemplateToEquipment, suggestAndApplyDefaults, approveTemplateApplication } from "./apply_template.js";
export { generateIoList, approveIoAddresses } from "./io_generate.js";
export { suggestStrategies } from "./strategy.js";
export { generateStructuredText, persistStArtifact } from "./st_generate.js";
export { listVendors, generateForVendor } from "./vendors.js";
export { reviewLogic, regenerateAfterReview, listLogicArtifacts } from "./review.js";
export { analyzeSafetyScope, approveSafetyScope, SAFETY_DISCLAIMER } from "./safety.js";
export { createEngineerRouter } from "./routes.js";
