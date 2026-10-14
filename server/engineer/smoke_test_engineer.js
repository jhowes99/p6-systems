/**
 * P6 Engineer smoke: template apply + ST generate + impact.
 * Run: node server/engineer/smoke_test_engineer.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createEmptyProject, DataClass, createEquipment, createSignal, createInterlock, DataType, SignalDirection } from "../model/schema.js";
import { setDataRootOverride, initStore, saveProject } from "../model/store.js";
import { applyTemplateToEquipment, emptyEngineerState } from "./apply_template.js";
import { generateIoList, persistIoProposal } from "./io_generate.js";
import { suggestStrategies } from "./strategy.js";
import { generateStructuredText, persistStArtifact } from "./st_generate.js";
import { reviewLogic, regenerateAfterReview } from "./review.js";
import { analyzeSafetyScope, approveSafetyScope } from "./safety.js";
import { analyzeImpact } from "../model/impact.js";
import { listTemplates } from "./templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tmpRoot = path.join(__dirname, "..", "data", "_smoke_engineer");
fs.rmSync(tmpRoot, { recursive: true, force: true });
setDataRootOverride(tmpRoot);
initStore();

function buildMiniWaterTransfer() {
  const project = createEmptyProject({ name: "Engineer Smoke Water Transfer", id: "prj_engineer_smoke" });
  project.engineer = emptyEngineerState();

  const tank = createEquipment({
    projectId: project.id,
    tag: "TANK101",
    type: "tank",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  const valve = createEquipment({
    projectId: project.id,
    tag: "XV101",
    type: "valve",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  const pump = createEquipment({
    projectId: project.id,
    tag: "P101",
    type: "pump",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  const motor = createEquipment({
    projectId: project.id,
    tag: "M101",
    type: "motor",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  const lsh = createEquipment({
    projectId: project.id,
    tag: "LSH101",
    type: "level_switch",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  const estop = createEquipment({
    projectId: project.id,
    tag: "ESTOP101",
    type: "emergency_stop_input",
    dataClass: DataClass.ENGINEER_APPROVED
  });
  project.equipment.push(tank, valve, pump, motor, lsh, estop);

  const mk = (tag, eq, dir = SignalDirection.INPUT, dt = DataType.BOOL) =>
    createSignal({
      projectId: project.id,
      tag,
      equipmentId: eq.id,
      direction: dir,
      dataType: dt,
      dataClass: DataClass.ENGINEER_APPROVED,
      address: null
    });

  const sigs = [
    mk("LSH101.High", lsh),
    mk("ESTOP101.Healthy", estop),
    mk("XV101.OpenCommand", valve, SignalDirection.OUTPUT),
    mk("XV101.OpenedFeedback", valve),
    mk("XV101.ClosedFeedback", valve),
    mk("P101.RunCommand", pump, SignalDirection.OUTPUT),
    mk("P101.RunningFeedback", pump),
    mk("P101.Fault", pump),
    mk("M101.Energize", motor, SignalDirection.OUTPUT),
    mk("M101.Fault", motor)
  ];
  project.signals.push(...sigs);

  project.interlocks.push(
    createInterlock({
      projectId: project.id,
      name: "LSH101_INHIBIT",
      conditionSignalIds: [sigs[0].id],
      actionDescription: "High level inhibits transfer",
      inhibitsEquipmentIds: [pump.id, motor.id],
      dataClass: DataClass.ENGINEER_APPROVED
    }),
    createInterlock({
      projectId: project.id,
      name: "ESTOP101_SHUTDOWN",
      conditionSignalIds: [sigs[1].id],
      actionDescription: "E-stop de-energize (sim only)",
      inhibitsEquipmentIds: [pump.id, motor.id, valve.id],
      dataClass: DataClass.ENGINEER_APPROVED
    })
  );

  return { project, pump, valve };
}

console.log("P6 Engineer smoke starting…");

assert(listTemplates().length >= 8, "expected configurable templates");

const { project, pump } = buildMiniWaterTransfer();

const applied = applyTemplateToEquipment(project, {
  equipmentId: pump.id,
  templateId: "pump",
  fieldValues: { dutyStandby: "duty" }
});
assert(applied.ok, "template apply");
assert(project.equipment.find((e) => e.id === pump.id).properties.controlTemplateId === "pump", "template id on equipment");

const io = generateIoList(project);
persistIoProposal(project, io);
assert(io.lists.DI.length + io.lists.DO.length > 0, "I/O buckets");
assert(
  io.rows.every((r) => r.plcAddress === null || r.addressStatus !== "invented"),
  "no invented addresses"
);
assert(io.counts.unassignedHardware > 0, "unassigned hardware flagged");
assert(io.honesty.some((h) => /No physical PLC addresses were invented/i.test(h)), "honesty note");

const strategies = suggestStrategies(project);
assert(strategies.suggestions.some((s) => s.kind === "transfer"), "transfer strategy");

const artifact = generateStructuredText(project);
assert(/PROGRAM P6_PreliminaryControls/.test(artifact.st), "ST program");
assert(/TransferPermissive/.test(artifact.st), "permissive in ST");
assert(/ENGINEERING_INFERENCE/.test(artifact.st), "classification in header");
assert(/not certified safety/i.test(artifact.st), "E-stop honesty in ST");

const persisted = persistStArtifact(project, artifact);
assert(persisted.ok, "persist ST");

const sampleDir = path.join(__dirname, "..", "data", "engineer_samples");
fs.mkdirSync(sampleDir, { recursive: true });
const samplePath = path.join(sampleDir, "smoke_water_transfer_preliminary.st");
fs.writeFileSync(samplePath, artifact.st, "utf8");
assert(fs.existsSync(samplePath), "sample ST written");

saveProject(project, { bumpVersion: false });

const impact = analyzeImpact(project.id, { entityType: "equipment", entityId: pump.id });
assert(impact.ok, "impact ok");
assert((impact.affected.signals || []).length > 0, "impact signals");
assert(Array.isArray(impact.affected.logic), "impact logic array");
assert(Array.isArray(impact.affected.ioProposals), "impact ioProposals");
assert(Array.isArray(impact.affected.hmi), "impact hmi");
assert(impact.regenerateAfterApproval?.recommended, "regenerate after approval");
assert((impact.affected.templateApplications || []).length >= 1, "template apps in impact");

const review = reviewLogic(project, {
  artifactId: artifact.id,
  decision: "approve",
  reviewer: "smoke_tester"
});
assert(review.ok && review.review.status === "approved", "approve logic");

const blocked = regenerateAfterReview(project, {});
assert(!blocked.ok, "regenerate blocked after approve without force");

const mod = reviewLogic(project, {
  artifactId: artifact.id,
  decision: "modify",
  modifiedSt: artifact.st + "\n(* ENGINEER MANUAL EDIT *)\n",
  reviewer: "smoke_tester"
});
assert(mod.ok && mod.artifact.manualEdits, "manual edit preserved flag");

const stillBlocked = regenerateAfterReview(project, {});
assert(!stillBlocked.ok, "regenerate still blocked with manual edits");

const safety = analyzeSafetyScope(project);
assert(safety.silClaims.length === 0, "no SIL claims");
assert(safety.requiresQualifiedApproval, "qualified approval required");
let threw = false;
try {
  approveSafetyScope(project, { approver: "x", statement: "y", acknowledgeSimOnly: false });
} catch {
  threw = true;
}
assert(threw, "safety approve requires acknowledgeSimOnly");

const safOk = approveSafetyScope(project, {
  approver: "Qualified Engineer",
  statement: "Reviewed sim E-stop scope only — no SIL assigned",
  acknowledgeSimOnly: true
});
assert(safOk.ok && safOk.codegen === false, "safety approval without codegen");

console.log("sample ST:", samplePath);
console.log("P6 Engineer smoke_test_engineer: PASS");
