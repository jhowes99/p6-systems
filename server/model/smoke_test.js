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
assert(project.equipment.length === 6, `expected 6 equipment, got ${project.equipment.length}`);
assert(project.signals.length >= 10, "expected signals");
assert(project.equipment.every((e) => e.dataClass === DataClass.ENGINEER_APPROVED), "seed equipment approved");
assert(project.testCases.some((t) => t.name === "P101_ESTOP_SHUTDOWN"), "FAT definition present");

const tags = new Set(project.equipment.map((e) => e.tag));
for (const t of ["TANK101", "XV101", "P101", "M101", "LSH101", "ESTOP101"]) {
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

deleteProject(empty.id);
const loaded = loadProject(project.id);
assert(loaded?.name === "Water Transfer System", "reload water transfer");

setDataRootOverride(null);
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Phase 2 smoke_test: PASS");
console.log(JSON.stringify({
  projectId: project.id,
  equipment: project.equipment.map((e) => e.tag),
  signals: project.signals.length,
  interlocks: project.interlocks.length,
  testCases: project.testCases.map((t) => t.name)
}, null, 2));
