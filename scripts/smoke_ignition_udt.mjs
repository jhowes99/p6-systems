/**
 * Milestone A — Ignition UDT package smoke (no Gateway required).
 * Usage: node scripts/smoke_ignition_udt.mjs
 */

import { initStore, getActiveProject } from "../server/model/store.js";
import { ensureWaterTransferProject } from "../server/model/seed_water_transfer.js";
import {
  generateUdtPackage,
  validateUdtPackage,
  TARGET_IGNITION_VERSION
} from "../server/connect/ignition_udt.js";

initStore();
ensureWaterTransferProject();

const project = getActiveProject();
if (!project) {
  console.error("FAIL: no active project");
  process.exit(1);
}

const pkg = generateUdtPackage(project, { typesFilter: ["pump"] });
const v = validateUdtPackage(pkg);

console.log("project=", project.name, project.id);
console.log("target=", pkg.targetIgnitionVersion);
console.log("udtTypes=", pkg.udtTypes.map((t) => t.name).join(", "));
console.log("instances=", pkg.udtInstances.map((i) => i.name).join(", "));
console.log("validation=", JSON.stringify(v));

if (pkg.targetIgnitionVersion !== TARGET_IGNITION_VERSION) {
  console.error("FAIL: version pin");
  process.exit(1);
}
if (!pkg.udtTypes.some((t) => t.name === "P6_Pump")) {
  console.error("FAIL: missing P6_Pump UDT");
  process.exit(1);
}
const pumpInst = pkg.udtInstances.find((i) => i.name === "P101");
if (!pumpInst) {
  console.error("FAIL: missing P101 instance");
  process.exit(1);
}
const runFb = pumpInst.members.find((m) => m.name === "RunningFeedback");
if (!runFb?.present || !runFb.opcuaNodeId || !runFb.p6Signal) {
  console.error("FAIL: RunningFeedback not bound to P6/OPC", runFb);
  process.exit(1);
}
if (!runFb.opcuaNodeId.includes("P101.RunningFeedback")) {
  console.error("FAIL: OPC NodeId path", runFb.opcuaNodeId);
  process.exit(1);
}
if (!v.ok) {
  console.error("FAIL: validation errors", v.errors);
  process.exit(1);
}

console.log("Ignition UDT smoke PASS");
