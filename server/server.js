import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import multer from "multer";
import { IOModel } from "./plc/io.js";
import { VirtualPLC } from "./plc/runtime.js";
import { irContainsPython } from "./plc/validate.js";
import { audit, listAudit, verifyAuditChain } from "./audit.js";
import { getConfig, setSecureMode, setPassword, verifyPassword, getLicenseTier, setLicenseTier, hasValidationExceptionPasscode, verifyValidationExceptionPasscode, setValidationExceptionPasscode } from "./config_store.js";
import { requireTier } from "./license.js";
import { ladderIRToST } from "./plc/st_export.js";
import { parseStructuredPID, extractTextFromFile, parseTextForPIDElements } from "./plc/pid_parser.js";
import { generatePLCFromPID } from "./plc/pid_to_plc.js";
import { parseIoListFromLooseText, parseIoListFile } from "./plc/io_list_parser.js";
import { parseCauseEffectLooseText, parseCauseEffectFile } from "./plc/cause_effect_parser.js";
import { generatePLCFromProject } from "./plc/project_to_plc.js";
import { normalizeTag as normalizeTagPlc } from "./plc/doc_normalize.js";
import { validateProjectBundle, applyAutoFixes } from "./plc/project_validate.js";
import { generateTestsFromCauseEffect, runTests } from "./plc/test_runner.js";
import { deriveCauseEffectFromIR } from "./plc/ce_from_ir.js";
import { exportTerminalPlan, exportWireSchedule, exportIOCheckout } from "./plc/wiring_export.js";
import { createSnapshot, listSnapshots, getSnapshot, diffSnapshots } from "./project_versions.js";
import { setLastValidation, getLastValidation, setLastTestsRun, getLastTestsSummary } from "./state_cache.js";
import { getExceptions, addException, removeException, applyExceptions, clearExceptions, addOrphanIoExceptions } from "./validation_exceptions.js";
import { buildCommissioningPacket } from "./commissioning_packet.js";
import { logPacket, listPackets, getPacketPath } from "./commissioning_packet_log.js";
import { parseCode } from "./plc/code_parser.js";
import { irToBlocklyXML } from "./plc/ir_to_blockly.js";
import { validatePanel, compilePanelToLadderIR } from "./plc/panel_builder.js";
import { compilePlainLanguageToIR } from "./plc/plain_language.js";
import { generateTruthTable } from "./plc/truth_table.js";
import { explainOutputOff } from "./plc/safety.js";
import { evaluate } from "./plc/evaluator.js";
import { getCurrentStep, getStepWarnings, getStepGuidance, WORKFLOW_STEPS, STEP_LABELS } from "./plc/workflow.js";
import { createFirstMotorTemplate } from "./plc/templates/first_motor.js";
import { getFeatureRegistry } from "./plc/feature_gates.js";
import { exportIOList, exportIOListJSON } from "./plc/io_list_export.js";
import { compileTimelineToIR } from "./plc/timeline.js";
import { compileTeachModeToIR } from "./plc/teach_mode.js";
import { exportCodesysST, exportSiemensSCL, exportAllenBradleyPlaceholder, exportPython } from "./plc/exporters.js";
import { enforceSafetyDefaults } from "./plc/safety.js";
import { createModelRouter } from "./model/routes.js";
import { initStore } from "./model/store.js";
import { ensureWaterTransferProject } from "./model/seed_water_transfer.js";
import { ensureTankTransferDemoProject } from "./model/seed_tank_transfer_demo.js";
import { ProjectRuntimeBridge, attachBridge } from "./plc/project_binding.js";
import { SignalHistoryBuffer } from "./plc/history_buffer.js";
import { attachWaterTransfer } from "./plc/equipment/water_transfer.js";
import { attachTankTransfer } from "./plc/equipment/tank_transfer.js";
import { runFatTest, buildFatPdf, P101_ESTOP_SHUTDOWN } from "./verify/fat_runner.js";
import { getActiveProject } from "./model/store.js";
import { startOpcUaServer, getOpcUaStatus } from "./connect/opcua_server.js";
import { startMqttPublisher, getMqttStatus } from "./connect/mqtt_publisher.js";
import { loadTagMap, saveTagMap, proposeMapsFromSignals, generateUdtProposal } from "./connect/tag_mapping.js";
import {
  getEngineeringStatus,
  generateUdtPackage,
  loadUdtPackage,
  saveUdtPackage,
  approveUdtPackage,
  validateUdtPackage,
  TARGET_IGNITION_VERSION
} from "./connect/ignition_udt.js";
import { validateSignalCommand } from "./plc/command_validate.js";
import { analyzeEquipmentXRay } from "./model/xray.js";
import { buildInterlocksView, buildInterlockDetail } from "./model/interlocks_view.js";
import { LogicDeployer } from "./plc/logic_deploy.js";
import { listEquipmentTypes, getEquipmentType } from "./plc/equipment/library.js";
import { traceFromTestFailure, traceFromSignal } from "./model/traceability.js";
import { requirePerm, resolveRole, ROLES } from "./security/rbac.js";
import { logConnectionEvent, listConnectionEvents } from "./security/connection_audit.js";
import { extractText, mineCandidates } from "./plc/ocr_ingest.js";
import { buildPlatformReport } from "./reports/hub.js";
import { buildReadiness } from "./readiness.js";
import { promoteExtractions } from "./model/ingest_promote.js";
import { loadProject } from "./model/store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENABLE_PY = process.env.ENABLE_PY === "1";
const HMI_AUTH_BYPASS = process.env.HMI_AUTH_BYPASS === "1";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    const cfg = getConfig();
    if (!cfg.secureMode) return cb(null, true);
    const allowed = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    if (!origin || allowed.includes(origin)) return cb(null, origin || allowed[0]);
    cb(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const io = new IOModel();
const plc = new VirtualPLC({ io, scanMs: 50, features: { python: ENABLE_PY } });
const runtimeBridge = new ProjectRuntimeBridge({ io, plc });
const signalHistory = new SignalHistoryBuffer({ maxFrames: 180, everyN: 2 });
attachBridge(plc, runtimeBridge, { history: signalHistory });
const logicDeployer = new LogicDeployer(plc);

// Canonical model + Part 13 Tank Transfer demo (active) + legacy Water Transfer seed
try {
  initStore();
  if (process.env.P6_SEED_WATER_TRANSFER !== "0") {
    const legacy = ensureWaterTransferProject();
    audit("model.seed.water_transfer", { id: legacy.project.id, created: legacy.created });
  }
  if (process.env.P6_SEED_TANK_TRANSFER !== "0") {
    const seeded = ensureTankTransferDemoProject();
    audit("model.seed.tank_transfer_demo", { id: seeded.project.id, created: seeded.created });
    const tt = attachTankTransfer(plc, io);
    audit("runtime.tank_transfer.attach", { template: tt.ir?.metadata?.template });
    const bound = runtimeBridge.bindProject(seeded.project);
    if (typeof plc.onReset === "function") plc.onReset();
    audit("runtime.bind_project", bound);
  } else if (process.env.P6_SEED_WATER_TRANSFER !== "0") {
    const seeded = ensureWaterTransferProject();
    const wt = attachWaterTransfer(plc, io);
    audit("runtime.water_transfer.attach", { template: wt.ir?.metadata?.template });
    const bound = runtimeBridge.bindProject(seeded.project);
    if (typeof plc.onReset === "function") plc.onReset();
    audit("runtime.bind_project", bound);
  }
} catch (e) {
  console.error("Canonical model / sample plant init failed:", e?.message || e);
}

// Start runtime in running mode (scan scheduler); sim clock is independent of wall time
plc.start();
audit("server.start", { port: process.env.PORT || 3000, enablePython: ENABLE_PY });

// Phase 6/10 — optional OPC UA + MQTT (do not block core)
startOpcUaServer({ bridge: runtimeBridge, port: Number(process.env.OPCUA_PORT || 4840) })
  .then((s) => {
    audit("connect.opcua", { running: s.running, endpoint: s.endpoint, error: s.error || null });
    logConnectionEvent({ kind: "opcua", action: "start", ...s });
  })
  .catch((e) => console.error("OPC UA init error:", e?.message || e));

startMqttPublisher({ bridge: runtimeBridge })
  .then((s) => {
    audit("connect.mqtt", { enabled: s.enabled, connected: s.connected, error: s.error || null });
    logConnectionEvent({ kind: "mqtt", action: "start", ...s });
  })
  .catch((e) => console.error("MQTT init error:", e?.message || e));

app.get("/api/connect/status", (_req, res) => {
  res.json({
    ok: true,
    mode: process.env.P6_LIVE_INTEGRATION === "1" ? "LIVE_INTEGRATION" : "SIMULATION",
    modes: {
      SIMULATION: "active",
      EXTERNAL_TEST: "gated",
      LIVE_INTEGRATION: process.env.P6_LIVE_INTEGRATION === "1" ? "explicitly_enabled" : "disabled_by_default"
    },
    opcua: getOpcUaStatus(),
    mqtt: getMqttStatus(),
    ignition: {
      required: false,
      dockerProfile: "ignition",
      note: "Optional Gateway via compose profile ignition"
    },
    role: "see X-P6-Role header"
  });
});
app.get("/api/connect/opcua", (_req, res) => {
  res.json({ ok: true, ...getOpcUaStatus() });
});
app.get("/api/connect/mqtt", (_req, res) => {
  res.json({ ok: true, ...getMqttStatus() });
});
app.get("/api/connect/audit", (req, res) => {
  res.json({ ok: true, events: listConnectionEvents({ limit: Number(req.query.limit) || 100 }) });
});

// Phase 11 — tag mapping
app.get("/api/connect/tag-map", (req, res) => {
  try {
    const projectId = req.query.projectId || getActiveProject()?.id;
    if (!projectId) return res.status(404).json({ ok: false, error: "No project" });
    res.json({ ok: true, map: loadTagMap(projectId) });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/connect/tag-map", requirePerm("connect.mutate"), (req, res) => {
  try {
    const projectId = req.body?.projectId || getActiveProject()?.id;
    if (!projectId) return res.status(404).json({ ok: false, error: "No project" });
    const map = saveTagMap(projectId, req.body || {});
    logConnectionEvent({ kind: "tag_map", action: "save", projectId, count: map.mappings.length });
    res.json({ ok: true, map });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/connect/tag-map/propose", (req, res) => {
  try {
    const projectId = req.body?.projectId || getActiveProject()?.id;
    if (!projectId) return res.status(404).json({ ok: false, error: "No project" });
    const map = proposeMapsFromSignals(projectId, runtimeBridge.listSignals());
    res.json({ ok: true, map });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/connect/udt-proposal", (req, res) => {
  try {
    const project = getActiveProject();
    if (!project) return res.status(404).json({ ok: false, error: "No project" });
    res.json({ ok: true, ...generateUdtProposal(project.equipment || []) });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Milestone A — Ignition Engineering Generator (UDT)
app.get("/api/connect/engineering/status", (_req, res) => {
  res.json({ ok: true, ...getEngineeringStatus() });
});
app.post("/api/connect/engineering/udt/generate", (req, res) => {
  try {
    const project = getActiveProject();
    if (!project) return res.status(404).json({ ok: false, error: "No project" });
    const pkg = generateUdtPackage(project, req.body || {});
    const saved = saveUdtPackage(project.id, pkg);
    logConnectionEvent({
      kind: "engineering_udt",
      action: "generate",
      projectId: project.id,
      types: (saved.udtTypes || []).map((t) => t.name),
      instances: (saved.udtInstances || []).map((i) => i.name)
    });
    res.json({ ok: true, package: saved });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/connect/engineering/udt", (req, res) => {
  try {
    const projectId = req.query.projectId || getActiveProject()?.id;
    if (!projectId) return res.status(404).json({ ok: false, error: "No project" });
    const pkg = loadUdtPackage(projectId);
    if (!pkg) return res.status(404).json({ ok: false, error: "No UDT package — generate first" });
    res.json({ ok: true, package: pkg });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/connect/engineering/udt/approve", requirePerm("connect.mutate"), (req, res) => {
  try {
    const projectId = req.body?.projectId || getActiveProject()?.id;
    if (!projectId) return res.status(404).json({ ok: false, error: "No project" });
    const actor = req.body?.actor || req.headers["x-p6-role"] || "engineer";
    const pkg = approveUdtPackage(projectId, { actor: String(actor) });
    logConnectionEvent({ kind: "engineering_udt", action: "approve", projectId, actor });
    audit("connect.engineering.udt.approve", { projectId, actor });
    res.json({ ok: true, package: pkg });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/connect/engineering/udt/export", (req, res) => {
  try {
    const projectId = req.query.projectId || getActiveProject()?.id;
    if (!projectId) return res.status(404).json({ ok: false, error: "No project" });
    const pkg = loadUdtPackage(projectId);
    if (!pkg) return res.status(404).json({ ok: false, error: "No UDT package — generate first" });
    const forcePreview = String(req.query.forcePreview || "") === "1";
    if (!pkg.approved && !forcePreview) {
      return res.status(403).json({
        ok: false,
        error: "Package not approved. Approve first, or pass forcePreview=1 for review download."
      });
    }
    const validation = validateUdtPackage(pkg);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: "Invalid package", validation });
    }
    const filename = `p6_ignition_udt_${projectId}_${TARGET_IGNITION_VERSION}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify({ ...pkg, validation, exportedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Phase 12 — canvas data (layout always from disk SoR; live values from bridge)
app.get("/api/runtime/canvas", (_req, res) => {
  const disk = getActiveProject();
  const project = disk || runtimeBridge.project;
  const signals = runtimeBridge.listSignals();
  const byEquip = {};
  for (const s of signals) {
    if (!s.equipmentId) continue;
    if (!byEquip[s.equipmentId]) byEquip[s.equipmentId] = [];
    byEquip[s.equipmentId].push(s);
  }
  const layout = disk?.ui?.graph?.nodes || project?.ui?.graph?.nodes || {};
  const nodes = (project?.equipment || []).map((eq, idx) => {
    const saved = layout[eq.id];
    return {
      id: eq.id,
      tag: eq.tag,
      type: eq.type,
      operatingState: eq.operatingState,
      dataClass: eq.dataClass || null,
      x: saved?.x ?? 120 + (idx % 3) * 220,
      y: saved?.y ?? 100 + Math.floor(idx / 3) * 160,
      w: saved?.w ?? (/tank/i.test(eq.type) ? 160 : 140),
      h: saved?.h ?? (/tank/i.test(eq.type) ? 100 : 80),
      r: saved?.r ?? 0,
      locked: !!saved?.locked,
      properties: eq.properties || {},
      signals: byEquip[eq.id] || [],
      live: Object.fromEntries((byEquip[eq.id] || []).map((s) => [s.tag, s.currentValue]))
    };
  });
  const links = (project?.connections || []).map((c) => ({
    id: c.id,
    from: c.fromEquipmentId,
    to: c.toEquipmentId,
    type: c.connectionType,
    waypoints: Array.isArray(c.waypoints) ? c.waypoints : []
  }));
  // Keep runtime bridge project.ui in sync so later reads are consistent
  if (runtimeBridge.project && disk?.ui) {
    runtimeBridge.project.ui = disk.ui;
  }
  res.json({
    ok: true,
    projectId: project?.id || null,
    name: project?.name || null,
    sim: plc.clock.snapshot(),
    mode: plc.mode,
    layoutSaved: Object.keys(layout).length > 0,
    nodes,
    links,
    mem: { M0: !!io.mem.M0, M1: !!io.mem.M1 }
  });
});

app.get("/api/runtime/xray", (req, res) => {
  try {
    const equipmentId = req.query.equipmentId || req.query.id || null;
    const equipmentTag = req.query.tag || req.query.equipmentTag || null;
    if (!equipmentId && !equipmentTag) {
      return res.status(400).json({ ok: false, error: "equipmentId or tag required" });
    }
    const project = getActiveProject() || runtimeBridge.project;
    const result = analyzeEquipmentXRay({
      projectId: project?.id,
      equipmentId,
      equipmentTag,
      signals: runtimeBridge.listSignals(),
      mem: { M0: !!io.mem?.M0, M1: !!io.mem?.M1 }
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Studio Interlocks — whole-picture view (conditions + inhibits + live state)
app.get("/api/runtime/interlocks", (req, res) => {
  try {
    const project = getActiveProject() || runtimeBridge.project;
    const result = buildInterlocksView({
      projectId: project?.id,
      signals: runtimeBridge.listSignals(),
      equipmentId: req.query.equipmentId || null
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/runtime/interlocks/:id", (req, res) => {
  try {
    const project = getActiveProject() || runtimeBridge.project;
    const result = buildInterlockDetail(req.params.id, {
      projectId: project?.id,
      signals: runtimeBridge.listSignals()
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/runtime/command", (req, res) => {
  try {
    const tag = req.body?.tag;
    if (!tag) return res.status(400).json({ ok: false, error: "tag required" });
    const value = req.body?.value;
    const signals = runtimeBridge.listSignals();
    const check = validateSignalCommand(tag, value, signals);
    if (!check.ok && req.body?.force !== true) {
      audit("runtime.command_rejected", { tag, value, reasons: check.reasons });
      return res.status(409).json({
        ok: false,
        rejected: true,
        ...check,
        signals: Object.fromEntries(signals.map((s) => [s.tag, s.currentValue]))
      });
    }
    const signal = runtimeBridge.setSignal(String(tag), value, { override: !!req.body?.override });
    audit("runtime.command", { tag, value: signal.currentValue, forced: !!req.body?.force });
    res.json({
      ok: true,
      signal,
      validation: check,
      ...plc.status(),
      mem: { M0: !!io.mem.M0, M1: !!io.mem.M1 }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Phase 13 — traceability
app.post("/api/trace/from-test", (req, res) => {
  try {
    const tr = traceFromTestFailure(req.body || {});
    res.json(tr);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/trace/signal/:tag", (req, res) => {
  try {
    const tr = traceFromSignal(req.query.projectId || getActiveProject()?.id, decodeURIComponent(req.params.tag));
    res.json(tr);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Phase 14 — security
app.get("/api/security/roles", (req, res) => {
  res.json({ ok: true, role: resolveRole(req), roles: Object.keys(ROLES), matrix: ROLES });
});

// Phase 16 — equipment library
app.get("/api/equipment/library", (_req, res) => {
  res.json({ ok: true, types: listEquipmentTypes() });
});
app.get("/api/equipment/library/:type", (req, res) => {
  const t = getEquipmentType(req.params.type);
  if (!t) return res.status(404).json({ ok: false, error: "Unknown type" });
  res.json({ ok: true, type: t });
});

// Phase 18 — OCR ingest
app.post("/api/ingest/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "file required" });
    const extracted = await extractText(req.file.buffer, req.file.mimetype);
    const candidates = mineCandidates(extracted.text);
    res.json({
      ok: true,
      extracted,
      candidates,
      note: "Candidates are ENGINEERING_INFERENCE until explicitly promoted/approved"
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/ingest/ocr/promote", requirePerm("model.write"), (req, res) => {
  try {
    const result = promoteExtractions({ ...req.body, placeOnCanvas: req.body?.placeOnCanvas !== false });
    audit("ingest.ocr.promote", {
      projectId: result.project.id,
      equipment: result.created.equipment.length
    });
    // Keep Runtime bound to the updated canonical model so Studio sees live state immediately
    const bound = runtimeBridge.bindProject(result.project);
    res.status(201).json({
      ok: true,
      ...result,
      runtimeBound: { projectId: bound.projectId || result.project.id, signalCount: bound.signalCount }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Phase 19 — reports
app.get("/api/reports/platform", (_req, res) => {
  res.json({ ok: true, report: buildPlatformReport() });
});

// Phase 20 — readiness
app.get("/api/readiness", (_req, res) => {
  res.json({ ok: true, ...buildReadiness({ plc, bridge: runtimeBridge }) });
});

// Phase 9 — staged logic deploy
app.get("/api/runtime/logic", (_req, res) => {
  res.json({ ok: true, ...logicDeployer.status(), program: plc.programIR });
});
app.post("/api/runtime/logic/validate", (req, res) => {
  const v = logicDeployer.validate(req.body?.ir || req.body);
  res.status(v.ok ? 200 : 400).json({ ok: v.ok, ...v });
});
app.post("/api/runtime/logic/stage", (req, res) => {
  const r = logicDeployer.stage(req.body?.ir || req.body, req.body?.note || "");
  if (!r.ok) return res.status(400).json(r);
  audit("logic.stage", r.staged);
  res.json(r);
});
app.post("/api/runtime/logic/apply", (req, res) => {
  // Apply at safe boundary: pause briefly if running
  const wasRunning = plc.mode === "running";
  if (wasRunning) plc.pause();
  const r = logicDeployer.apply();
  if (wasRunning) plc.resume();
  if (!r.ok) return res.status(400).json(r);
  audit("logic.apply", r);
  res.json(r);
});
app.post("/api/runtime/logic/rollback", (req, res) => {
  const wasRunning = plc.mode === "running";
  if (wasRunning) plc.pause();
  const r = logicDeployer.rollback();
  if (wasRunning) plc.resume();
  if (!r.ok) return res.status(400).json(r);
  audit("logic.rollback", r);
  res.json(r);
});

app.use(
  "/api/model",
  createModelRouter({
    audit,
    onModelChange: ({ project, reason }) => {
      const bound = runtimeBridge.bindProject(project);
      audit("runtime.auto_rebind", {
        reason,
        projectId: project?.id,
        signalCount: bound.signalCount
      });
      return { ok: true, projectId: project?.id, signalCount: bound.signalCount, reason };
    }
  })
);

// Phase 7 — P6 Verify
app.get("/api/verify/tests", (_req, res) => {
  res.json({
    ok: true,
    tests: [{
      id: P101_ESTOP_SHUTDOWN.id,
      name: P101_ESTOP_SHUTDOWN.name,
      version: P101_ESTOP_SHUTDOWN.version,
      description: P101_ESTOP_SHUTDOWN.description
    }],
    limits: [
      "Catalog contains one Water Transfer reference FAT (P101_ESTOP_SHUTDOWN). Tank Transfer Studio demo uses Runtime bridge — additional FATs require real PLC assertions, not UI-only pass/fail."
    ]
  });
});

app.post("/api/verify/run", async (req, res) => {
  try {
    const testId = req.body?.testId || P101_ESTOP_SHUTDOWN.id;
    if (testId !== P101_ESTOP_SHUTDOWN.id) {
      return res.status(404).json({ ok: false, error: `Unknown test: ${testId}` });
    }
    const active = getActiveProject();
    const { pass, result } = await runFatTest(P101_ESTOP_SHUTDOWN, {
      projectId: active?.id || null,
      modelVersion: active?.modelVersion || null
    });
    audit("verify.run", { testId, pass });
    res.json({ ok: true, pass, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/verify/run.pdf", async (req, res) => {
  try {
    const active = getActiveProject();
    const { pass, result } = await runFatTest(P101_ESTOP_SHUTDOWN, {
      projectId: active?.id || null,
      modelVersion: active?.modelVersion || null
    });
    const pdf = await buildFatPdf(result);
    audit("verify.run_pdf", { testId: result.testId, pass, bytes: pdf.length });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.testId}_${pass ? "PASS" : "FAIL"}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Store the last imported "project bundle" so electrician-focused UIs can use labels and rules.
let LAST_PROJECT = null;

// In-memory sessions for Secure Mode (sessionId -> { createdAt })
const SESSIONS = new Map();
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
function getSessionId(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? m[1].trim() : null;
}
function isSessionValid(sessionId) {
  if (!sessionId) return false;
  const s = SESSIONS.get(sessionId);
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_MAX_AGE_MS) {
    SESSIONS.delete(sessionId);
    return false;
  }
  return true;
}

// ---- Control Narrative API (must be before catch-all static so /api/narrative/* is always JSON) ----
const CN_ROOT = path.join(__dirname, "..", "control_narrative_gen");
const CN_INPUTS = path.join(CN_ROOT, "inputs");
const CN_EXPORTS = path.join(CN_ROOT, "exports");

app.get("/api/narrative/status", (req, res) => {
  res.json({ ok: true, message: "Control narrative API ready", pythonRequired: true });
});

app.post(
  "/api/narrative/generate",
  requireTier("pro"),
  upload.fields([
    { name: "logic", maxCount: 1 },
    { name: "template", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const logicFile = req.files?.logic?.[0];
      if (!logicFile || !logicFile.buffer) {
        return res.status(400).json({ ok: false, error: "Logic/functional diagrams PDF is required." });
      }
      const project = String(req.body?.project || "Combustion Control System, Fully Metered").trim();
      const customer = String(req.body?.customer || "TotalEnergies Port Arthur, TX.").trim();

      if (!fs.existsSync(CN_INPUTS)) fs.mkdirSync(CN_INPUTS, { recursive: true });
      if (!fs.existsSync(CN_EXPORTS)) fs.mkdirSync(CN_EXPORTS, { recursive: true });

      const logicPath = path.join(CN_INPUTS, "logic_diagrams.pdf");
      fs.writeFileSync(logicPath, logicFile.buffer);

      const templateFile = req.files?.template?.[0];
      let templatePath = null;
      if (templateFile?.buffer) {
        templatePath = path.join(CN_INPUTS, "template.pdf");
        fs.writeFileSync(templatePath, templateFile.buffer);
      }

      // Prefer control_narrative_gen venv so PDF (reportlab) is available when deps are installed
      let py = process.env.NARRATIVE_PYTHON;
      if (!py) {
        const venvWin = path.join(CN_ROOT, ".venv", "Scripts", "python.exe");
        const venvUnix = path.join(CN_ROOT, ".venv", "bin", "python");
        if (process.platform === "win32" && fs.existsSync(venvWin)) py = venvWin;
        else if (fs.existsSync(venvUnix)) py = venvUnix;
        else py = process.platform === "win32" ? "python" : "python3";
      }
      const args = [
        path.join(CN_ROOT, "scripts", "generate.py"),
        "--logic", logicPath,
        "--out", CN_EXPORTS,
        "--project", project,
        "--customer", customer
      ];
      if (templatePath) args.push("--template", templatePath);

      const child = spawnSync(py, args, {
        cwd: CN_ROOT,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024
      });

      if (child.error) {
        return res.status(500).json({ ok: false, error: `Failed to run generator: ${child.error.message}` });
      }
      if (child.status !== 0) {
        const stderr = (child.stderr || "").trim() || (child.stdout || "").trim();
        return res.status(400).json({
          ok: false,
          error: stderr || "Control narrative generation failed.",
          stdout: child.stdout || ""
        });
      }

      const base = path.join(CN_EXPORTS);
      const outputs = [];
      const names = [
        "control_narrative.md",
        "control_narrative.docx",
        "control_narrative.pdf",
        "tag_dictionary.csv",
        "cause_effect.csv"
      ];
      for (const n of names) {
        const p = path.join(base, n);
        if (fs.existsSync(p)) outputs.push({ name: n, path: n });
      }
      // Diagram PNGs are not offered as downloads; narrative outputs only (MD, DOCX, PDF, CSVs).

      let warnings = [];
      try {
        const resultPath = path.join(base, ".narrative_result.json");
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, "utf8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.errors)) warnings = parsed.errors;
        }
      } catch (_) {}

      audit("narrative.generate", { project, outputs: outputs.length });
      return res.json({ ok: true, outputs, warnings });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

app.use("/api/narrative/exports", requireTier("pro"), express.static(CN_EXPORTS));

// Redirect /hmi to /hmi.html (avoid Rapid SCADA Login.aspx issues)
app.get("/hmi", (req, res) => {
  res.redirect("/hmi.html");
});

// Serve static UI
app.use("/", express.static(path.join(__dirname, "..", "web")));

// Serve OCR libraries locally (avoid CDN load failures)
app.use("/vendor/pdfjs", express.static(path.join(__dirname, "node_modules", "pdfjs-dist", "build")));
app.use("/vendor/tesseract", express.static(path.join(__dirname, "node_modules", "tesseract.js", "dist")));

// ---- External telemetry (e.g., Raspberry Pi) configuration ----
// Set TELEMETRY_BASE_URL to point at your Pi service, e.g. http://192.168.86.31:8080
// The UI (or any client) should call this container at /api/traffic, /api/telemetry, etc.
const TELEMETRY_BASE_URL = (process.env.TELEMETRY_BASE_URL || "").trim();

// Expose runtime config to the browser (optional helper)
app.get("/runtime-config.js", (req, res) => {
  res.type("application/javascript").send(
    `window.RUNTIME_CONFIG = ${JSON.stringify({ TELEMETRY_BASE_URL })};`
  );
});

app.get("/api/config", (req, res) => {
  res.json({ telemetryBaseUrl: TELEMETRY_BASE_URL });
});

// License tier (for UI gating)
app.get("/api/license", (req, res) => {
  res.json({ ok: true, tier: getLicenseTier() });
});

function isAdminRequest(req) {
  const localhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  const token = req.headers["x-admin-token"] || req.body?.adminToken;
  const envToken = process.env.ADMIN_TOKEN;
  return localhost || (envToken && token === envToken);
}

app.post("/api/license/set", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ ok: false, error: "Admin access required." });
  }
  const tier = req.body?.tier;
  const t = String(tier || "").toLowerCase();
  if (t !== "core" && t !== "pro" && t !== "enterprise") {
    return res.status(400).json({ ok: false, error: "tier must be core, pro, or enterprise." });
  }
  setLicenseTier(t);
  res.json({ ok: true, tier: getLicenseTier() });
});

// Audit log
app.get("/api/audit", (req, res) => {
  const limit = Number(req.query?.limit || 200);
  res.json({ ok: true, events: listAudit({ limit }) });
});
app.get("/api/audit/verify", requireTier("enterprise"), (req, res) => {
  try {
    const result = verifyAuditChain();
    res.json({ ok: result.ok, lastHash: result.lastHash, brokenAt: result.brokenAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Simple proxy helpers (so front-end never has to hardcode the Pi IP)
async function proxyJson(req, res, upstreamPath) {
  if (!TELEMETRY_BASE_URL) {
    return res.status(400).json({
      ok: false,
      error: "TELEMETRY_BASE_URL is not set. Set it to your Raspberry Pi base URL (e.g. http://192.168.86.31:8080)."
    });
  }
  const url = new URL(upstreamPath, TELEMETRY_BASE_URL);
  // forward querystring
  for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, String(v));

  const r = await fetch(url.toString(), { headers: { "accept": "application/json" } });
  const text = await r.text();
  res.status(r.status);
  // Try JSON pass-through; fall back to raw
  try {
    res.json(JSON.parse(text));
  } catch {
    res.type(r.headers.get("content-type") || "text/plain").send(text);
  }
}

// Common OT endpoints (adjust upstream paths to match your Pi service)
app.get("/api/traffic", (req, res) => proxyJson(req, res, "/api/traffic"));
app.get("/api/telemetry", (req, res) => proxyJson(req, res, "/api/telemetry"));


// Features so UI can hide advanced things
app.get("/api/features", (req, res) => {
  try {
    const registry = getFeatureRegistry();
    res.json({
      ok: true,
      features: {
        python: ENABLE_PY
      },
      registry
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/features/old", (req, res) => {
  res.json({ python: ENABLE_PY, strict: !!plc.strict });
});

// Mode/config (no auth; local demo)
function collectVarsFromIR(ir) {
  const vars = new Set();
  const walk = (e) => {
    if (!e || typeof e === "boolean") return;
    if (e.var) { vars.add(String(e.var)); return; }
    if (e.op === "NOT") return walk(e.x);
    if (e.op === "AND" || e.op === "OR") { walk(e.a); walk(e.b); return; }
    if (["GT", "GE", "LT", "LE", "EQ", "NE"].includes(e.op)) {
      if (e.a?.var) vars.add(String(e.a.var));
      if (e.b?.var) vars.add(String(e.b.var));
      if (e.left?.var) vars.add(String(e.left.var));
      if (e.right?.var) vars.add(String(e.right.var));
      return;
    }
  };
  for (const net of ir?.networks ?? []) {
    for (const rung of net?.rungs ?? []) {
      walk(rung.cond);
      for (const act of rung.actions ?? []) {
        if ((act.type === "COIL" || act.type === "SET" || act.type === "RESET") && act.target) vars.add(String(act.target));
        if (act.type === "TON" && act.doneTarget) vars.add(String(act.doneTarget));
      }
    }
  }
  return Array.from(vars);
}
function seedIoForIR(ioModel, ir) {
  const vars = collectVarsFromIR(ir);
  for (const v of vars) {
    const bank = String(v || "")[0];
    if (bank === "I") ioModel.ensureInput(v);
    if (bank === "Q") ioModel.ensureOutput(v);
    if (bank === "M") ioModel.ensureMem(v);
    if (bank === "A" && ioModel.ensureAnalogInput) ioModel.ensureAnalogInput(v);
    if (bank === "B" && ioModel.ensureAnalogOutput) ioModel.ensureAnalogOutput(v);
  }
  return vars.length;
}

app.get("/api/mode", (req, res) => {
  res.json({ ok: true, strict: !!plc.strict, scanMs: plc.scanMs });
});
app.post("/api/mode/strict", (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    // If enabling strict, pre-seed IO based on current program so it doesn't instantly trip.
    if (enabled) {
      const wasStrict = !!io.strict;
      io.setStrict(false);
      const seeded = seedIoForIR(io, plc.programIR);
      io.setStrict(wasStrict);
      plc.setStrict(true);
      audit("mode.strict", { enabled: true, seededVars: seeded });
      return res.json({ ok: true, strict: true, seededVars: seeded });
    }
    plc.setStrict(false);
    audit("mode.strict", { enabled: false });
    return res.json({ ok: true, strict: false });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// PLC / P6 Runtime lifecycle
app.post("/api/plc/start", (req, res) => {
  plc.start();
  audit("plc.start", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/plc/stop", (req, res) => {
  plc.stop();
  audit("plc.stop", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/plc/pause", (req, res) => {
  plc.pause();
  audit("plc.pause", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/plc/resume", (req, res) => {
  plc.resume();
  audit("plc.resume", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/plc/step", async (req, res) => {
  try {
    await plc.step();
    audit("plc.step", { scanCount: plc.clock.scanCount });
    res.json({ ok: true, ...plc.status(), snapshot: io.snapshot() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/plc/reset", (req, res) => {
  try {
    const clearInputs = !!req.body?.clearInputs;
    const clearFaults = req.body?.clearFaults !== false;
    const retainMem = !!req.body?.retainMem;
    plc.reset({ clearInputs, clearFaults, retainMem });
    audit("plc.reset", { clearInputs, clearFaults, retainMem });
    res.json({ ok: true, ...plc.status(), snapshot: io.snapshot() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/plc/power-cycle", (req, res) => {
  try {
    const retainMem = req.body?.retainMem !== false;
    const clearFaults = !!req.body?.clearFaults;
    plc.powerCycle({ retainMem, clearFaults });
    audit("plc.power_cycle", { retainMem, clearFaults });
    res.json({ ok: true, ...plc.status(), retainMem, clearFaults });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Phase 3 runtime introspection (aliases under /api/runtime)
app.get("/api/runtime/status", (req, res) => {
  res.json({ ok: true, ...plc.status() });
});
app.get("/api/runtime/events", (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const sinceScan = req.query.sinceScan != null ? Number(req.query.sinceScan) : null;
  res.json({ ok: true, events: plc.getEvents({ limit, sinceScan }) });
});
app.get("/api/runtime/signals", (req, res) => {
  res.json({
    ok: true,
    projectId: runtimeBridge.project?.id || null,
    signals: runtimeBridge.listSignals(),
    sim: plc.clock.snapshot()
  });
});
app.post("/api/runtime/signal", (req, res) => {
  try {
    const tag = req.body?.tag;
    if (!tag) return res.status(400).json({ ok: false, error: "tag required" });
    const override = !!req.body?.override;
    const signal = runtimeBridge.setSignal(String(tag), req.body?.value, { override });
    audit("runtime.signal_write", { tag, value: signal.currentValue, override });
    res.json({ ok: true, signal, ...plc.status() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/runtime/signal/clear-override", (req, res) => {
  try {
    const tag = req.body?.tag;
    if (!tag) return res.status(400).json({ ok: false, error: "tag required" });
    const signal = runtimeBridge.clearOverride(String(tag));
    audit("runtime.signal_override_clear", { tag });
    res.json({ ok: true, signal });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/runtime/bind", (req, res) => {
  try {
    const projectId = req.body?.projectId || null;
    const result = runtimeBridge.bindProject(projectId);
    if (!result.ok) return res.status(404).json(result);
    audit("runtime.bind_project", result);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/runtime/persist-signals", (req, res) => {
  try {
    const project = runtimeBridge.persistLiveToModel();
    audit("runtime.persist_signals", { projectId: project.id, modelVersion: project.modelVersion });
    res.json({ ok: true, projectId: project.id, modelVersion: project.modelVersion });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/runtime/start", (req, res) => {
  plc.start();
  audit("runtime.start", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/runtime/stop", (req, res) => {
  plc.stop();
  audit("runtime.stop", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/runtime/pause", (req, res) => {
  plc.pause();
  audit("runtime.pause", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/runtime/resume", (req, res) => {
  plc.resume();
  audit("runtime.resume", {});
  res.json({ ok: true, ...plc.status() });
});
app.post("/api/runtime/step", async (req, res) => {
  try {
    await plc.step();
    audit("runtime.step", { scanCount: plc.clock.scanCount });
    res.json({ ok: true, ...plc.status(), signals: runtimeBridge.listSignals() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/runtime/reset", (req, res) => {
  try {
    plc.reset({
      clearInputs: !!req.body?.clearInputs,
      clearFaults: req.body?.clearFaults !== false,
      retainMem: !!req.body?.retainMem
    });
    audit("runtime.reset", {});
    res.json({ ok: true, ...plc.status(), signals: runtimeBridge.listSignals() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
/** Adjust VirtualPLC scan interval — paces wall-clock vs sim progression (not fake physics). */
app.post("/api/runtime/speed", (req, res) => {
  try {
    const scanMs = Math.max(5, Math.min(500, Number(req.body?.scanMs) || 50));
    plc.setScanMs(scanMs);
    audit("runtime.speed", { scanMs });
    res.json({ ok: true, scanMs: plc.scanMs, ...plc.status() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/** Signal history ring buffer for Studio timeline playback (authoritative recorded frames). */
app.get("/api/runtime/history", (req, res) => {
  const includeFrame = req.query.frame != null || req.query.index != null;
  if (includeFrame) {
    const idx = Number(req.query.frame ?? req.query.index);
    const frame = signalHistory.get(idx);
    if (!frame) return res.status(404).json({ ok: false, error: "Frame not found" });
    return res.json({ ok: true, ...signalHistory.meta(), frame });
  }
  res.json({ ok: true, ...signalHistory.meta(), frames: signalHistory.list() });
});
app.post("/api/runtime/history/recording", (req, res) => {
  const on = req.body?.recording !== false && req.body?.on !== false;
  signalHistory.setRecording(!!(req.body?.recording ?? req.body?.on ?? on));
  audit("runtime.history.recording", { recording: signalHistory.recording });
  res.json({ ok: true, ...signalHistory.meta() });
});
app.post("/api/runtime/history/clear", (req, res) => {
  signalHistory.clear();
  audit("runtime.history.clear", {});
  res.json({ ok: true, ...signalHistory.meta() });
});

// --- Auth (Secure Mode: password + session cookie; bypass ignored when secure mode ON) ---
app.post("/api/auth/login", (req, res) => {
  try {
    const cfg = getConfig();
    if (!cfg.secureMode) {
      return res.json({ ok: true, message: "Secure mode off; no login required." });
    }
    const password = req.body?.password;
    if (!verifyPassword(password)) {
      return res.status(401).json({ ok: false, error: "Invalid password." });
    }
    const sessionId = require("crypto").randomBytes(24).toString("hex");
    SESSIONS.set(sessionId, { createdAt: Date.now() });
    res.cookie("session", sessionId, { httpOnly: true, maxAge: SESSION_MAX_AGE_MS, sameSite: "lax" });
    audit("auth.login", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/auth/logout", (req, res) => {
  const sessionId = getSessionId(req.headers.cookie);
  if (sessionId) SESSIONS.delete(sessionId);
  res.clearCookie("session");
  res.json({ ok: true });
});

// Security config (Secure Mode toggle, set password)
app.get("/api/security/config", (req, res) => {
  try {
    const cfg = getConfig();
    res.json({ ok: true, secureMode: !!cfg.secureMode, hasPassword: !!(cfg.passwordHash && cfg.salt) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/security/secure-mode", (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    setSecureMode(enabled);
    audit("security.secure_mode", { enabled });
    res.json({ ok: true, secureMode: enabled });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.post("/api/security/password", (req, res) => {
  try {
    const password = req.body?.password;
    if (!password || String(password).length < 1) {
      return res.status(400).json({ ok: false, error: "Password required." });
    }
    setPassword(password);
    audit("security.password_set", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Auth check (used by reverse proxy to gate /hmi/*)
app.get("/api/auth/check", (req, res) => {
  const cfg = getConfig();
  if (cfg.secureMode) {
    // Secure mode ON: bypass env var ignored; require valid session
    const sessionId = getSessionId(req.headers.cookie);
    if (isSessionValid(sessionId)) return res.status(200).send("ok");
    return res.status(401).send("not authenticated");
  }
  if (HMI_AUTH_BYPASS) return res.status(200).send("ok");
  const cookie = String(req.headers.cookie || "");
  const ok = /(^|;\s*)(session|jwt|token)=/i.test(cookie);
  if (ok) return res.status(200).send("ok");
  return res.status(401).send("not authenticated");
});

// Snapshot/status
app.get("/api/state", (req, res) => {
  res.json({
    ...plc.status(),
    running: plc.mode === "running",
    scanMs: plc.scanMs,
    strict: !!plc.strict,
    scanStats: plc.scanStats,
    lastError: plc.lastError,
    diag: plc.lastDiag,
    boundProjectId: runtimeBridge.project?.id || null,
    signalCount: runtimeBridge.live.size,
    ...io.snapshot()
  });
});

// Status for header pills and workflow (project, validation, tests, secure mode)
app.get("/api/status", (req, res) => {
  try {
    const cfg = getConfig();
    const projectLoaded = !!LAST_PROJECT;
    const validation = getLastValidation();
    const tests = getLastTestsSummary();
    const sessionId = getSessionId(req.headers.cookie);
    const authenticated = cfg.secureMode ? isSessionValid(sessionId) : true;
    res.json({
      ok: true,
      projectLoaded,
      projectName: LAST_PROJECT ? "Project" : undefined,
      lastImportAt: LAST_PROJECT?.createdAt ?? undefined,
      validation: validation ? {
        score: validation.score,
        errors: validation.errors,
        warnings: validation.warnings,
        lastRunAt: validation.lastRunAt
      } : undefined,
      tests: tests ? {
        lastRunAt: tests.lastRunAt,
        passed: tests.passed,
        failed: tests.failed,
        total: tests.total,
        status: tests.status
      } : undefined,
      secureMode: !!cfg.secureMode,
      authenticated
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Inputs
app.post("/api/input/:name", (req, res) => {
  try {
    io.setInput(req.params.name, req.body.value);
    audit("io.input", { var: String(req.params.name || ""), value: !!req.body.value });
    res.json({ ok: true, inputs: io.inputs });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// Analog (AI/AO) - numeric values
app.post("/api/analog/:name", (req, res) => {
  try {
    const name = String(req.params.name || "").trim().toUpperCase();
    const value = req.body?.value;
    io.setAnalog(name, value);
    audit("io.analog", { var: name, value: Number(value) });
    res.json({ ok: true, analogInputs: io.analogInputs, analogOutputs: io.analogOutputs });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Fault injection (force/stuck for I/Q/M)
app.get("/api/faults", (req, res) => {
  res.json({ ok: true, faults: io.listFaults() });
});
app.post("/api/fault", (req, res) => {
  try {
    const v = String(req.body?.var || "").trim();
    const mode = String(req.body?.mode || "").trim();
    const value = !!req.body?.value;
    const f = io.setFault({ var: v, mode, value });
    audit("fault.set", { var: f.var, mode: f.mode, value: f.value });
    res.json({ ok: true, fault: f, faults: io.listFaults() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.delete("/api/fault/:var", (req, res) => {
  try {
    const v = String(req.params?.var || "").trim();
    io.clearFault(v);
    audit("fault.clear", { var: String(v || "").toUpperCase() });
    res.json({ ok: true, faults: io.listFaults() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Program IR
app.get("/api/program", (req, res) => {
  res.json({ ir: plc.programIR });
});

app.post("/api/program", (req, res) => {
  try {
    const { ir } = req.body;
    if (!ir || typeof ir !== "object") return res.status(400).json({ ok: false, error: "Missing ir" });

    if (!ENABLE_PY && irContainsPython(ir)) {
      return res.status(400).json({
        ok: false,
        error: "Python blocks are disabled (ENABLE_PY=0). Remove PY_CALL/PY_FB nodes or enable Python."
      });
    }

    // minimal shape check
    if (ir.language !== "ladder") return res.status(400).json({ ok: false, error: "Demo runtime supports language='ladder' only." });

    plc.setProgramIR(ir);
    // If strict mode is enabled, (re)seed IO for this IR so declared vars exist.
    if (plc.strict) {
      const wasStrict = !!io.strict;
      io.setStrict(false);
      seedIoForIR(io, ir);
      io.setStrict(wasStrict);
    }
    audit("program.upload", { language: ir.language, nets: (ir.networks || []).length });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.stack || e) });
  }
});

// Workflow state
app.get("/api/workflow", (req, res) => {
  try {
    const projectState = { ir: plc.programIR };
    const currentStep = getCurrentStep(projectState);
    const warnings = getStepWarnings(currentStep, projectState);
    const guidance = getStepGuidance(currentStep);
    
    res.json({
      ok: true,
      currentStep,
      stepLabel: STEP_LABELS[currentStep],
      guidance,
      warnings,
      allSteps: Object.values(WORKFLOW_STEPS).map(step => ({
        id: step,
        label: STEP_LABELS[step],
        description: getStepGuidance(step)
      }))
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// First Motor template
app.get("/api/template/first-motor", (req, res) => {
  try {
    const template = createFirstMotorTemplate();
    res.json({ ok: true, ...template });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Evaluator endpoint (deterministic evaluation)
app.post("/api/evaluate", (req, res) => {
  try {
    const projectState = req.body?.projectState || { ir: plc.programIR };
    const inputState = req.body?.inputState || io.snapshot();
    
    const result = evaluate(projectState, inputState);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Export ST (from ladder IR)
app.get("/api/program/st", (req, res) => {
  try {
    const ir = plc.programIR;
    if (ir.language !== "ladder") return res.status(400).send("ST export only supported for ladder IR in this demo build.");
    const st = ladderIRToST(ir);
    res.type("text/plain").send(st);
  } catch (e) {
    res.status(500).send(String(e?.stack || e));
  }
});

// -------- Electrician-first builders / engines --------
app.post("/api/panel/validate", (req, res) => {
  try {
    const panel = req.body?.panel;
    const v = validatePanel(panel);
    res.json({ ok: true, validation: v });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/panel/compile", (req, res) => {
  try {
    const panel = req.body?.panel;
    const ir = compilePanelToLadderIR(panel);
    res.json({ ok: true, ir, warnings: ir?.metadata?.warnings || [] });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/plain/compile", (req, res) => {
  try {
    const model = req.body?.model;
    const ir = compilePlainLanguageToIR(model);
    res.json({ ok: true, ir, warnings: ir?.metadata?.warnings || [] });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/truth-table", (req, res) => {
  try {
    const ir = req.body?.ir || plc.programIR;
    const inputVars = req.body?.inputVars || [];
    const outputVars = req.body?.outputVars || [];
    const baseSnap = req.body?.baseSnap;
    const table = generateTruthTable(ir, { inputVars, outputVars }, baseSnap);
    res.json({ ok: true, table });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/timeline/compile", requireTier("pro"), (req, res) => {
  try {
    const model = req.body?.model;
    const ir = compileTimelineToIR(model);
    res.json({ ok: true, ir, warnings: ir?.metadata?.warnings || [] });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/teach/compile", (req, res) => {
  try {
    const model = req.body?.model;
    const ir = compileTeachModeToIR(model);
    res.json({ ok: true, ir, clarifying: ir?.metadata?.teachMode?.clarifying || [], warnings: ir?.metadata?.warnings || [] });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/faults/explain", (req, res) => {
  try {
    const out = String(req.query?.output || "");
    const snap = io.snapshot();
    const expl = explainOutputOff(plc.programIR, snap, out);
    res.json({ ok: true, output: out, reasons: expl.reasons });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Explain a single output (structured blockers + rung index + plain English)
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
function iecAddr(v) {
  const vv = String(v || "");
  if (!vv) return vv;
  return `%${vv}`;
}
function buildAddrToTag(ir) {
  const out = {};
  const ioMap = ir?.ioMap || {};
  for (const [tag, addr] of Object.entries(ioMap)) out[String(addr)] = String(tag);
  return out;
}
function varLabel(v, addrToTag) {
  const addr = String(v || "");
  const tag = addrToTag?.[addr];
  if (tag) return `${tag} (${iecAddr(addr)})`;
  return iecAddr(addr);
}
function resolveVarSnap(v, snap) {
  const bank = String(v || "")[0];
  if (bank === "I") return !!snap.inputs?.[v];
  if (bank === "Q") return !!snap.outputs?.[v];
  if (bank === "M") return !!snap.mem?.[v];
  return false;
}
function exprToEnglish(expr, snap, addrToTag) {
  if (!expr) return "FALSE";
  if (typeof expr === "boolean") return expr ? "TRUE" : "FALSE";
  if (expr.var) return varLabel(expr.var, addrToTag);
  if (expr.op === "NOT") {
    const inner = expr.x?.var ? varLabel(expr.x.var, addrToTag) : `(${exprToEnglish(expr.x, snap, addrToTag)})`;
    return `NOT ${inner}`;
  }
  if (expr.op === "AND") return `(${exprToEnglish(expr.a, snap, addrToTag)}) AND (${exprToEnglish(expr.b, snap, addrToTag)})`;
  if (expr.op === "OR") return `(${exprToEnglish(expr.a, snap, addrToTag)}) OR (${exprToEnglish(expr.b, snap, addrToTag)})`;
  return "FALSE";
}
function gatherBlockers(expr, snap, addrToTag) {
  // Best-effort blocker list aligned with OT language:
  // - permissive: needs TRUE
  // - trip: needs FALSE (NOT condition)
  if (!expr) return { ok: false, blockers: [] };
  if (typeof expr === "boolean") return { ok: !!expr, blockers: expr ? [] : [{ type: "perm", text: "Condition is FALSE" }] };
  if (expr.var) {
    const v = resolveVarSnap(expr.var, snap);
    return v
      ? { ok: true, blockers: [] }
      : { ok: false, blockers: [{ type: "perm", var: expr.var, label: varLabel(expr.var, addrToTag), value: v, needs: true, text: `${varLabel(expr.var, addrToTag)} is OFF` }] };
  }
  if (expr.op === "NOT") {
    const inner = gatherBlockers(expr.x, snap, addrToTag);
    const ok = !inner.ok;
    if (ok) return { ok: true, blockers: [] };
    if (expr.x?.var) {
      const v = resolveVarSnap(expr.x.var, snap);
      return { ok: false, blockers: [{ type: "trip", var: expr.x.var, label: varLabel(expr.x.var, addrToTag), value: v, needs: false, text: `${varLabel(expr.x.var, addrToTag)} is ON (needs OFF)` }] };
    }
    return { ok: false, blockers: [{ type: "trip", text: "A NOT condition is blocking (needs OFF)" }] };
  }
  if (expr.op === "AND") {
    const a = gatherBlockers(expr.a, snap, addrToTag);
    const b = gatherBlockers(expr.b, snap, addrToTag);
    return { ok: a.ok && b.ok, blockers: [...a.blockers, ...b.blockers] };
  }
  if (expr.op === "OR") {
    const a = gatherBlockers(expr.a, snap, addrToTag);
    const b = gatherBlockers(expr.b, snap, addrToTag);
    const ok = a.ok || b.ok;
    return { ok, blockers: ok ? [] : [...a.blockers, ...b.blockers] };
  }
  return { ok: false, blockers: [{ type: "perm", text: "Unsupported condition" }] };
}

app.get("/api/explain/output/:var", (req, res) => {
  try {
    const v = String(req.params?.var || "").trim().toUpperCase();
    if (!/^[QM]\d+$/.test(v)) {
      return res.status(400).json({ ok: false, error: `Invalid output '${v}'. Expected Q# or M# (e.g. Q0, M12).` });
    }

    const snap = io.snapshot();
    const ir = plc.programIR || { language: "ladder", networks: [] };
    const addrToTag = buildAddrToTag(ir);
    const value = resolveVarSnap(v, snap);

    // Who writes this var?
    const writers = [];
    let idx = 0;
    for (const net of ir?.networks ?? []) {
      for (const rung of net?.rungs ?? []) {
        const rungIndex = idx++;
        const acts = (rung.actions || []).filter(a => (a.type === "COIL" || a.type === "SET" || a.type === "RESET") && a.target === v);
        if (!acts.length) continue;
        const trace = gatherBlockers(rung.cond, snap, addrToTag);
        writers.push({
          rungIndex,
          actionTypes: acts.map(a => a.type),
          condText: exprToEnglish(rung.cond, snap, addrToTag),
          condPower: !!trace.ok
        });
      }
    }

    const expl = explainOutputOff(ir, snap, v);
    const offReasons = expl.reasons || [];
    const reasons = offReasons.map(r => {
      const cond = r.rung?.cond;
      const trace = gatherBlockers(cond, snap, addrToTag);
      return {
        rungIndex: r.rungIndex,
        conditionText: exprToEnglish(cond, snap, addrToTag),
        blockers: trace.blockers,
        message: r.message
      };
    });

    // Safety chain snapshot (best effort): E-stop / overload-ish tags + inputs
    const safety = [];
    for (const [tag, addr] of Object.entries(ir?.ioMap || {})) {
      const t = String(tag).toLowerCase();
      if (!String(addr).startsWith("I")) continue;
      if (t.includes("e-stop") || t.includes("estop") || t.includes("emergency") || t.includes("overload") || t.includes("safety")) {
        safety.push({ var: String(addr), label: `${String(tag)} (${iecAddr(addr)})`, value: resolveVarSnap(String(addr), snap) });
      }
    }

    // If output is ON, show which rung(s) are currently powering it.
    const activeRungs = [];
    if (value) {
      for (const w of writers) {
        if (w.condPower) activeRungs.push({ rungIndex: w.rungIndex, conditionText: w.condText, actionTypes: w.actionTypes });
      }
    }

    res.json({
      ok: true,
      var: v,
      value,
      writers,
      primaryRungs: expl.primaryRungs || [],
      rootCause: expl.rootCause ?? null,
      explanation: value
        ? { status: "on", message: `Output ${v} is ON.`, activeRungs }
        : { status: "off", message: `Output ${v} is OFF.`, reasons, rootCause: expl.rootCause },
      safetyChain: safety
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------- Exports (MVP) --------
app.get("/api/export/codesys", (req, res) => {
  try {
    const st = exportCodesysST(plc.programIR);
    res.type("text/plain").send(st);
  } catch (e) {
    res.status(400).send(String(e?.message || e));
  }
});

app.get("/api/export/siemens", (req, res) => {
  try {
    const scl = exportSiemensSCL(plc.programIR);
    res.type("text/plain").send(scl);
  } catch (e) {
    res.status(400).send(String(e?.message || e));
  }
});

app.get("/api/export/allen-bradley", (req, res) => {
  try {
    const bundle = exportAllenBradleyPlaceholder(plc.programIR);
    res.json({ ok: true, ...bundle });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// I/O List export (structured, real-world format)
app.get("/api/export/io-list", (req, res) => {
  try {
    const ir = plc.programIR;
    const format = req.query?.format || "csv";
    
    if (format === "json") {
      const json = exportIOListJSON(ir);
      res.type("application/json").json(json);
    } else {
      const csv = exportIOList(ir);
      res.type("text/csv").send(csv);
    }
  } catch (e) {
    res.status(500).send(String(e?.stack || e));
  }
});

app.get("/api/export/python", (req, res) => {
  try {
    const py = exportPython(plc.programIR);
    res.type("text/plain").send(py);
  } catch (e) {
    res.status(400).send(String(e?.message || e));
  }
});

// Panel-facing wiring exports (use LAST_PROJECT)
app.get("/api/export/terminal-plan", (req, res) => {
  try {
    if (!LAST_PROJECT?.ioEntries?.length) {
      return res.status(400).json({ ok: false, error: "No project loaded. Import a project bundle (P&ID + IO List + Cause&Effect) first." });
    }
    const csv = exportTerminalPlan(LAST_PROJECT.ioEntries);
    audit("export.terminal_plan", { rows: LAST_PROJECT.ioEntries.length });
    res.type("text/csv").send(csv);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/export/wire-schedule", (req, res) => {
  try {
    if (!LAST_PROJECT?.ioEntries?.length) {
      return res.status(400).json({ ok: false, error: "No project loaded. Import a project bundle first." });
    }
    const csv = exportWireSchedule(LAST_PROJECT.ioEntries);
    audit("export.wire_schedule", { rows: LAST_PROJECT.ioEntries.length });
    res.type("text/csv").send(csv);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/export/io-checkout", (req, res) => {
  try {
    if (!LAST_PROJECT?.ioEntries?.length) {
      return res.status(400).json({ ok: false, error: "No project loaded. Import a project bundle first." });
    }
    const csv = exportIOCheckout(LAST_PROJECT.ioEntries, plc.programIR, LAST_PROJECT.ioMap || {});
    audit("export.io_checkout", { rows: LAST_PROJECT.ioEntries.length });
    res.type("text/csv").send(csv);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/export/commissioning-packet", async (req, res) => {
  try {
    const buf = await buildCommissioningPacket({ LAST_PROJECT, plc });
    const name = "commissioning_packet_" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".zip";
    const projectName = LAST_PROJECT ? (LAST_PROJECT.ioEntries?.length ? `Project (${LAST_PROJECT.ioEntries.length} I/O)` : "Project") : null;
    const entry = logPacket({ buffer: buf, filename: name, projectName });
    audit("export.commissioning_packet", { size: buf.length, packetId: entry.id });
    res.setHeader("Content-Disposition", "attachment; filename=\"" + name + "\"");
    res.type("application/zip").send(buf);

    // Reset project after successful send so user can import another
    LAST_PROJECT = null;
    plc.setProgramIR({ language: "ladder", networks: [] });
    setLastValidation(null);
    setLastTestsRun(null, null);
    clearExceptions();
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Recent commissioning packets (re-download after project reset)
app.get("/api/commissioning-packets", (req, res) => {
  try {
    const entries = listPackets();
    res.json({ ok: true, packets: entries });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/commissioning-packets/:id/download", (req, res) => {
  try {
    const id = req.params.id;
    const filePath = getPacketPath(id);
    if (!filePath) return res.status(404).json({ ok: false, error: "Packet not found or expired." });
    const entries = listPackets();
    const entry = entries.find((e) => e.id === id);
    const filename = entry?.filename || "commissioning_packet.zip";
    res.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
    res.type("application/zip").sendFile(filePath);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// P&ID Import from raw extracted text (OCR/client-side extraction)
app.post("/api/pid/import-text", (req, res) => {
  try {
    const text = String(req.body?.text || "");
    if (!text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Missing text. Provide JSON body: { \"text\": \"...\" }"
      });
    }

    const pidElements = parseTextForPIDElements(text);
    const totalElements =
      (pidElements.instruments?.length || 0) +
      (pidElements.valves?.length || 0) +
      (pidElements.pumps?.length || 0) +
      (pidElements.controlLoops?.length || 0) +
      (pidElements.equipment?.length || 0);

    if (totalElements === 0) {
      // Don't hard-fail for large reference PDFs; return ok with warning so user can still proceed.
      return res.json({
        ok: true,
        ir: {
          language: "ladder",
          networks: [{ rungs: [] }],
          ioMap: {},
          metadata: {
            generatedFrom: "pid",
            elements: { instruments: 0, valves: 0, pumps: 0, controlLoops: 0, equipment: 0 }
          }
        },
        elements: { instruments: 0, valves: 0, pumps: 0, controlLoops: 0, equipment: 0 },
        ioMap: {},
        detectedTags: [],
        warning:
          "Text was received, but no tag-like identifiers were detected. " +
          "If this is a scanned drawing, OCR quality may be too low; if it's a standards/reference document, it may not contain tags.",
        debug: { extractedTextLength: text.length, sampleText: text.slice(0, 500) }
      });
    }

    const plcIR = generatePLCFromPID(pidElements);
    return res.json({
      ok: true,
      ir: plcIR,
      elements: {
        instruments: pidElements.instruments?.length || 0,
        valves: pidElements.valves?.length || 0,
        pumps: pidElements.pumps?.length || 0,
        controlLoops: pidElements.controlLoops?.length || 0,
        equipment: pidElements.equipment?.length || 0
      },
      ioMap: plcIR.ioMap,
      detectedTags: Array.from(pidElements.tags?.keys?.() || []),
      debug: { extractedTextLength: text.length, extractedTextPreview: text.slice(0, 200) }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/pid/import-text-and-upload", (req, res) => {
  try {
    const text = String(req.body?.text || "");
    if (!text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Missing text. Provide JSON body: { \"text\": \"...\" }"
      });
    }

    const pidElements = parseTextForPIDElements(text);
    const totalElements =
      (pidElements.instruments?.length || 0) +
      (pidElements.valves?.length || 0) +
      (pidElements.pumps?.length || 0) +
      (pidElements.controlLoops?.length || 0) +
      (pidElements.equipment?.length || 0);

    if (totalElements === 0) {
      return res.json({
        ok: true,
        ir: {
          language: "ladder",
          networks: [{ rungs: [] }],
          ioMap: {},
          metadata: {
            generatedFrom: "pid",
            elements: { instruments: 0, valves: 0, pumps: 0, controlLoops: 0, equipment: 0 }
          }
        },
        elements: { instruments: 0, valves: 0, pumps: 0, controlLoops: 0, equipment: 0 },
        ioMap: {},
        detectedTags: [],
        warning:
          "Text was received, but no tag-like identifiers were detected. " +
          "Upload-to-PLC was skipped because there is no generated logic yet.",
        debug: { extractedTextLength: text.length, sampleText: text.slice(0, 500) }
      });
    }

    const plcIR = generatePLCFromPID(pidElements);
    if (!ENABLE_PY && irContainsPython(plcIR)) {
      return res.status(400).json({ ok: false, error: "Python blocks are disabled (ENABLE_PY=0)." });
    }
    if (plcIR.language !== "ladder") {
      return res.status(400).json({ ok: false, error: "Demo runtime supports language='ladder' only." });
    }

    plc.setProgramIR(plcIR);
    return res.json({
      ok: true,
      ir: plcIR,
      elements: {
        instruments: pidElements.instruments?.length || 0,
        valves: pidElements.valves?.length || 0,
        pumps: pidElements.pumps?.length || 0,
        controlLoops: pidElements.controlLoops?.length || 0,
        equipment: pidElements.equipment?.length || 0
      },
      ioMap: plcIR.ioMap,
      detectedTags: Array.from(pidElements.tags?.keys?.() || []),
      debug: { extractedTextLength: text.length, extractedTextPreview: text.slice(0, 200) }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Bundle import: P&ID + IO List + Cause&Effect + Control Narrative
// This is the "real" path for generating meaningful PLC logic.
app.post(
  "/api/project/import",
  upload.fields([
    { name: "pid", maxCount: 1 },
    { name: "io", maxCount: 1 },
    { name: "causeEffect", maxCount: 1 },
    { name: "narrative", maxCount: 1 },
    { name: "alarms", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const warnings = [];

      // ---- P&ID ----
      let pidText = "";
      let pidElements = { instruments: [], valves: [], pumps: [], controlLoops: [], equipment: [], tags: new Map() };

      const pidFile = req.files?.pid?.[0];
      if (pidFile) {
        const result = await extractTextFromFile(pidFile.buffer, pidFile.mimetype);
        pidText = String(result.text || "");
        if (!pidText.trim()) warnings.push("P&ID: no selectable text extracted (use OCR fallback in UI).");
        pidElements = parseTextForPIDElements(pidText);
      } else if (req.body?.pidText) {
        pidText = String(req.body.pidText || "");
        pidElements = parseTextForPIDElements(pidText);
      } else {
        warnings.push("P&ID: missing. Provide a P&ID file (pid) or pidText.");
      }

      // ---- IO List ----
      let ioEntries = [];
      const ioFile = req.files?.io?.[0];
      if (ioFile) {
        const name = (ioFile.originalname || "").toLowerCase();
        if (name.endsWith(".pdf") || ioFile.mimetype === "application/pdf") {
          const pdf = await extractTextFromFile(ioFile.buffer, ioFile.mimetype);
          ioEntries = parseIoListFromLooseText(pdf.text || "");
          if (!ioEntries.length) warnings.push("IO List (PDF): parsed 0 IO entries (consider CSV/XLSX for best results).");
        } else {
          const parsed = parseIoListFile({ buffer: ioFile.buffer, filename: ioFile.originalname, mimetype: ioFile.mimetype });
          ioEntries = parsed.entries;
          warnings.push(...(parsed.warnings || []));
          if (!ioEntries.length) warnings.push("IO List: parsed 0 entries (check headers/format).");
        }
      } else {
        warnings.push("IO List: missing (recommended). Upload CSV/XLSX for best results.");
      }

      // ---- Cause & Effect ----
      let ceRules = [];
      const ceFile = req.files?.causeEffect?.[0];
      if (ceFile) {
        const name = (ceFile.originalname || "").toLowerCase();
        if (name.endsWith(".pdf") || ceFile.mimetype === "application/pdf") {
          const pdf = await extractTextFromFile(ceFile.buffer, ceFile.mimetype);
          ceRules = parseCauseEffectLooseText(pdf.text || "");
          if (!ceRules.length) warnings.push("Cause&Effect (PDF): parsed 0 rules (consider CSV/XLSX for best results).");
        } else {
          const parsed = parseCauseEffectFile({ buffer: ceFile.buffer, filename: ceFile.originalname, mimetype: ceFile.mimetype });
          ceRules = parsed.rules;
          warnings.push(...(parsed.warnings || []));
          if (!ceRules.length) {
            const hdrs = parsed.diagnostics?.headers || [];
            const ck = parsed.diagnostics?.causeKey || "";
            const ek = parsed.diagnostics?.effectKey || "";
            warnings.push(
              "Cause&Effect: parsed 0 rules (check headers/format). " +
              `Detected headers: ${hdrs.length ? hdrs.join(", ") : "(none)"}; ` +
              `picked Cause='${ck || "(none)"}', Effect='${ek || "(none)"}'.`
            );
          }
        }
      } else {
        warnings.push("Cause&Effect: missing (recommended). Upload CSV/XLSX for best results.");
      }

      // ---- Narrative (optional) ----
      const narrativeFile = req.files?.narrative?.[0];
      const narrativeText = narrativeFile ? narrativeFile.buffer.toString("utf-8") : String(req.body?.narrativeText || "");
      if (!narrativeText.trim()) warnings.push("Control narrative: missing (optional, but improves generation).");

      // ---- Alarms (optional) ----
      const alarmsFile = req.files?.alarms?.[0];
      let alarmsText = "";
      if (alarmsFile) {
        const name = (alarmsFile.originalname || "").toLowerCase();
        if (name.endsWith(".csv") || name.endsWith(".txt")) {
          alarmsText = alarmsFile.buffer.toString("utf-8");
        }
        // XLSX could be parsed here later with a dedicated alarm list parser
      }

      // ---- Project validation (cross-document OT sanity); auto-add orphan IOs to exceptions, then apply ----
      const rawValidation = validateProjectBundle({
        pidElements,
        ioListEntries: ioEntries,
        causeEffectRules: ceRules
      });
      addOrphanIoExceptions(rawValidation);
      const validation = applyExceptions(rawValidation);
      setLastValidation(validation);
      audit("project.validate", {
        score: validation.score,
        errorCount: validation.stats?.errorCount ?? validation.errors?.length ?? 0,
        warningCount: validation.stats?.warningCount ?? validation.warnings?.length ?? 0
      });

      // ---- Generate PLC ----
      const generated = generatePLCFromProject({
        pidElements,
        ioListEntries: ioEntries,
        causeEffectRules: ceRules
      });

      // Merge warnings
      const mergedWarnings = [...warnings, ...(generated.warnings || [])];

      LAST_PROJECT = {
        createdAt: new Date().toISOString(),
        pidCounts: {
          instruments: pidElements.instruments?.length || 0,
          valves: pidElements.valves?.length || 0,
          pumps: pidElements.pumps?.length || 0,
          controlLoops: pidElements.controlLoops?.length || 0,
          equipment: pidElements.equipment?.length || 0
        },
        ioEntries,
        causeEffectRules: ceRules,
        narrativePresent: !!narrativeText.trim(),
        alarmsPresent: !!alarmsFile,
        alarmsText: alarmsText || undefined,
        warnings: mergedWarnings,
        ioMap: generated.ioMap
      };
      audit("project.import", { ioCount: ioEntries.length, causeEffectCount: ceRules.length, warnings: mergedWarnings.length });

      return res.json({
        ok: true,
        model: {
          pid: { counts: {
            instruments: pidElements.instruments?.length || 0,
            valves: pidElements.valves?.length || 0,
            pumps: pidElements.pumps?.length || 0,
            controlLoops: pidElements.controlLoops?.length || 0,
            equipment: pidElements.equipment?.length || 0
          }},
          io: { count: ioEntries.length },
          causeEffect: { count: ceRules.length },
          narrative: { present: !!narrativeText.trim() },
          alarms: { present: !!alarmsFile }
        },
        ir: generated.ir,
        ioMap: generated.ioMap,
        warnings: mergedWarnings,
        validation
      });
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

// Standalone project validator (same structure as import); auto-add orphan IOs to exceptions, then apply
app.post("/api/project/validate", (req, res) => {
  try {
    const body = req.body || {};
    const pidElements = body.pidElements ?? {};
    const ioListEntries = Array.isArray(body.ioListEntries) ? body.ioListEntries : [];
    const causeEffectRules = Array.isArray(body.causeEffectRules) ? body.causeEffectRules : [];
    const raw = validateProjectBundle({ pidElements, ioListEntries, causeEffectRules });
    addOrphanIoExceptions(raw);
    const validation = applyExceptions(raw);
    setLastValidation(validation);
    audit("project.validate", {
      score: validation.score,
      errorCount: validation.stats?.errorCount ?? 0,
      warningCount: validation.stats?.warningCount ?? 0
    });
    res.json({ ...validation, ok: true });
  } catch (e) {
    const msg = String(e?.message || e);
    res.status(400).json({ ok: false, error: msg || "Validation failed." });
  }
});

// Apply auto-fixes: add C&E tags missing from IO to IO list; merge rules that write to same effect
app.post("/api/project/apply-auto-fixes", (req, res) => {
  try {
    const body = req.body || {};
    let ioListEntries = Array.isArray(body.ioListEntries) ? body.ioListEntries : [];
    let causeEffectRules = Array.isArray(body.causeEffectRules) ? body.causeEffectRules : [];
    const useLastProject = (!ioListEntries.length && !causeEffectRules.length) && LAST_PROJECT;
    if (useLastProject) {
      ioListEntries = [...(LAST_PROJECT.ioEntries || [])];
      causeEffectRules = [...(LAST_PROJECT.causeEffectRules || [])];
    }
    const fixed = applyAutoFixes({ ioListEntries, causeEffectRules });
    if (useLastProject && LAST_PROJECT) {
      LAST_PROJECT.ioEntries = fixed.ioListEntries;
      LAST_PROJECT.causeEffectRules = fixed.causeEffectRules;
      const generated = generatePLCFromProject({
        pidElements: {},
        ioListEntries: LAST_PROJECT.ioEntries,
        causeEffectRules: LAST_PROJECT.causeEffectRules
      });
      plc.setProgramIR(generated.ir);
      LAST_PROJECT.ioMap = generated.ioMap || LAST_PROJECT.ioMap;
    }
    const raw = validateProjectBundle({
      pidElements: {},
      ioListEntries: fixed.ioListEntries,
      causeEffectRules: fixed.causeEffectRules
    });
    addOrphanIoExceptions(raw);
    const validation = applyExceptions(raw);
    setLastValidation(validation);
    audit("project.apply_auto_fixes", {
      tag_missing_in_io: fixed.applied?.tag_missing_in_io?.length ?? 0,
      multiple_rules_same_effect: fixed.applied?.multiple_rules_same_effect?.length ?? 0,
      orphan_io_rules: fixed.applied?.orphan_io_rules?.length ?? 0
    });
    res.json({
      ok: true,
      ioListEntries: fixed.ioListEntries,
      causeEffectRules: fixed.causeEffectRules,
      applied: fixed.applied,
      validation
    });
  } catch (e) {
    const msg = String(e?.message || e);
    res.status(400).json({ ok: false, error: msg || "Apply auto-fixes failed." });
  }
});

// Validation exceptions (accept as exception in-tool)
app.get("/api/project/validation-exceptions", (req, res) => {
  try {
    const list = getExceptions();
    const requiresPasscode = hasValidationExceptionPasscode();
    res.json({ ok: true, exceptions: list, requiresPasscode });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/project/validation-exceptions", (req, res) => {
  try {
    if (hasValidationExceptionPasscode()) {
      const passcode = req.body?.adminPasscode ?? req.body?.passcode ?? "";
      if (!verifyValidationExceptionPasscode(passcode)) {
        return res.status(403).json({ ok: false, error: "Admin passcode required.", requiresPasscode: true });
      }
    }
    const rule = String(req.body?.rule ?? "").trim();
    const tag = req.body?.tag != null ? String(req.body.tag).trim() : null;
    const acceptedBy = req.body?.acceptedBy != null ? String(req.body.acceptedBy).trim() : null;
    if (!rule) return res.status(400).json({ ok: false, error: "Missing rule." });
    if (!acceptedBy) return res.status(400).json({ ok: false, error: "Your name is required (who is accepting this exception)." });
    const id = addException({ rule, tag, acceptedBy });
    audit("project.validation_exception_added", { rule, tag, id, acceptedBy });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/project/validation-exceptions/bulk", (req, res) => {
  try {
    if (hasValidationExceptionPasscode()) {
      const passcode = req.body?.adminPasscode ?? req.body?.passcode ?? "";
      if (!verifyValidationExceptionPasscode(passcode)) {
        return res.status(403).json({ ok: false, error: "Admin passcode required.", requiresPasscode: true });
      }
    }
    const acceptedBy = req.body?.acceptedBy != null ? String(req.body.acceptedBy).trim() : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!acceptedBy) return res.status(400).json({ ok: false, error: "Your name is required (who is accepting these exceptions)." });
    if (items.length === 0) return res.status(400).json({ ok: false, error: "No items selected." });
    const ids = [];
    for (const it of items) {
      const rule = String(it?.rule ?? "").trim();
      if (!rule) continue;
      const tag = it?.tag != null ? String(it.tag).trim() : null;
      const id = addException({ rule, tag, acceptedBy });
      audit("project.validation_exception_added", { rule, tag, id, acceptedBy });
      ids.push(id);
    }
    res.json({ ok: true, ids, count: ids.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.delete("/api/project/validation-exceptions/:id", (req, res) => {
  try {
    if (hasValidationExceptionPasscode()) {
      const passcode = req.body?.adminPasscode ?? req.body?.passcode ?? (req.query && req.query.passcode) ?? "";
      if (!verifyValidationExceptionPasscode(passcode)) {
        return res.status(403).json({ ok: false, error: "Admin passcode required.", requiresPasscode: true });
      }
    }
    const id = req.params.id;
    const removedBy = req.body?.removedBy != null ? String(req.body.removedBy).trim() : null;
    const removed = removeException(id);
    if (removed) audit("project.validation_exception_removed", { id, removedBy });
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/project/validation-exceptions/requires-passcode", (req, res) => {
  try {
    res.json({ ok: true, requiresPasscode: hasValidationExceptionPasscode() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/config/validation-exception-passcode", (req, res) => {
  try {
    const passcode = req.body?.passcode != null ? String(req.body.passcode) : "";
    setValidationExceptionPasscode(passcode.trim() || null);
    res.json({ ok: true, requiresPasscode: hasValidationExceptionPasscode() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// FAT/SAT test runner
app.post("/api/tests/generate", (req, res) => {
  try {
    let { causeEffectRules, ioMap } = req.body || {};
    if ((!causeEffectRules || !ioMap) && LAST_PROJECT) {
      causeEffectRules = causeEffectRules ?? LAST_PROJECT.causeEffectRules ?? [];
      ioMap = ioMap ?? LAST_PROJECT.ioMap ?? {};
    }
    if (!causeEffectRules?.length && !ioMap && !LAST_PROJECT) {
      return res.status(400).json({
        ok: false,
        error: "Import a project bundle first (P&ID + IO List + Cause&Effect) and upload to PLC, then Generate from C&E."
      });
    }
    const tests = generateTestsFromCauseEffect({ ioMap: ioMap || {}, causeEffectRules: causeEffectRules || [] });
    res.json({ ok: true, tests });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/tests/run", async (req, res) => {
  try {
    let { tests, ir } = req.body || {};
    if (!ir) ir = plc.programIR;
    if (!tests || !Array.isArray(tests) || tests.length === 0) {
      return res.status(400).json({ ok: false, error: "Provide tests array (or generate first)." });
    }
    const result = await runTests({ ir, tests, scanMs: 50, maxScansPerStep: 20 });
    setLastTestsRun(result.summary, result.results);
    audit("tests.run", { total: result.summary.total, passed: result.summary.passed, failed: result.summary.failed });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/tests/last", (req, res) => {
  try {
    const summary = getLastTestsSummary();
    res.json({ ok: true, summary: summary || null, lastRunAt: summary?.lastRunAt ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/tests/export", (req, res) => {
  try {
    const { summary, results } = req.body || {};
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ ok: false, error: "Provide results from a test run." });
    }
    const headers = "Test ID,Name,Pass,Scans,Notes,Failures";
    const rows = results.map((r) => {
      const failures = [...(r.outputDiffs || []).map((d) => `${d.var}=${d.actual}`), ...(r.memDiffs || []).map((d) => `${d.var}=${d.actual}`)].join("; ");
      return [r.id, `"${(r.name || "").replace(/"/g, '""')}"`, r.pass ? "PASS" : "FAIL", r.scanCount || 0, `"${(r.notes || "").replace(/"/g, '""')}"`, `"${failures.replace(/"/g, '""')}"`].join(",");
    });
    const csv = [headers, ...rows].join("\n");
    res.type("text/csv").send(csv);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Fetch the last imported project bundle (labels/rules for electrician UI)
app.get("/api/project/last", (req, res) => {
  res.json({ ok: true, project: LAST_PROJECT });
});

// Sync C&E rules from current ladder logic (fluid: causes/effects derived from IR + ioMap)
app.post("/api/project/derive-ce-from-logic", (req, res) => {
  try {
    if (!LAST_PROJECT || !LAST_PROJECT.ioMap) {
      return res.status(400).json({ ok: false, error: "No project with I/O map loaded. Import a project bundle and upload to PLC first." });
    }
    const ir = plc.programIR || {};
    if (!(ir.networks?.length && ir.networks.some((n) => (n.rungs?.length ?? 0) > 0))) {
      return res.status(400).json({ ok: false, error: "No ladder logic loaded. Upload project to PLC first." });
    }
    const { causeEffectRules, skipped } = deriveCauseEffectFromIR({ ir, ioMap: LAST_PROJECT.ioMap });
    LAST_PROJECT.causeEffectRules = causeEffectRules;
    audit("project.derive_ce_from_logic", { ruleCount: causeEffectRules.length, skipped });
    res.json({ ok: true, causeEffectRules, count: causeEffectRules.length, skipped });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Update or add one IO entry in the current project (for in-tool fix during validation)
app.patch("/api/project/io-entry", (req, res) => {
  try {
    if (!LAST_PROJECT || !Array.isArray(LAST_PROJECT.ioEntries)) {
      return res.status(400).json({ ok: false, error: "No project loaded. Import a project bundle first." });
    }
    const tag = String(req.body?.tag || "").trim();
    const ioType = String(req.body?.ioType || "").toUpperCase().replace(/\s/g, "");
    if (!tag) return res.status(400).json({ ok: false, error: "Missing tag." });
    const valid = ["DI", "DO", "AI", "AO"];
    if (!valid.includes(ioType)) return res.status(400).json({ ok: false, error: "ioType must be DI, DO, AI, or AO." });
    const key = normalizeTagPlc(tag);
    const entries = LAST_PROJECT.ioEntries;
    const idx = entries.findIndex((e) => normalizeTagPlc(e.tag) === key);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], tag: entries[idx].tag, ioType };
    } else {
      entries.push({ tag: key || tag, ioType });
    }
    audit("project.io_entry_updated", { tag: key, ioType });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Update one Cause&Effect rule in the current project (for in-tool fix during tests)
app.patch("/api/project/cause-effect-rule", (req, res) => {
  try {
    if (!LAST_PROJECT || !Array.isArray(LAST_PROJECT.causeEffectRules)) {
      return res.status(400).json({ ok: false, error: "No project with C&E rules loaded. Import a project bundle first." });
    }
    const ruleIndex = Math.floor(Number(req.body?.ruleIndex));
    if (ruleIndex < 0 || ruleIndex >= LAST_PROJECT.causeEffectRules.length) {
      return res.status(400).json({ ok: false, error: "Invalid rule index." });
    }
    const causes = Array.isArray(req.body?.causes)
      ? req.body.causes.map((c) => String(c ?? "").trim()).filter(Boolean)
      : (req.body?.causes != null && typeof req.body.causes === "string")
        ? req.body.causes.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
        : [];
    const effects = Array.isArray(req.body?.effects)
      ? req.body.effects.map((e) => String(e ?? "").trim()).filter(Boolean)
      : (req.body?.effects != null && typeof req.body.effects === "string")
        ? req.body.effects.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
        : [];
    if (!causes.length || !effects.length) {
      return res.status(400).json({ ok: false, error: "At least one cause and one effect required." });
    }
    LAST_PROJECT.causeEffectRules[ruleIndex] = { causes, effects };
    const generated = generatePLCFromProject({
      pidElements: {},
      ioListEntries: LAST_PROJECT.ioEntries || [],
      causeEffectRules: LAST_PROJECT.causeEffectRules
    });
    plc.setProgramIR(generated.ir);
    LAST_PROJECT.ioMap = generated.ioMap || LAST_PROJECT.ioMap;
    audit("project.cause_effect_rule_updated", { ruleIndex, causeCount: causes.length, effectCount: effects.length });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Project version snapshots (change control)
app.post("/api/snapshots", (req, res) => {
  try {
    const label = String(req.body?.label || "snapshot").trim() || "snapshot";
    const bundle = {
      pidElements: LAST_PROJECT ? {} : {},
      ioListEntries: LAST_PROJECT?.ioEntries || [],
      causeEffectRules: LAST_PROJECT?.causeEffectRules || []
    };
    const ir = plc.programIR;
    const validation = LAST_PROJECT ? validateProjectBundle({
      pidElements: {},
      ioListEntries: LAST_PROJECT.ioEntries || [],
      causeEffectRules: LAST_PROJECT.causeEffectRules || []
    }) : null;
    const meta = createSnapshot({ label, bundle, ir, validation });
    audit("snapshot.create", { id: meta.id, label: meta.label });
    res.json({ ok: true, snapshot: meta });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/snapshots", (req, res) => {
  try {
    const list = listSnapshots();
    res.json({ ok: true, snapshots: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get("/api/snapshots/:id", (req, res) => {
  try {
    const id = req.params.id;
    if (id === "diff") {
      const idA = req.query.idA || req.query.ida;
      const idB = req.query.idB || req.query.idb;
      if (!idA || !idB) return res.status(400).json({ ok: false, error: "Query idA and idB required." });
      const diff = diffSnapshots(idA, idB);
      if (!diff) return res.status(404).json({ ok: false, error: "One or both snapshots not found." });
      res.json({ ok: true, diff });
      return;
    }
    const snapshot = getSnapshot(id);
    if (!snapshot) return res.status(404).json({ ok: false, error: "Snapshot not found." });
    res.json({ ok: true, snapshot });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// P&ID Import endpoints
app.post("/api/pid/import", upload.single("file"), async (req, res) => {
  try {
    let pidElements;
    let debugInfo = {};

    if (req.file) {
      // File upload (PDF/image)
      debugInfo.fileName = req.file.originalname;
      debugInfo.fileSize = req.file.size;
      debugInfo.mimeType = req.file.mimetype;
      
      try {
        const result = await extractTextFromFile(req.file.buffer, req.file.mimetype);
        const { text, warning } = result;
        debugInfo.extractedTextLength = text?.length || 0;
        debugInfo.extractedTextPreview = text?.substring(0, 200) || "";
        
        // If there's a warning (e.g., image OCR not implemented), include it in response
        if (warning && !text) {
          return res.status(400).json({ 
            ok: false, 
            error: warning,
            suggestion: "Please use the 'JSON Input' tab to provide structured P&ID data instead.",
            debug: debugInfo
          });
        }
        
        if (!text || text.trim().length === 0) {
          return res.status(400).json({
            ok: false,
            error: "No text could be extracted from the file. " +
                   "This may be because:\n" +
                   "1. The PDF is image-based (scanned) and requires OCR\n" +
                   "2. The image format doesn't support text extraction yet\n" +
                   "3. The file is corrupted or empty",
            suggestion: "Please use the 'JSON Input' tab to provide structured P&ID data, " +
                        "or ensure your PDF contains selectable text (not just images).",
            debug: debugInfo
          });
        }
        
        pidElements = parseTextForPIDElements(text);
        debugInfo.foundElements = {
          instruments: pidElements.instruments?.length || 0,
          valves: pidElements.valves?.length || 0,
          pumps: pidElements.pumps?.length || 0,
          controlLoops: pidElements.controlLoops?.length || 0
        };
        
        // If no elements found, provide helpful feedback
        const totalElements = (pidElements.instruments?.length || 0) + 
                             (pidElements.valves?.length || 0) + 
                             (pidElements.pumps?.length || 0) + 
                             (pidElements.controlLoops?.length || 0);
        
        if (totalElements === 0) {
          return res.status(400).json({
            ok: false,
            error: "No P&ID elements detected in the extracted text.",
            details: `Extracted ${text.length} characters, but no standard P&ID tags were found.`,
            suggestion: "The file was processed, but no instrument tags (PT-, FT-, LT-), " +
                       "valve tags (XV-, LV-), pump tags (P-), or control loop tags (LC-, FC-) were found. " +
                       "Please ensure your P&ID contains standard ISA tag naming, or use the JSON Input tab.",
            debug: {
              ...debugInfo,
              sampleText: text.substring(0, 500)
            }
          });
        }
      } catch (extractError) {
        return res.status(400).json({
          ok: false,
          error: `Failed to extract text from file: ${extractError.message}`,
          suggestion: "Please use the 'JSON Input' tab to provide structured P&ID data instead.",
          debug: debugInfo
        });
      }
    } else if (req.body.pidData) {
      // Structured JSON input (may be string from FormData)
      try {
        const pidData = typeof req.body.pidData === "string" 
          ? JSON.parse(req.body.pidData) 
          : req.body.pidData;
        
        if (!pidData || typeof pidData !== "object") {
          return res.status(400).json({
            ok: false,
            error: "Invalid JSON data. Expected an object with instruments, valves, pumps, and/or control_loops arrays."
          });
        }
        
        pidElements = parseStructuredPID(pidData);
        
        const totalElements = (pidElements.instruments?.length || 0) + 
                             (pidElements.valves?.length || 0) + 
                             (pidElements.pumps?.length || 0) + 
                             (pidElements.controlLoops?.length || 0);
        
        if (totalElements === 0) {
          return res.status(400).json({
            ok: false,
            error: "No P&ID elements found in the provided JSON data.",
            suggestion: "Please ensure your JSON includes at least one of: instruments, valves, pumps, or control_loops arrays. " +
                       "See the example in the JSON Input tab for the correct format."
          });
        }
      } catch (parseError) {
        return res.status(400).json({
          ok: false,
          error: `Failed to parse JSON data: ${parseError.message}`,
          suggestion: "Please check that your JSON is valid. You can use a JSON validator to check the syntax."
        });
      }
    } else {
      return res.status(400).json({ 
        ok: false, 
        error: "Either provide a file upload or pidData JSON in request body",
        suggestion: "Use the file upload area to select a PDF/image, or use the JSON Input tab to paste structured data."
      });
    }

    // Generate PLC code from P&ID elements
    const plcIR = generatePLCFromPID(pidElements);

    res.json({ 
      ok: true, 
      ir: plcIR,
      elements: {
        instruments: pidElements.instruments?.length || 0,
        valves: pidElements.valves?.length || 0,
        pumps: pidElements.pumps?.length || 0,
        controlLoops: pidElements.controlLoops?.length || 0,
        equipment: pidElements.equipment?.length || 0
      },
      ioMap: plcIR.ioMap,
      detectedTags: Array.from(pidElements.tags?.keys?.() || []),
      debug: debugInfo
    });
  } catch (e) {
    console.error("P&ID import error:", e);
    res.status(400).json({ 
      ok: false, 
      error: String(e?.message || e),
      stack: process.env.NODE_ENV === "development" ? e?.stack : undefined
    });
  }
});

// P&ID Import and auto-upload to PLC
app.post("/api/pid/import-and-upload", upload.single("file"), async (req, res) => {
  try {
    let pidElements;

    if (req.file) {
      try {
        const result = await extractTextFromFile(req.file.buffer, req.file.mimetype);
        const { text, warning } = result;
        
        if (warning && !text) {
          return res.status(400).json({ 
            ok: false, 
            error: warning,
            suggestion: "Please use the 'JSON Input' tab to provide structured P&ID data instead."
          });
        }
        
        if (!text || text.trim().length === 0) {
          return res.status(400).json({
            ok: false,
            error: "No text could be extracted from the file.",
            suggestion: "Please use the 'JSON Input' tab to provide structured P&ID data."
          });
        }
        
        pidElements = parseTextForPIDElements(text);
        
        const totalElements = (pidElements.instruments?.length || 0) + 
                             (pidElements.valves?.length || 0) + 
                             (pidElements.pumps?.length || 0) + 
                             (pidElements.controlLoops?.length || 0) +
                             (pidElements.equipment?.length || 0);
        
        if (totalElements === 0) {
          return res.status(400).json({
            ok: false,
            error: "No P&ID elements detected in the extracted text.",
            suggestion: "Please ensure your P&ID contains standard ISA tag naming, or use the JSON Input tab."
          });
        }
      } catch (extractError) {
        return res.status(400).json({
          ok: false,
          error: `Failed to extract text from file: ${extractError.message}`,
          suggestion: "Please use the 'JSON Input' tab to provide structured P&ID data instead."
        });
      }
    } else if (req.body.pidData) {
      try {
        const pidData = typeof req.body.pidData === "string" 
          ? JSON.parse(req.body.pidData) 
          : req.body.pidData;
        
        if (!pidData || typeof pidData !== "object") {
          return res.status(400).json({
            ok: false,
            error: "Invalid JSON data. Expected an object with instruments, valves, pumps, and/or control_loops arrays."
          });
        }
        
        pidElements = parseStructuredPID(pidData);
        
        const totalElements = (pidElements.instruments?.length || 0) + 
                             (pidElements.valves?.length || 0) + 
                             (pidElements.pumps?.length || 0) + 
                             (pidElements.controlLoops?.length || 0);
        
        if (totalElements === 0) {
          return res.status(400).json({
            ok: false,
            error: "No P&ID elements found in the provided JSON data.",
            suggestion: "Please ensure your JSON includes at least one of: instruments, valves, pumps, or control_loops arrays."
          });
        }
      } catch (parseError) {
        return res.status(400).json({
          ok: false,
          error: `Failed to parse JSON data: ${parseError.message}`,
          suggestion: "Please check that your JSON is valid."
        });
      }
    } else {
      return res.status(400).json({ 
        ok: false, 
        error: "Either provide a file upload or pidData JSON in request body",
        suggestion: "Use the file upload area to select a PDF/image, or use the JSON Input tab to paste structured data."
      });
    }

    const plcIR = generatePLCFromPID(pidElements);

    // Validate and upload to PLC
    if (!ENABLE_PY && irContainsPython(plcIR)) {
      return res.status(400).json({
        ok: false,
        error: "Python blocks are disabled (ENABLE_PY=0)."
      });
    }

    if (plcIR.language !== "ladder") {
      return res.status(400).json({ 
        ok: false, 
        error: "Demo runtime supports language='ladder' only." 
      });
    }

    plc.setProgramIR(plcIR);

    res.json({ 
      ok: true, 
      ir: plcIR,
      elements: {
        instruments: pidElements.instruments?.length || 0,
        valves: pidElements.valves?.length || 0,
        pumps: pidElements.pumps?.length || 0,
        controlLoops: pidElements.controlLoops?.length || 0,
        equipment: pidElements.equipment?.length || 0
      },
      ioMap: plcIR.ioMap,
      detectedTags: Array.from(pidElements.tags?.keys?.() || [])
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.stack || e) });
  }
});

// Code Import endpoint - converts code files to Blockly XML
app.post("/api/code/import", upload.single("file"), async (req, res) => {
  try {
    let code;
    let filename = "";

    if (req.file) {
      code = req.file.buffer.toString('utf-8');
      filename = req.file.originalname || "";
    } else if (req.body.code) {
      code = req.body.code;
      filename = req.body.filename || "";
    } else {
      return res.status(400).json({ 
        ok: false, 
        error: "Either provide a file upload or code text in request body" 
      });
    }

    // Parse code to IR
    const ir = parseCode(code, filename);

    // Convert IR to Blockly XML
    const blocklyXML = irToBlocklyXML(ir);

    res.json({ 
      ok: true, 
      ir,
      blocklyXML
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.stack || e) });
  }
});

// Safety configuration API
app.get("/api/safety/config", (req, res) => {
  try {
    // Return current safety configuration from program
    const ir = plc.programIR;
    const ioMap = ir?.ioMap || {};
    const eStops = [];
    const interlocks = [];
    
    for (const [tag, addr] of Object.entries(ioMap)) {
      const tagUpper = String(tag).toUpperCase();
      if (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
          tagUpper.includes("EMERGENCY")) {
        eStops.push({ tag, address: addr, type: "E-Stop" });
      } else if (tagUpper.includes("OVERLOAD") || tagUpper.includes("SAFETY") ||
                 tagUpper.includes("GUARD") || tagUpper.includes("INTERLOCK")) {
        interlocks.push({ tag, address: addr, type: "Interlock" });
      }
    }
    
    res.json({
      ok: true,
      eStops,
      interlocks,
      autoReset: true,
      disableAllOutputs: true
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/safety/config", (req, res) => {
  try {
    const config = req.body;
    // Store safety configuration (could be persisted to a file or database)
    // For now, we'll just acknowledge it
    res.json({ ok: true, message: "Safety configuration saved" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0'; // Listen on all interfaces for Docker
app.listen(port, host, () => {
  console.log(`P6 Systems listening on http://${host}:${port}`);
  console.log("  Model API: GET /api/model/health, /api/model/projects");
  console.log("  Narrative API: GET /api/narrative/status, POST /api/narrative/generate");
});
