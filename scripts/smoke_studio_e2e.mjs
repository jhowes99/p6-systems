/**
 * Studio / Runtime / Verify walkthrough — Master Spec §40 two-tank demo.
 * Usage: node scripts/smoke_studio_e2e.mjs [baseUrl]
 */
const base = process.argv[2] || "http://127.0.0.1:3000";

async function j(path, opts) {
  const r = await fetch(`${base}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`${path} → ${r.status} ${data.error || ""}`);
    err.data = data;
    throw err;
  }
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const steps = [];
function ok(name) { steps.push(`PASS ${name}`); console.log(`PASS ${name}`); }

try {
  try {
    await j("/api/features");
  } catch (e) {
    console.log("SKIP studio_e2e — p6-app not reachable at", base, `(${e.message})`);
    process.exit(0);
  }
  ok("features");

  // Ensure §40 demo is active
  await j("/api/model/projects/seed/tank-transfer-demo", { method: "POST" });
  await j("/api/runtime/bind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  const active = await j("/api/model/projects/active");
  assert(active.project?.id, "active project");
  const projectId = active.project.id;
  assert(/Tank Transfer/i.test(active.project.name || ""), "sample plant active");
  ok("active project " + active.project.name);

  await j("/api/runtime/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok("runtime start");

  const canvas = await j("/api/runtime/canvas");
  assert(canvas.nodes?.length >= 6, "canvas nodes");
  for (const t of ["TANK-101", "TANK-102", "PUMP-101", "VALVE-101", "LT-101"]) {
    assert(canvas.nodes.some((n) => n.tag === t), `missing ${t}`);
  }
  ok(`canvas nodes=${canvas.nodes.length}`);

  const tank = canvas.nodes.find((n) => n.tag === "TANK-101");
  assert(tank.properties?.capacityM3 != null || tank.w, "tank has size/properties");

  const nodes = Object.fromEntries(
    canvas.nodes.map((n, i) => [n.id, { x: 100 + (i % 3) * 200, y: 80 + Math.floor(i / 3) * 140, w: n.w || 140, h: n.h || 80 }])
  );
  // Resize TANK-101
  nodes[tank.id] = { ...nodes[tank.id], w: 200, h: 130 };
  const g = await j(`/api/model/projects/${projectId}/graph`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes })
  });
  assert(g.graph?.nodes?.[tank.id]?.w === 200, "tank resize persisted");
  ok("graph layout + tank resize persist");

  await j(`/api/model/projects/${projectId}/equipment/${tank.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { heightM: 4, diameterM: 2.5, initialLevelPct: 65, highAlarmPct: 92 } })
  });
  const active2 = await j("/api/model/projects/active");
  const t2 = active2.project.equipment.find((e) => e.tag === "TANK-101");
  assert(t2.properties?.capacityM3 > 0, "capacity recalculated");
  ok("tank capacity configure");

  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "ESD-101.Healthy", value: true })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "LT-101.High", value: false })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "VALVE-101.OpenCommand", value: true })
  });
  await new Promise((r) => setTimeout(r, 400));
  ok("VALVE-101 open");

  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "System.Start", value: true })
  });
  ok("System.Start accepted");

  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "LT-101.High", value: true })
  });
  let rejected = false;
  try {
    await j("/api/runtime/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "System.Start", value: true })
    });
  } catch (e) {
    rejected = e.data?.rejected === true || /REJECTED|HIGH/i.test(e.message);
  }
  assert(rejected, "start rejected on level high");
  ok("permissive reject");

  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "LT-101.High", value: false })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "ESD-101.Healthy", value: false })
  });
  ok("estop activate");

  const pump = canvas.nodes.find((n) => n.tag === "PUMP-101");
  const xray = await j(`/api/runtime/xray?equipmentId=${encodeURIComponent(pump.id)}`);
  assert(xray.inhibited === true, "xray inhibited under esd");
  assert(xray.primaryBlocker, "xray primary blocker");
  assert((xray.highlightEquipmentIds || []).length >= 2, "xray highlights path");
  ok("xray root-cause");

  // Connection create + delete
  const fitOrValve = canvas.nodes.find((n) => n.tag === "VALVE-101");
  const t101 = canvas.nodes.find((n) => n.tag === "TANK-101");
  const created = await j(`/api/model/projects/${projectId}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromEquipmentId: t101.id,
      toEquipmentId: fitOrValve.id,
      connectionType: "process",
      description: "e2e temp link"
    })
  });
  assert(created.connection?.id, "connection created");
  await j(`/api/model/projects/${projectId}/connections/${created.connection.id}`, { method: "DELETE" });
  ok("connection create/delete");

  const fat = await j("/api/verify/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert(fat.pass === true || fat.result?.pass === true, "FAT pass");
  ok("FAT P101_ESTOP_SHUTDOWN");

  // Allow history frames to accumulate
  await new Promise((r) => setTimeout(r, 500));
  const hist = await j("/api/runtime/history");
  assert(hist.count >= 1, "history frames recorded");
  const frame = await j(`/api/runtime/history?frame=${hist.count - 1}`);
  assert(frame.frame?.signals, "history frame has signals");
  ok(`history frames=${hist.count}`);

  const speed = await j("/api/runtime/speed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanMs: 50 })
  });
  assert(speed.scanMs === 50, "speed api");
  ok("runtime speed");

  // Lock + waypoints (canonical model)
  assert(fitOrValve && pump, "valve/pump for lock+waypoints");
  const lockPatch = await j(`/api/model/projects/${projectId}/graph`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodes: {
        [fitOrValve.id]: {
          x: fitOrValve.x,
          y: fitOrValve.y,
          w: fitOrValve.w || 140,
          h: fitOrValve.h || 80,
          locked: true
        }
      }
    })
  });
  assert(lockPatch.graph?.nodes?.[fitOrValve.id]?.locked === true, "lock persisted");
  const conns = await j(`/api/model/projects/${projectId}/connections`);
  const link = (conns.connections || []).find(
    (c) =>
      (c.fromEquipmentId === pump.id && c.toEquipmentId === fitOrValve.id) ||
      (c.fromEquipmentId === fitOrValve.id && c.toEquipmentId === pump.id)
  ) || (conns.connections || [])[0];
  assert(link?.id, "connection for waypoints");
  const wp = await j(`/api/model/projects/${projectId}/connections/${link.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waypoints: [{ x: 420, y: 220 }] })
  });
  assert(wp.connection?.waypoints?.length === 1, "waypoint persisted");
  ok("lock + waypoints");

  // Ingest → place on canvas → Runtime auto-rebind
  const ingestBody = {
    projectId,
    documentName: "e2e-pid.txt",
    format: "text/plain",
    placeOnCanvas: true,
    equipment: [
      { tag: "TANK-201", type: "tank" },
      { tag: "PUMP-201", type: "pump" }
    ]
  };
  const promoted = await j("/api/ingest/ocr/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-P6-Role": "engineer" },
    body: JSON.stringify(ingestBody)
  });
  assert(promoted.created?.equipment?.length >= 1, "ingest created equipment");
  assert(promoted.runtimeBound || promoted.project?.id, "runtime rebound after promote");
  const canvas2 = await j("/api/runtime/canvas");
  assert(canvas2.nodes.some((n) => n.tag === "TANK-201"), "ingested tank on canvas");
  const tank201 = canvas2.nodes.find((n) => n.tag === "TANK-201");
  assert(tank201.dataClass === "ENGINEERING_INFERENCE" || /INFERENCE/i.test(tank201.dataClass || ""), "unverified ingest");
  ok("ingest promote to canvas");

  // Delete equipment → runtime rebind
  const del = await j(`/api/model/projects/${projectId}/equipment/${tank201.id}`, { method: "DELETE" });
  assert(del.ok !== false, "equipment deleted");
  const canvas3 = await j("/api/runtime/canvas");
  assert(!canvas3.nodes.some((n) => n.tag === "TANK-201"), "deleted equipment gone from canvas");
  ok("delete equipment + rebind");

  // Platform limits surfaced via readiness (Studio sidebar consumes this)
  const ready = await j("/api/readiness");
  assert(Array.isArray(ready.knownLimits) && ready.knownLimits.length >= 4, "knownLimits present");
  const limitIds = new Set(ready.knownLimits.map((L) => L.id));
  for (const id of ["image_ocr", "ignition_live", "history_physics", "ab_export", "estop_sim"]) {
    assert(limitIds.has(id), `knownLimit ${id}`);
  }
  ok("platform knownLimits");

  const pages = ["/landing.html", "/studio.html", "/ingest.html", "/verify.html", "/connect.html"];
  for (const p of pages) {
    const r = await fetch(`${base}${p}`);
    assert(r.status === 200, p);
  }
  ok("studio pages 200");

  console.log(`\nStudio E2E: ${steps.length}/${steps.length} passed`);
} catch (e) {
  console.error("FAIL:", e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
}
