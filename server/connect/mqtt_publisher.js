/**
 * Phase 10 — MQTT telemetry (JSON payloads, NOT Sparkplug B).
 * Enable: ENABLE_MQTT=1, MQTT_URL=mqtt://host:1883
 */

let _client = null;
let _status = {
  enabled: false,
  connected: false,
  url: null,
  topicPrefix: "p6systems",
  sparkplug: false,
  note: "Ordinary MQTT JSON — not Sparkplug B",
  error: null,
  published: 0
};
let _timer = null;

export function getMqttStatus() {
  return { ..._status };
}

export async function startMqttPublisher({ bridge, intervalMs = 500 } = {}) {
  if (process.env.ENABLE_MQTT !== "1") {
    _status = {
      ..._status,
      enabled: false,
      connected: false,
      note: "Set ENABLE_MQTT=1 to publish telemetry (JSON, not Sparkplug B)"
    };
    return _status;
  }

  const url = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
  const topicPrefix = process.env.MQTT_TOPIC_PREFIX || "p6systems";

  try {
    const mqtt = await import("mqtt");
    _client = mqtt.default.connect(url, {
      clientId: `p6-runtime-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 3000,
      connectTimeout: 10000
    });

    _status.enabled = true;
    _status.url = url;
    _status.topicPrefix = topicPrefix;
    _status.sparkplug = false;

    _client.on("connect", () => {
      _status.connected = true;
      _status.error = null;
      console.log(`P6 MQTT connected ${url} prefix=${topicPrefix}`);
    });
    _client.on("reconnect", () => {
      _status.connected = false;
    });
    _client.on("error", (err) => {
      _status.error = String(err?.message || err);
      _status.connected = false;
    });
    _client.on("close", () => {
      _status.connected = false;
    });

    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => {
      if (!_client?.connected || !bridge) return;
      const project = bridge.project?.name || "unknown";
      const projSlug = String(project).replace(/\s+/g, "");
      for (const sig of bridge.listSignals()) {
        const topic = `${topicPrefix}/Projects/${projSlug}/signals/${sig.tag.replace(/\./g, "/")}`;
        const payload = {
          tag: sig.tag,
          value: sig.currentValue,
          quality: sig.quality,
          timestamp: sig.timestamp,
          dataType: sig.dataType,
          source: sig.source,
          simulationOverride: !!sig.simulationOverride,
          project: projSlug,
          protocol: "p6.mqtt.json.v1"
        };
        _client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false });
        _status.published += 1;
      }
    }, Math.max(200, Number(intervalMs) || 500));

    return getMqttStatus();
  } catch (e) {
    _status.enabled = true;
    _status.connected = false;
    _status.error = String(e?.message || e);
    console.error("MQTT start failed:", e?.message || e);
    return getMqttStatus();
  }
}

export async function stopMqttPublisher() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  if (_client) {
    try { _client.end(true); } catch (_) { /* ignore */ }
    _client = null;
  }
  _status.connected = false;
}
