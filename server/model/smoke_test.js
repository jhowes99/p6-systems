/**
 * Phase 2 smoke test — run: node server/model/smoke_test.js
 * Does not require HTTP server.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initStore,
  listProjects,
  loadProject,
  createProject,
  deleteProject,
  getStorePaths,
  setDataRootOverride
} from "./store.js";
import { ensureWaterTransferProject } from "./seed_water_transfer.js";
import { ensureTankTransferDemoProject, TANK_TRANSFER_DEMO_NAME } from "./seed_tank_transfer_demo.js";
import { SCHEMA_VERSION, DataClass } from "./schema.js";
import { migrateProject } from "./migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tmpRoot = path.join(__dirname, "..", "data", "_smoke_canonical");
fs.rmSync(tmpRoot, { recursive: true, force: true });
setDataRootOverride(tmpRoot);

initStore();
const paths = getStorePaths();
assert(paths.root === tmpRoot, `store root mismatch: ${paths.root}`);

const { project, created } = ensureWaterTransferProject();
assert(created === true, "first seed should create");
assert(project.schemaVersion === SCHEMA_VERSION, "schema version");
assert(project.equipment.length === 10, `expected 10 equipment, got ${project.equipment.length}`);
assert(project.signals.length >= 10, "expected signals");
assert(project.equipment.every((e) => e.dataClass === DataClass.ENGINEER_APPROVED), "seed equipment approved");
assert(project.testCases.some((t) => t.name === "P101_ESTOP_SHUTDOWN"), "FAT definition present");
assert(project.ui?.graph?.nodes, "water transfer graph layout");
assert((project.connections || []).length >= 3, "water transfer process connections");

const tags = new Set(project.equipment.map((e) => e.tag));
for (const t of ["TANK101", "TANK102", "XV101", "P101", "M101", "LSH101", "ESTOP101", "LT101", "FT101", "PT101"]) {
  assert(tags.has(t), `missing equipment ${t}`);
}

const again = ensureWaterTransferProject();
assert(again.created === false, "second seed should be idempotent");
assert(again.project.id === project.id, "same project id");

const listed = listProjects();
assert(listed.length >= 1, "list projects");

const empty = createProject({ name: "Scratch Phase2" });
assert(empty.equipment.length === 0, "empty project");

const migrated = migrateProject({ name: "Legacy", schemaVersion: 0, equipment: [] });
assert(migrated.project.schemaVersion === SCHEMA_VERSION, "migration to current");
assert(migrated.migrationsApplied.includes("introduce-schema-v1"), "migration applied");

const v1only = migrateProject({ name: "V1 shape", schemaVersion: 1, equipment: [], signals: [] });
assert(v1only.project.schemaVersion === SCHEMA_VERSION, "v1 doc migrates to current schema");
if (SCHEMA_VERSION >= 2) {
  assert(v1only.migrationsApplied.includes("cem2-schema-v2"), "cem2 migration when on v2");
}

deleteProject(empty.id);
const loaded = loadProject(project.id);
assert(loaded?.name === "Water Transfer System", "reload water transfer");

const demo = ensureTankTransferDemoProject();
assert(demo.created === true, "§40 demo seed creates");
assert(demo.project.name === TANK_TRANSFER_DEMO_NAME, "demo name");
assert(demo.project.equipment.length === 7, `expected 7 §40 equipment, got ${demo.project.equipment.length}`);
const demoTags = new Set(demo.project.equipment.map((e) => e.tag));
for (const t of ["TANK-101", "TANK-102", "PUMP-101", "M-101", "VALVE-101", "LT-101", "ESD-101"]) {
  assert(demoTags.has(t), `missing §40 equipment ${t}`);
}
assert(demo.project.ui?.graph?.nodes, "demo default graph layout");
const demoAgain = ensureTankTransferDemoProject();
assert(demoAgain.created === false, "demo seed idempotent");

setDataRootOverride(null);
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Phase 2 smoke_test: PASS");
console.log(JSON.stringify({
  projectId: project.id,
  equipment: project.equipment.map((e) => e.tag),
  signals: project.signals.length,
  interlocks: project.interlocks.length,
  testCases: project.testCases.map((t) => t.name),
  part13Demo: {
    id: demo.project.id,
    equipment: [...demoTags]
  }
}, null, 2));
