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

  /** Honest product limits — UI must surface these; do not claim complete. */
  const knownLimits = [
    {
      id: "image_ocr",
      severity: "high",
      summary: "Scanned image OCR unfinished",
      detail:
        "Text/PDF/CSV extract + promote works. Scanned P&ID images may return empty or low-confidence tags — engineer review required; do not treat OCR as verified."
    },
    {
      id: "ignition_live",
      severity: "high",
      summary: "Ignition / OPC live path unproven",
      detail:
        "Ignition is optional (Compose profile). Core Studio/Runtime runs without it. Do not claim live tag sync until proven with the ignition profile."
    },
    {
      id: "history_physics",
      severity: "medium",
      summary: "History playback is signal overlay",
      detail:
        "Timeline scrub overlays recorded tags onto the canvas. It does not rewind plant physics or re-simulate the process."
    },
    {
      id: "ab_export",
      severity: "medium",
      summary: "Allen-Bradley export is placeholder",
      detail: "AB download produces placeholder CSVs only — not a validated vendor import package."
    },
    {
      id: "estop_sim",
      severity: "medium",
      summary: "E-stop is model simulation only",
      detail:
        "Simulated E-stop demonstrates logic/interlock behavior in Runtime. It is not a certified physical safety function."
    },
    {
      id: "live_integration",
      severity: "low",
      summary: "Live plant integration gated off",
      detail: "P6_LIVE_INTEGRATION is off by default. External write-back requires explicit enable + engineer approval."
    }
  ];

  return {
    ok: failed.length === 0,
    readyForDemo: failed.length === 0,
    score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100),
    checks,
    failed: failed.map((f) => f.id),
    knownLimits,
    checklist: [
      "Core Docker profile starts without Ignition",
      "Water Transfer start / E-stop / reset works in Simulation",
      "FAT P101_ESTOP_SHUTDOWN passes",
      "OPC UA endpoint browses when ENABLE_OPCUA=1",
      "No production credentials committed",
      "Simulated E-stop labeled as model-only",
      "Known limits visible in Studio (ingest / Connect / timeline)"
    ],
    generatedAt: new Date().toISOString()
  };
}
