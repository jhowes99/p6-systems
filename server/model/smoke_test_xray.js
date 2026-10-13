/**
 * X-Ray + connection API smoke (no HTTP server)
 * node server/model/smoke_test_xray.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initStore, setDataRootOverride, deleteProject } from "./store.js";
import { ensureTankTransferDemoProject } from "./seed_tank_transfer_demo.js";
import { analyzeEquipmentXRay } from "./xray.js";
import { updateProject, loadProject } from "./store.js";
import { createConnection } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(__dirname, "..", "data", "_smoke_xray");
fs.rmSync(tmp, { recursive: true, force: true });
setDataRootOverride(tmp);
initStore();

function assert(c, m) {
  if (!c) throw new Error(m);
}

const { project } = ensureTankTransferDemoProject();
const pump = project.equipment.find((e) => e.tag === "PUMP-101");
const valve = project.equipment.find((e) => e.tag === "VALVE-101");
assert(pump && valve, "pump/valve present");

const signalsClosed = project.signals.map((s) => ({
  ...s,
  currentValue: s.tag === "ESD-101.Healthy" ? true : s.tag.includes("Opened") ? false : s.initialValue
}));

const blocked = analyzeEquipmentXRay({
  projectId: project.id,
  equipmentId: pump.id,
  signals: signalsClosed,
  mem: { M0: false, M1: false }
});
assert(blocked.inhibited === true, "should be inhibited when valve closed");
assert(blocked.primaryBlocker?.id === "valve", `expected valve blocker, got ${blocked.primaryBlocker?.id}`);
assert(blocked.highlightEquipmentIds.includes(valve.id), "highlight includes valve");
assert(blocked.health?.state === "INHIBITED", "health.state inhibited");
assert(blocked.health?.primaryBlocker?.id === "valve", "health.primaryBlocker valve");
assert(Array.isArray(blocked.path) && blocked.path.length >= 2, "path steps present");
assert(blocked.path.some((p) => p.role === "PERMISSIVE"), "path includes PERMISSIVE");
assert(Array.isArray(blocked.narrative) && blocked.narrative.length >= 1, "narrative paragraphs");
assert(blocked.groups?.blockers?.some((b) => b.id === "valve"), "groups.blockers has valve");
assert(Array.isArray(blocked.verifyHints), "verifyHints present");
assert(blocked.relationshipSource === "canonical_model_preferred", "canonical relationship preference");
assert(
  (blocked.conditions || []).some((c) => c.id === "esd" && c.derivedFrom === "model"),
  "esd condition from model interlock walk"
);
assert(
  (blocked.conditions || []).some((c) => c.id === "valve" && (c.derivedFrom === "model" || c.derivedFrom === "heuristic")),
  "valve permissive present without inventing signals"
);

const signalsOpen = signalsClosed.map((s) =>
  s.tag === "VALVE-101.OpenedFeedback" ? { ...s, currentValue: true } : s
);
const ready = analyzeEquipmentXRay({
  projectId: project.id,
  equipmentId: pump.id,
  signals: signalsOpen,
  mem: { M0: false, M1: false }
});
assert(ready.inhibited === false, "ready when valve open + esd healthy");
assert(ready.canStart === true, "canStart");
assert(ready.health?.state === "READY" || ready.health?.canStart === true, "health ready");
assert(ready.groups?.blockers?.length === 0, "no blockers when ready");

// Extra connection create/delete via store
const tank = project.equipment.find((e) => e.tag === "TANK-101");
const before = project.connections.length;
updateProject(project.id, (p) => {
  p.connections.push(
    createConnection({
      projectId: p.id,
      fromEquipmentId: tank.id,
      toEquipmentId: valve.id,
      connectionType: "process",
      description: "test link"
    })
  );
  return p;
});
const mid = loadProject(project.id);
assert(mid.connections.length === before + 1, "connection added");
const extra = mid.connections.find((c) => c.description === "test link");
updateProject(project.id, (p) => {
  p.connections = p.connections.filter((c) => c.id !== extra.id);
  return p;
});
const end = loadProject(project.id);
assert(end.connections.length === before, "connection removed");

deleteProject(project.id);
setDataRootOverride(null);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("PASS smoke_test_xray");
