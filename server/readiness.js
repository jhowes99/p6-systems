/**
 * Phase 20 — platform readiness aggregate.
 */

import { getOpcUaStatus } from "./connect/opcua_server.js";
import { getMqttStatus } from "./connect/mqtt_publisher.js";
import { listProjects, getActiveProject } from "./model/store.js";
import { listEquipmentTypes } from "./plc/equipment/library.js";
import { SCHEMA_VERSION } from "./model/schema.js";

export function buildReadiness({ plc, bridge } = {}) {
  const checks = [];

  const push = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });

  push("schema_v1", SCHEMA_VERSION >= 1, `schemaVersion=${SCHEMA_VERSION}`);
  push("projects", listProjects().length > 0, `count=${listProjects().length}`);
  const active = getActiveProject();
  push("active_project", !!active, active?.name || "none");
  push("runtime_bound", !!bridge?.project, bridge?.project?.id || "unbound");
  push("runtime_mode", !!plc, plc?.mode || "n/a");
  push("water_transfer_ir", plc?.programIR?.metadata?.template === "water_transfer", plc?.programIR?.metadata?.template || "none");
  push("opcua", getOpcUaStatus().running || process.env.ENABLE_OPCUA !== "1", JSON.stringify(getOpcUaStatus()));
  push("mqtt_optional", true, JSON.stringify(getMqttStatus()));
  push("equipment_library", listEquipmentTypes().length >= 10, `types=${listEquipmentTypes().length}`);
  push("live_integration_disabled", process.env.P6_LIVE_INTEGRATION !== "1", "LIVE_INTEGRATION off by default");

  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    readyForDemo: failed.length === 0,
    score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100),
    checks,
    failed: failed.map((f) => f.id),
    checklist: [
      "Core Docker profile starts without Ignition",
      "Water Transfer start / E-stop / reset works in Simulation",
      "FAT P101_ESTOP_SHUTDOWN passes",
      "OPC UA endpoint browses when ENABLE_OPCUA=1",
      "No production credentials committed",
      "Simulated E-stop labeled as model-only"
    ],
    generatedAt: new Date().toISOString()
  };
}
