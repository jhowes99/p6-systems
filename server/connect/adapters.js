/**
 * P6 Connect — extensible adapter registry (OPC UA / MQTT / Ignition).
 * Architecture only until each path is validated. No live deploy claim.
 */

import { getOpcUaStatus } from "./opcua_server.js";
import { getMqttStatus } from "./mqtt_publisher.js";
import { getEngineeringStatus, TARGET_IGNITION_VERSION } from "./ignition_udt.js";
import { buildVendorMappingExport } from "./vendor_mapping.js";

export const ADAPTER_KINDS = Object.freeze(["opcua", "mqtt", "ignition"]);

/**
 * Snapshot of adapter architecture + honesty for Studio / exports.
 */
export function getConnectArchitecture(projectId = null) {
  const opcua = getOpcUaStatus();
  const mqtt = getMqttStatus();
  let ignition = { status: "unknown" };
  try {
    ignition = getEngineeringStatus();
  } catch {
    ignition = { status: "unavailable", note: "Engineering UDT status unavailable" };
  }

  let vendor = null;
  if (projectId) {
    try {
      vendor = buildVendorMappingExport(projectId);
    } catch {
      vendor = null;
    }
  }

  return {
    ok: true,
    mode: "EXTENSIBLE_STUBS",
    liveDeployClaimed: false,
    honestyLabel:
      "OPC UA / MQTT / Ignition adapters are extensible. Ignition live path remains unproven until validated (KI-019). Never auto-write to physical PLCs.",
    adapters: [
      {
        kind: "opcua",
        name: "OPC UA",
        extensible: true,
        enabled: !!opcua.enabled,
        running: !!opcua.running,
        endpoint: opcua.endpoint || null,
        status: opcua.running ? "running" : opcua.enabled ? "enabled_not_running" : "disabled",
        liveProven: !!opcua.running,
        note: opcua.note || "Set ENABLE_OPCUA=1 to start (requires node-opcua)."
      },
      {
        kind: "mqtt",
        name: "MQTT",
        extensible: true,
        enabled: !!mqtt.enabled,
        connected: !!mqtt.connected,
        url: mqtt.url || null,
        sparkplug: false,
        status: mqtt.connected ? "connected" : mqtt.enabled ? "enabled_not_connected" : "disabled",
        liveProven: !!mqtt.connected,
        note: mqtt.note || "JSON telemetry only — not Sparkplug B. ENABLE_MQTT=1."
      },
      {
        kind: "ignition",
        name: "Ignition",
        extensible: true,
        targetVersion: TARGET_IGNITION_VERSION,
        status: "proposal_only",
        liveProven: false,
        engineering: ignition,
        note:
          ignition?.note ||
          "UDT / export proposals require engineer approval. Live Gateway deploy not claimed until EULA + proven tag flow."
      }
    ],
    vendorMappingMode: vendor?.mode || "PROPOSAL_ONLY",
    projectId: projectId || null,
    neverAutoWritePhysicalPlc: true
  };
}
