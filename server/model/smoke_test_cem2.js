/**
 * CEM 2.0 smoke — schema v2, validation, impact, adapters.
 * Run: node server/model/smoke_test_cem2.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setDataRootOverride, initStore, loadProject, updateProject, getStorePaths } from "./store.js";
import { ensureWaterTransferProject } from "./seed_water_transfer.js";
import { ensureTankTransferDemoProject } from "./seed_tank_transfer_demo.js";
import { SCHEMA_VERSION, createEmptyProject, ValidationStatus } from "./schema.js";
import { migrateProject } from "./migrate.js";
import { validateProject, attachLastValidation, snapshotValidation } from "./validate.js";
import { analyzeImpact } from "./impact.js";
import {
  buildModelGraph,
  getInterlocksForEquipment,
  findRoleSignals,
  classifySignalRole
} from "./model_adapter.js";
import { analyzeEquipmentXRay } from "./xray.js";
import { buildVendorMappingExport } from "../connect/vendor_mapping.js";
import { ProjectRuntimeBridge } from "../plc/project_binding.js";
import { VirtualPLC } from "../plc/runtime.js";
import { IOModel } from "../plc/io.js";
import { createEquipment, DataClass } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tmpRoot = path.join(__dirname, "..", "data", "_smoke_cem2");
fs.rmSync(tmpRoot, { recursive: true, force: true });
setDataRootOverride(tmpRoot);
initStore();
assert(getStorePaths().root === tmpRoot, "store root");

assert(SCHEMA_VERSION === 2, "expected schema v2");

const v1Doc = {
  schemaVersion: 1,
  id: "prj_legacy_v1",
  name: "Legacy v1",
  modelVersion: 3,
  equipment: [{ id: "eq1", tag: "P101", type: "pump", dataClass: "ENGINEER_APPROVED" }],
  signals: [],
  customExtensionField: "preserve-me"
};
const migrated = migrateProject(v1Doc);
assert(migrated.project.schemaVersion === 2, "migrated to v2");
assert(migrated.migrationsApplied.includes("cem2-schema-v2"), "v2 migration name");
assert(migrated.project.customExtensionField === "preserve-me", "unknown top-level preserved");
assert(Array.isArray(migrated.project.controlSequences), "controlSequences array");
assert(Array.isArray(migrated.project.vendorMappings), "vendorMappings array");
assert(migrated.project.equipment[0].validationStatus === ValidationStatus.UNKNOWN, "entity validationStatus");

const { project: wt } = ensureWaterTransferProject();
assert(wt.schemaVersion === SCHEMA_VERSION, "water transfer schema");
const validation = validateProject(wt);
assert(validation.ok, `water transfer validation ok: ${JSON.stringify(validation.issues)}`);
assert(validation.errorCount === 0, "no validation errors on seed");

const pump = wt.equipment.find((e) => e.tag === "P101");
assert(pump, "P101 exists");
const ilks = getInterlocksForEquipment(wt, pump.id);
assert(ilks.length >= 1, "interlocks from model adapter");

const impact = analyzeImpact(wt.id, { entityType: "equipment", entityId: pump.id });
assert(impact.affected.signals.length >= 1, "impact lists signals");
assert(Array.isArray(impact.affected.equipment) && impact.affected.equipment.includes(pump.tag), "impact equipment dep");
assert(
  Array.isArray(impact.affected.verifyCatalogRefs) &&
    impact.affected.verifyCatalogRefs.includes("P101_ESTOP_SHUTDOWN"),
  "impact verify catalog refs from model testCases"
);

const roles = findRoleSignals(wt, pump.id, []);
assert(roles.esd || roles.level_high, "adapter finds interlock role signals from model");
assert(classifySignalRole("ESTOP101.Healthy") === "esd", "classify esd role");

const graph = buildModelGraph(wt, { equipmentId: pump.id });
assert(graph.nodes.some((n) => n.kind === "interlock"), "graph includes interlock nodes");

const live = (wt.signals || []).map((s) => ({
  ...s,
  currentValue: s.tag.includes("Healthy")
    ? true
    : s.tag.includes("Opened")
      ? true
      : s.initialValue
}));
const xray = analyzeEquipmentXRay({
  projectId: wt.id,
  equipmentId: pump.id,
  signals: live,
  mem: { M0: false, M1: false }
});
assert(xray.relationshipSource === "canonical_model_preferred", "xray prefers canonical relationships");
assert(
  (xray.conditions || []).some((c) => c.derivedFrom === "model"),
  "xray conditions derived from model when relationships exist"
);
assert(xray.health && Array.isArray(xray.narrative), "xray Phase 1 UI fields preserved");

const snap = snapshotValidation(wt);
assert(snap.validatedAt && typeof snap.ok === "boolean", "validation snapshot shape");
attachLastValidation(wt);
assert(wt.lastValidation?.validatedAt, "attachLastValidation sets lastValidation");

const beforeMv = wt.modelVersion;
updateProject(wt.id, (p) => {
  p.equipment.push(
    createEquipment({
      projectId: p.id,
      tag: "TMP-CEM2-VAL",
      type: "valve",
      dataClass: DataClass.ENGINEERING_INFERENCE
    })
  );
  attachLastValidation(p);
  return p;
});
const afterWrite = loadProject(wt.id);
assert(afterWrite.lastValidation?.validatedAt, "write path can persist lastValidation");
assert(afterWrite.modelVersion === beforeMv + 1, "single version bump on write+validation attach");
assert(
  (afterWrite.equipment || []).some((e) => e.tag === "TMP-CEM2-VAL"),
  "temp equipment created for validation write smoke"
);
updateProject(wt.id, (p) => {
  p.equipment = (p.equipment || []).filter((e) => e.tag !== "TMP-CEM2-VAL");
  attachLastValidation(p);
  return p;
});

const io = new IOModel();
const plc = new VirtualPLC({ io, scanMs: 50 });
const bridge = new ProjectRuntimeBridge({ io, plc });
const bound = bridge.bindProject(wt);
assert(bound.ok && bound.signalCount >= 10, "runtime bind after v2 load");

const vendor = buildVendorMappingExport(wt.id);
assert(vendor.mode === "PROPOSAL_ONLY", "vendor export stub mode");

const demo = ensureTankTransferDemoProject();
assert(demo.project.schemaVersion === SCHEMA_VERSION, "demo schema v2");
const demoVal = validateProject(demo.project);
assert(demoVal.errorCount === 0, "demo validation errors");

const empty = createEmptyProject({ name: "CEM2 empty" });
assert(empty.schemaVersion === 2 && empty.controlSequences.length === 0, "new project v2 shape");

setDataRootOverride(null);
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log("CEM 2.0 smoke_test_cem2: PASS");
console.log(
  JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      validation: { errors: validation.errorCount, warnings: validation.warningCount },
      impactSignals: impact.affected.signals.length,
      graphNodes: graph.nodes.length
    },
    null,
    2
  )
);
