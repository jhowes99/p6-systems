/**
 * Phase 11 — P6 → Ignition tag mapping (read-only default).
 * Stored under server/data/canonical/tag_maps/<projectId>.json
 */

import fs from "fs";
import path from "path";

function mapsDir() {
  const cwd = process.cwd();
  if (path.basename(cwd) === "server") return path.join(cwd, "data", "canonical", "tag_maps");
  return path.join(cwd, "server", "data", "canonical", "tag_maps");
}

function mapPath(projectId) {
  return path.join(mapsDir(), `${projectId}.json`);
}

function ensure() {
  const d = mapsDir();
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export function loadTagMap(projectId) {
  ensure();
  const p = mapPath(projectId);
  if (!fs.existsSync(p)) {
    return {
      projectId,
      direction: "P6_TO_IGNITION",
      mode: "READ_ONLY",
      mappings: [],
      updatedAt: null
    };
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveTagMap(projectId, body = {}) {
  ensure();
  const current = loadTagMap(projectId);
  const next = {
    projectId,
    direction: body.direction || current.direction || "P6_TO_IGNITION",
    mode: body.mode || current.mode || "READ_ONLY",
    mappings: Array.isArray(body.mappings) ? body.mappings.map(normalizeMapping) : current.mappings,
    updatedAt: new Date().toISOString()
  };
  if (next.mode === "BIDIRECTIONAL" && process.env.ALLOW_BIDIRECTIONAL_TAGS !== "1") {
    throw new Error("Bidirectional tag mapping requires ALLOW_BIDIRECTIONAL_TAGS=1 and safety review");
  }
  fs.writeFileSync(mapPath(projectId), JSON.stringify(next, null, 2));
  return next;
}

function normalizeMapping(m) {
  return {
    id: m.id || `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    p6Signal: String(m.p6Signal || "").trim(),
    dataType: m.dataType || "BOOL",
    ignitionTagPath: String(m.ignitionTagPath || "").trim(),
    direction: m.direction || "P6_TO_IGNITION",
    connectionStatus: m.connectionStatus || "proposed",
    quality: m.quality || "UNKNOWN",
    lastUpdate: m.lastUpdate || null,
    verified: !!m.verified
  };
}

export function proposeMapsFromSignals(projectId, signals = []) {
  const mappings = signals.map((s) => ({
    p6Signal: s.tag,
    dataType: s.dataType,
    ignitionTagPath: `[P6]WaterTransfer/${String(s.tag).replace(/\./g, "/")}`,
    direction: "P6_TO_IGNITION",
    connectionStatus: "proposed",
    verified: false
  }));
  return saveTagMap(projectId, { mappings, mode: "READ_ONLY", direction: "P6_TO_IGNITION" });
}

export function generateUdtProposal(equipment = []) {
  // Legacy summary endpoint — full package is Milestone A ignition_udt.js
  const byType = {};
  for (const eq of equipment) {
    const t = eq.type || "equipment";
    if (!byType[t]) {
      byType[t] = {
        udtName: t.charAt(0).toUpperCase() + t.slice(1),
        members: [],
        instances: []
      };
    }
    byType[t].instances.push(eq.tag);
  }
  if (byType.motor) {
    byType.motor.udtName = "P6_Motor";
    byType.motor.members = [
      "RunCommand", "Energize", "RunningFeedback", "FaultFeedback", "Available", "Interlocked", "OperatingState"
    ];
  }
  if (byType.pump) {
    byType.pump.udtName = "P6_Pump";
    byType.pump.members = [
      "RunCommand", "RunningFeedback", "FaultFeedback", "Available", "Interlocked", "OperatingState", "RuntimeStatus"
    ];
  }
  if (byType.valve) {
    byType.valve.udtName = "P6_Valve";
    byType.valve.members = ["OpenCommand", "OpenedFeedback", "ClosedFeedback", "FaultFeedback"];
  }
  return {
    reviewRequired: true,
    note: "Summary only — use POST /api/connect/engineering/udt/generate for exportable Ignition 8.3 package",
    engineeringUi: "/engineering.html",
    udts: Object.values(byType)
  };
}
