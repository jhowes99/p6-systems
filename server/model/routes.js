/**
 * REST API for the Canonical P6 Model (Phase 2).
 * Mount at /api/model
 */

import { Router } from "express";
import {
  createEquipment,
  createSignal,
  createConnection,
  validateSignalPatch,
  DataClass,
  bumpModelVersion
} from "./schema.js";
import {
  initStore,
  listProjects,
  loadProject,
  createProject,
  deleteProject,
  getActiveProject,
  setActiveProject,
  updateProject,
  saveProject,
  getMeta,
  getStorePaths
} from "./store.js";
import { ensureWaterTransferProject } from "./seed_water_transfer.js";
import { ensureTankTransferDemoProject } from "./seed_tank_transfer_demo.js";
import { getTargetSchemaVersion } from "./migrate.js";
import { promoteExtractions } from "./ingest_promote.js";

export function createModelRouter({ audit = () => {}, onModelChange = null } = {}) {
  const router = Router();

  initStore();

  function notifyModelChange(project, reason) {
    if (typeof onModelChange !== "function" || !project) return null;
    try {
      return onModelChange({ project, reason });
    } catch (e) {
      audit("model.runtime.rebind_error", { error: String(e?.message || e), reason });
      return { ok: false, error: String(e?.message || e) };
    }
  }

  router.get("/health", (_req, res) => {
    const meta = getMeta();
    res.json({
      ok: true,
      schemaVersion: getTargetSchemaVersion(),
      activeProjectId: meta.activeProjectId || null,
      paths: getStorePaths()
    });
  });

  router.get("/projects", (_req, res) => {
    try {
      res.json({ ok: true, projects: listProjects() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects", (req, res) => {
    try {
      const { name, description } = req.body || {};
      const project = createProject({ name, description });
      audit("model.project.create", { id: project.id, name: project.name });
      res.status(201).json({ ok: true, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/projects/active", (_req, res) => {
    try {
      const project = getActiveProject();
      res.json({ ok: true, project: project || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/active", (req, res) => {
    try {
      const { projectId } = req.body || {};
      if (!projectId) return res.status(400).json({ ok: false, error: "projectId required" });
      const project = setActiveProject(projectId);
      audit("model.project.activate", { id: projectId });
      res.json({ ok: true, project });
    } catch (e) {
      res.status(404).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/seed/water-transfer", (_req, res) => {
    try {
      const { project, created } = ensureWaterTransferProject();
      audit("model.seed.water_transfer", { id: project.id, created });
      res.status(created ? 201 : 200).json({ ok: true, created, project });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/projects/seed/tank-transfer-demo", (_req, res) => {
    try {
      const { project, created } = ensureTankTransferDemoProject();
      audit("model.seed.tank_transfer_demo", { id: project.id, created });
      res.status(created ? 201 : 200).json({ ok: true, created, project });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /** Phase 8 — explicit promote of extraction candidates into canonical model */
  router.post("/ingest/promote", (req, res) => {
    try {
      const result = promoteExtractions({ ...req.body, placeOnCanvas: req.body?.placeOnCanvas !== false });
      audit("model.ingest.promote", {
        projectId: result.project.id,
        equipment: result.created.equipment.length,
        signals: result.created.signals.length
      });
      const runtimeBound = notifyModelChange(result.project, "ingest.promote");
      res.status(201).json({ ok: true, ...result, runtimeBound });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.get("/projects/:id", (req, res) => {
    try {
      const project = loadProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      res.json({ ok: true, project });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch("/projects/:id", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        if (req.body?.name != null) p.name = String(req.body.name).trim();
        if (req.body?.description != null) p.description = String(req.body.description);
        if (req.body?.wizard != null && typeof req.body.wizard === "object") {
          if (!p.ui) p.ui = {};
          p.ui.wizard = {
            ...(p.ui.wizard || {}),
            ...req.body.wizard,
            updatedAt: new Date().toISOString()
          };
        }
        return p;
      });
      audit("model.project.update", { id: project.id });
      res.json({ ok: true, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/projects/:id", (req, res) => {
    try {
      const ok = deleteProject(req.params.id);
      if (!ok) return res.status(404).json({ ok: false, error: "Project not found" });
      audit("model.project.delete", { id: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Equipment ---
  router.get("/projects/:id/equipment", (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    res.json({ ok: true, equipment: project.equipment });
  });

  router.post("/projects/:id/equipment", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        const eq = createEquipment({
          projectId: p.id,
          tag: req.body?.tag,
          type: req.body?.type,
          description: req.body?.description || "",
          dataClass: req.body?.dataClass || DataClass.ENGINEERING_INFERENCE,
          states: req.body?.states || [],
          initialState: req.body?.initialState ?? null,
          sourceDocumentIds: req.body?.sourceDocumentIds || []
        });
        if (!eq.tag) throw new Error("tag required");
        if (!eq.type) throw new Error("type required");
        if (p.equipment.some((e) => e.tag === eq.tag)) {
          throw new Error(`Equipment tag already exists: ${eq.tag}`);
        }
        if (req.body?.properties && typeof req.body.properties === "object") {
          eq.properties = { ...eq.properties, ...req.body.properties };
          const h = Number(eq.properties.heightM);
          const d = Number(eq.properties.diameterM);
          if (Number.isFinite(h) && Number.isFinite(d) && h > 0 && d > 0) {
            const r = d / 2;
            eq.properties.capacityM3 = Number((Math.PI * r * r * h).toFixed(3));
          }
        }
        p.equipment.push(eq);
        return p;
      });
      const created = project.equipment[project.equipment.length - 1];
      audit("model.equipment.create", { projectId: project.id, tag: created.tag });
      const runtimeBound = notifyModelChange(project, "equipment.create");
      res.status(201).json({ ok: true, equipment: created, project, runtimeBound });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /** Graph layout persistence (Studio Phase 2/4) */
  router.get("/projects/:id/graph", (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    res.json({
      ok: true,
      graph: project.ui?.graph || { nodes: {}, updatedAt: null },
      modelVersion: project.modelVersion
    });
  });

  router.patch("/projects/:id/graph", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        if (!p.ui) p.ui = {};
        const prev = p.ui.graph?.nodes || {};
        const incoming = req.body?.nodes || {};
        const nodes = { ...prev };
        for (const [id, pos] of Object.entries(incoming)) {
          if (!pos || typeof pos !== "object") continue;
          const next = {
            x: Number(pos.x) || 0,
            y: Number(pos.y) || 0,
            ...(pos.w != null ? { w: Math.max(80, Number(pos.w) || 140) } : prev[id]?.w != null ? { w: prev[id].w } : {}),
            ...(pos.h != null ? { h: Math.max(50, Number(pos.h) || 80) } : prev[id]?.h != null ? { h: prev[id].h } : {}),
            ...(pos.r != null ? { r: ((Number(pos.r) % 360) + 360) % 360 } : prev[id]?.r != null ? { r: prev[id].r } : {})
          };
          if (pos.locked != null) next.locked = !!pos.locked;
          else if (prev[id]?.locked) next.locked = true;
          nodes[id] = next;
        }
        p.ui.graph = {
          nodes,
          updatedAt: new Date().toISOString()
        };
        return p;
      });
      audit("model.graph.save", {
        projectId: project.id,
        nodes: Object.keys(project.ui?.graph?.nodes || {}).length
      });
      res.json({
        ok: true,
        graph: project.ui.graph,
        modelVersion: project.modelVersion
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/projects/:id/equipment/:equipmentId", (req, res) => {
    try {
      let removed = null;
      const project = updateProject(req.params.id, (p) => {
        const idx = (p.equipment || []).findIndex((e) => e.id === req.params.equipmentId);
        if (idx < 0) throw new Error("Equipment not found");
        removed = p.equipment[idx];
        p.equipment.splice(idx, 1);
        p.connections = (p.connections || []).filter(
          (c) => c.fromEquipmentId !== removed.id && c.toEquipmentId !== removed.id
        );
        // Drop signals bound to this equipment (avoid orphan runtime bindings)
        p.signals = (p.signals || []).filter((s) => s.equipmentId !== removed.id);
        if (p.ui?.graph?.nodes?.[removed.id]) {
          delete p.ui.graph.nodes[removed.id];
          p.ui.graph.updatedAt = new Date().toISOString();
        }
        return p;
      });
      audit("model.equipment.delete", { projectId: project.id, tag: removed?.tag, id: removed?.id });
      const runtimeBound = notifyModelChange(project, "equipment.delete");
      res.json({ ok: true, removed, project, modelVersion: project.modelVersion, runtimeBound });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch("/projects/:id/equipment/:equipmentId", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        const eq = p.equipment.find((e) => e.id === req.params.equipmentId);
        if (!eq) throw new Error("Equipment not found");
        const allowed = ["description", "type", "dataClass", "states", "initialState", "operatingState", "sourceDocumentIds"];
        for (const key of allowed) {
          if (req.body?.[key] !== undefined) eq[key] = req.body[key];
        }
        if (req.body?.properties != null && typeof req.body.properties === "object") {
          eq.properties = { ...(eq.properties || {}), ...req.body.properties };
          // Recalc cylindrical capacity when height/diameter provided (m → m³)
          const h = Number(eq.properties.heightM);
          const d = Number(eq.properties.diameterM);
          if (Number.isFinite(h) && Number.isFinite(d) && h > 0 && d > 0) {
            const r = d / 2;
            eq.properties.capacityM3 = Number((Math.PI * r * r * h).toFixed(3));
          }
        }
        if (req.body?.tag != null) {
          const tag = String(req.body.tag).trim().toUpperCase();
          if (p.equipment.some((e) => e.tag === tag && e.id !== eq.id)) {
            throw new Error(`Equipment tag already exists: ${tag}`);
          }
          eq.tag = tag;
        }
        if (req.body?.dataClass && !Object.values(DataClass).includes(req.body.dataClass)) {
          throw new Error("Invalid dataClass");
        }
        eq.updatedAt = new Date().toISOString();
        return p;
      });
      const equipment = project.equipment.find((e) => e.id === req.params.equipmentId);
      const runtimeBound = notifyModelChange(project, "equipment.patch");
      res.json({ ok: true, equipment, project, runtimeBound });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Signals ---
  router.get("/projects/:id/signals", (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    res.json({ ok: true, signals: project.signals });
  });

  router.post("/projects/:id/signals", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        const sig = createSignal({
          projectId: p.id,
          tag: req.body?.tag,
          dataType: req.body?.dataType,
          units: req.body?.units,
          direction: req.body?.direction,
          initialValue: req.body?.initialValue,
          equipmentId: req.body?.equipmentId ?? null,
          instrumentId: req.body?.instrumentId ?? null,
          address: req.body?.address ?? null,
          dataClass: req.body?.dataClass || DataClass.ENGINEERING_INFERENCE,
          source: req.body?.source || "p6.model"
        });
        if (!sig.tag) throw new Error("tag required");
        validateSignalPatch(sig);
        if (p.signals.some((s) => s.tag === sig.tag)) {
          throw new Error(`Signal tag already exists: ${sig.tag}`);
        }
        p.signals.push(sig);
        return p;
      });
      const created = project.signals[project.signals.length - 1];
      audit("model.signal.create", { projectId: project.id, tag: created.tag });
      res.status(201).json({ ok: true, signal: created, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch("/projects/:id/signals/:signalId", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        const sig = p.signals.find((s) => s.id === req.params.signalId);
        if (!sig) throw new Error("Signal not found");
        validateSignalPatch(req.body || {});
        const allowed = [
          "tag", "dataType", "units", "direction", "initialValue", "currentValue",
          "quality", "source", "simulationOverride", "overrideValue",
          "equipmentId", "instrumentId", "address", "dataClass"
        ];
        for (const key of allowed) {
          if (req.body?.[key] !== undefined) sig[key] = req.body[key];
        }
        sig.timestamp = new Date().toISOString();
        sig.updatedAt = sig.timestamp;
        return p;
      });
      const signal = project.signals.find((s) => s.id === req.params.signalId);
      res.json({ ok: true, signal, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /**
   * Approve an entity (equipment or signal): promote dataClass to ENGINEER_APPROVED.
   * Never silent — explicit action only.
   */
  router.post("/projects/:id/approve", (req, res) => {
    try {
      const { entityType, entityId } = req.body || {};
      if (!entityType || !entityId) {
        return res.status(400).json({ ok: false, error: "entityType and entityId required" });
      }
      const collectionMap = {
        equipment: "equipment",
        signal: "signals",
        instrument: "instruments",
        interlock: "interlocks",
        testCase: "testCases"
      };
      const coll = collectionMap[entityType];
      if (!coll) return res.status(400).json({ ok: false, error: `Unsupported entityType: ${entityType}` });

      const project = updateProject(req.params.id, (p) => {
        const item = p[coll].find((x) => x.id === entityId);
        if (!item) throw new Error(`${entityType} not found`);
        item.dataClass = DataClass.ENGINEER_APPROVED;
        item.updatedAt = new Date().toISOString();
        return p;
      });
      audit("model.approve", { projectId: req.params.id, entityType, entityId });
      res.json({ ok: true, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // --- Connections (process / instrument / mechanical) ---
  router.get("/projects/:id/connections", (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    res.json({ ok: true, connections: project.connections || [] });
  });

  router.post("/projects/:id/connections", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        const fromEquipmentId = String(req.body?.fromEquipmentId || "").trim();
        const toEquipmentId = String(req.body?.toEquipmentId || "").trim();
        const connectionType = String(req.body?.connectionType || "process").trim();
        if (!fromEquipmentId || !toEquipmentId) throw new Error("fromEquipmentId and toEquipmentId required");
        if (fromEquipmentId === toEquipmentId) throw new Error("Cannot connect equipment to itself");
        if (!p.equipment.some((e) => e.id === fromEquipmentId)) throw new Error("from equipment not found");
        if (!p.equipment.some((e) => e.id === toEquipmentId)) throw new Error("to equipment not found");
        const allowed = ["process", "instrument", "mechanical", "signal", "electrical"];
        if (!allowed.includes(connectionType)) throw new Error(`Invalid connectionType: ${connectionType}`);
        const dup = (p.connections || []).some(
          (c) =>
            c.fromEquipmentId === fromEquipmentId &&
            c.toEquipmentId === toEquipmentId &&
            c.connectionType === connectionType
        );
        if (dup) throw new Error("Connection already exists");
        const conn = createConnection({
          projectId: p.id,
          fromEquipmentId,
          toEquipmentId,
          connectionType,
          description: req.body?.description || ""
        });
        p.connections.push(conn);
        return p;
      });
      const created = project.connections[project.connections.length - 1];
      audit("model.connection.create", {
        projectId: project.id,
        id: created.id,
        type: created.connectionType
      });
      const runtimeBound = notifyModelChange(project, "connection.create");
      res.status(201).json({ ok: true, connection: created, project, runtimeBound });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.patch("/projects/:id/connections/:connectionId", (req, res) => {
    try {
      const project = updateProject(req.params.id, (p) => {
        const conn = (p.connections || []).find((c) => c.id === req.params.connectionId);
        if (!conn) throw new Error("Connection not found");
        if (req.body?.connectionType != null) conn.connectionType = String(req.body.connectionType);
        if (req.body?.description != null) conn.description = String(req.body.description);
        if (Array.isArray(req.body?.waypoints)) {
          conn.waypoints = req.body.waypoints
            .map((w) => ({ x: Number(w.x), y: Number(w.y) }))
            .filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y))
            .slice(0, 24);
        }
        return p;
      });
      const connection = project.connections.find((c) => c.id === req.params.connectionId);
      audit("model.connection.patch", { projectId: project.id, connectionId: connection.id });
      res.json({ ok: true, connection, modelVersion: project.modelVersion });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/projects/:id/connections/:connectionId", (req, res) => {
    try {
      let removed = null;
      const project = updateProject(req.params.id, (p) => {
        const idx = (p.connections || []).findIndex((c) => c.id === req.params.connectionId);
        if (idx < 0) throw new Error("Connection not found");
        removed = p.connections[idx];
        p.connections.splice(idx, 1);
        return p;
      });
      audit("model.connection.delete", { projectId: project.id, id: req.params.connectionId });
      const runtimeBound = notifyModelChange(project, "connection.delete");
      res.json({ ok: true, removed, project, runtimeBound });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Aggregate snapshot for Studio / Runtime consumers
  router.get("/projects/:id/summary", (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    res.json({
      ok: true,
      summary: {
        id: project.id,
        name: project.name,
        modelVersion: project.modelVersion,
        schemaVersion: project.schemaVersion,
        counts: {
          documents: project.documents.length,
          equipment: project.equipment.length,
          instruments: project.instruments.length,
          signals: project.signals.length,
          connections: project.connections.length,
          interlocks: project.interlocks.length,
          controlLogic: project.controlLogic.length,
          testCases: project.testCases.length,
          testResults: project.testResults.length,
          integrationConnections: project.integrationConnections.length
        },
        equipmentTags: project.equipment.map((e) => e.tag),
        signalTags: project.signals.map((s) => s.tag),
        approval: {
          approvedEquipment: project.equipment.filter((e) => e.dataClass === DataClass.ENGINEER_APPROVED).length,
          approvedSignals: project.signals.filter((s) => s.dataClass === DataClass.ENGINEER_APPROVED).length
        }
      }
    });
  });

  // Import legacy LAST_PROJECT-shaped bundle into canonical model (bridge)
  router.post("/projects/:id/import-legacy-bundle", (req, res) => {
    try {
      const bundle = req.body || {};
      const project = updateProject(req.params.id, (p) => {
        p.legacy = p.legacy || { ladderIR: null, ioMap: {}, causeEffectRules: [], ioEntries: [] };
        if (bundle.ioMap) p.legacy.ioMap = bundle.ioMap;
        if (Array.isArray(bundle.causeEffectRules)) p.legacy.causeEffectRules = bundle.causeEffectRules;
        if (Array.isArray(bundle.ioEntries) || Array.isArray(bundle.ioListEntries)) {
          p.legacy.ioEntries = bundle.ioEntries || bundle.ioListEntries;
        }
        if (bundle.ir || bundle.ladderIR) p.legacy.ladderIR = bundle.ir || bundle.ladderIR;
        return p;
      });
      audit("model.import_legacy_bundle", { projectId: project.id });
      res.json({ ok: true, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Force save without mutator (rare)
  router.post("/projects/:id/save", (req, res) => {
    try {
      let project = loadProject(req.params.id);
      if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
      if (req.body?.project) {
        const incoming = req.body.project;
        if (incoming.id && incoming.id !== project.id) {
          return res.status(400).json({ ok: false, error: "project.id mismatch" });
        }
        project = { ...project, ...incoming, id: project.id };
      }
      project = saveProject(bumpModelVersion(project), { bumpVersion: false });
      res.json({ ok: true, project });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
