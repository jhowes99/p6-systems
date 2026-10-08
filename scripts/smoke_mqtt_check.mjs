/**
 * MQTT status probe against a running P6 app.
 * Usage: node scripts/smoke_mqtt_check.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:3000
 */

const base = process.argv[2] || "http://127.0.0.1:3000";

async function main() {
  const r = await fetch(`${base}/api/connect/mqtt`);
  const j = await r.json();
  console.log(JSON.stringify(j, null, 2));
  if (!j.enabled) {
    console.error("FAIL: MQTT not enabled (set ENABLE_MQTT=1)");
    process.exit(1);
  }
  if (!j.connected) {
    console.error("FAIL: MQTT not connected — is Mosquitto up?", j.error || "");
    process.exit(1);
  }
  if (!(j.published > 0)) {
    console.warn("WARN: connected but published=0 (wait a scan cycle and retry)");
  }
  console.log("MQTT smoke PASS");
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
