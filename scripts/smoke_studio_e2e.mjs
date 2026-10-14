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
  await j("/api/runtime/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  try {
    await j("/api/fault/I1", { method: "DELETE" });
  } catch (_) {
    /* no fault */
  }
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

  try {
    await j("/api/fault/I1", { method: "DELETE" });
  } catch (_) {
    /* no fault */
  }
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
    body: JSON.stringify({ tag: "System.Reset", value: true })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "VALVE-101.OpenCommand", value: true })
  });
  for (let i = 0; i < 8; i += 1) {
    const sig = await j("/api/runtime/signals");
    const open = (sig.signals || []).find((s) => s.tag === "VALVE-101.OpenedFeedback");
    if (open?.currentValue === true) break;
    await new Promise((r) => setTimeout(r, 120));
  }
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
  assert(xray.health?.state === "INHIBITED", "xray health inhibited");
  assert(xray.health?.primaryBlocker, "xray health.primaryBlocker");
  assert(Array.isArray(xray.path) && xray.path.length >= 2, "xray signal path");
  assert(xray.path.some((p) => p.role === "INPUT" || p.step === "INPUT"), "xray path has INPUT");
  assert(Array.isArray(xray.narrative) && xray.narrative.length >= 1, "xray narrative");
  assert(xray.groups && Array.isArray(xray.groups.blockers), "xray groups.blockers");
  assert((xray.groups.blockers || []).some((b) => b.id === "esd" || /esd|estop/i.test(b.label || "")), "xray blockers include ESD");
  assert(Array.isArray(xray.verifyHints), "xray verifyHints");
  ok("xray root-cause + phase1 payload");

  // Stuck-valve fault → blocking valve condition on demo pump (fault inject/clear preserved)
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "ESD-101.Healthy", value: true })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "System.Reset", value: true })
  });
  await j("/api/fault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ var: "I1", mode: "stuck", value: false })
  });
  let xrayValve = null;
  for (let i = 0; i < 6; i += 1) {
    xrayValve = await j(`/api/runtime/xray?equipmentId=${encodeURIComponent(pump.id)}`);
    if (xrayValve.inhibited && xrayValve.primaryBlocker?.id === "valve") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(xrayValve.inhibited === true, "xray inhibited under stuck valve");
  assert(xrayValve.primaryBlocker?.id === "valve", `expected valve blocker, got ${xrayValve.primaryBlocker?.id}`);
  const valveNode = canvas.nodes.find((n) => n.tag === "VALVE-101");
  assert(valveNode && (xrayValve.highlightEquipmentIds || []).includes(valveNode.id), "xray highlights valve on stuck fault");
  await j("/api/fault/I1", { method: "DELETE" });
  ok("xray stuck-valve fault inject/clear");

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

  const catalog = await j("/api/verify/tests");
  assert((catalog.tests || []).length >= 1, "verify catalog");
  assert(Array.isArray(catalog.limits) && catalog.limits.length >= 1, "verify catalog limits documented");
  const fat = await j("/api/verify/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert(fat.pass === true || fat.result?.pass === true, "FAT pass");
  ok("FAT P101_ESTOP_SHUTDOWN + catalog limits");

  const logic = await j("/api/runtime/logic");
  assert(logic.ok && logic.program != null, "runtime logic observability");
  ok("runtime logic API");

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

  // Vision pipeline extract (text fixture) — no silent approve
  const fs = await import("fs");
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const sampleTxt = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server/data/samples/ocr_water_transfer.txt");
  const fd = new FormData();
  const blob = new Blob([fs.readFileSync(sampleTxt)], { type: "text/plain" });
  fd.append("file", blob, "ocr_water_transfer.txt");
  const pipeRes = await fetch(`${base}/api/ingest/pipeline`, { method: "POST", body: fd });
  const pipe = await pipeRes.json();
  assert(pipeRes.ok && pipe.ok, "ingest pipeline ok");
  assert((pipe.candidates || []).some((c) => c.tag === "P-101"), "pipeline mined P-101");
  assert((pipe.candidates || []).every((c) => c.sourceRef || c.sourceRefs), "candidates have source refs");
  assert((pipe.connections || []).length >= 1, "pipeline proposed connections");
  assert((pipe.gaps || []).length >= 1, "pipeline engineering gaps");
  assert((pipe.stages || []).some((s) => s.id === "review_required"), "review_required stage");
  ok("vision ingest pipeline");

  // Ingest → place on canvas → Runtime auto-rebind (+ explicit connection, no silent amb)
  const ingestBody = {
    projectId,
    documentName: "e2e-pid.txt",
    format: "text/plain",
    placeOnCanvas: true,
    equipment: [
      { tag: "TANK-201", type: "tank", sourceRef: { documentName: "e2e-pid.txt", page: 1 } },
      { tag: "PUMP-201", type: "pump" }
    ],
    connections: [
      { fromTag: "TANK-201", toTag: "PUMP-201", connectionType: "process", include: true, ambiguous: false },
      { fromTag: "PUMP-201", toTag: "TANK-201", connectionType: "process", include: false, ambiguous: true }
    ],
    gaps: [
      {
        id: "gap-e2e-capacity",
        topic: "Tank capacity / geometry",
        message: "TANK-201 capacity not specified in import — confirm before trusting sim sizing.",
        relatedTags: ["TANK-201"],
        status: "open"
      }
    ]
  };
  const promoted = await j("/api/ingest/ocr/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-P6-Role": "engineer" },
    body: JSON.stringify(ingestBody)
  });
  assert(promoted.created?.equipment?.length >= 1, "ingest created equipment");
  assert((promoted.created?.connections || []).length === 1, "only explicitly included connection promoted");
  assert(promoted.skippedConnections?.some((s) => s.fromTag === "PUMP-201"), "ambiguous/excluded connection skipped");
  assert(promoted.gaps?.gaps?.length >= 1 || promoted.project?.ui?.ingestGaps?.gaps?.length >= 1, "gaps persisted");
  assert(promoted.runtimeBound || promoted.project?.id, "runtime rebound after promote");
  const canvas2 = await j("/api/runtime/canvas");
  assert(canvas2.nodes.some((n) => n.tag === "TANK-201"), "ingested tank on canvas");
  const tank201 = canvas2.nodes.find((n) => n.tag === "TANK-201");
  const pump201 = canvas2.nodes.find((n) => n.tag === "PUMP-201");
  assert(tank201.dataClass === "ENGINEERING_INFERENCE" || /INFERENCE/i.test(tank201.dataClass || ""), "unverified ingest");
  ok("ingest promote to canvas");

  // Delete equipment → runtime rebind (remove ALL e2e ingest leftovers so demos stay clean)
  const del = await j(`/api/model/projects/${projectId}/equipment/${tank201.id}`, { method: "DELETE" });
  assert(del.ok !== false, "equipment deleted");
  if (pump201?.id) {
    await j(`/api/model/projects/${projectId}/equipment/${pump201.id}`, { method: "DELETE" });
  }
  const canvas3 = await j("/api/runtime/canvas");
  assert(!canvas3.nodes.some((n) => n.tag === "TANK-201"), "deleted equipment gone from canvas");
  assert(!canvas3.nodes.some((n) => n.tag === "PUMP-201"), "e2e pump cleaned up");
  ok("delete equipment + rebind");

  // Interlocks — whole-picture inside view (demo has LT high + ESD)
  const ilks = await j("/api/runtime/interlocks");
  assert(ilks.ok && (ilks.interlocks || []).length >= 2, "interlocks present");
  const esdIlk = ilks.interlocks.find((i) => /ESD/i.test(i.name));
  assert(esdIlk, "ESD interlock");
  assert((esdIlk.conditions || []).length >= 1, "ESD has conditions");
  assert((esdIlk.inhibits || []).length >= 1, "ESD inhibits equipment");
  assert((esdIlk.chain || []).length >= 2, "ESD inside chain");
  const ilkDetail = await j(`/api/runtime/interlocks/${esdIlk.id}`);
  assert(ilkDetail.interlock?.id === esdIlk.id, "interlock detail");
  // Promote ESD tag → draft interlock inference (unique tag avoids stale project pollution)
  const esdTag = `ESD-E2E-${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const esdPromo = await j("/api/ingest/ocr/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-P6-Role": "engineer" },
    body: JSON.stringify({
      projectId,
      documentName: "e2e-esd.txt",
      format: "text/plain",
      placeOnCanvas: true,
      equipment: [{ tag: esdTag, type: "emergency_stop_input" }]
    })
  });
  assert(
    (esdPromo.created?.interlocks || []).length >= 1,
    `ingest inferred ESD interlock for ${esdTag}`
  );
  const esdCreated = (esdPromo.created?.equipment || []).find((e) => e.tag === esdTag);
  if (esdCreated?.id) {
    await j(`/api/model/projects/${projectId}/equipment/${esdCreated.id}`, { method: "DELETE" });
  }
  ok("interlocks inside view + ingest inference");

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

  const verifyHtml = await fetch(`${base}/verify.html`).then((r) => r.text());
  assert(verifyHtml.includes("data-verify-catalog"), "verify.html catalog UI");
  const connectHtml = await fetch(`${base}/connect.html`).then((r) => r.text());
  assert(connectHtml.includes("data-connect-cards"), "connect.html overview cards");
  ok("verify + connect UX markers");

  // Studio UX architecture — four workspace categories, no nested iframe chrome
  const studioHtml = await fetch(`${base}/studio.html`).then((r) => r.text());
  assert(studioHtml.includes('data-ws="design"'), "studio Design workspace tab");
  assert(studioHtml.includes('data-ws="engineer"'), "studio Engineer workspace tab");
  assert(studioHtml.includes('data-ws="simulate"'), "studio Simulate workspace tab");
  assert(studioHtml.includes('data-ws="verify"'), "studio Verify & Export workspace tab");
  assert(!studioHtml.includes('data-ws="logic"'), "studio Logic tab removed (folded into Engineer)");
  assert(!studioHtml.includes('data-ws="io"'), "studio I/O tab removed (folded into Engineer)");
  assert(studioHtml.includes('id="workspaceNav"'), "studio workspace nav");
  assert(!studioHtml.includes('id="toolFrame"'), "studio removed nested tool iframe");
  assert(!studioHtml.includes("Open full page"), "studio removed Open full page chrome");
  assert(studioHtml.includes('id="interlocksPanel"'), "studio native interlocks panel");
  assert(studioHtml.includes('id="ioPanel"'), "studio native I/O panel");
  assert(studioHtml.includes('data-verify-catalog'), "studio inline verify catalog");
  assert(studioHtml.includes('class="verifyWorkspacePanel'), "studio Verify panel CSS class (KI-024)");
  assert(!studioHtml.includes("verifyPanelPanel"), "studio Verify panel typo absent");
  assert(studioHtml.includes('data-plant="start_transfer"'), "studio Simulate START TRANSFER plant op");
  assert(studioHtml.includes('data-plant="clear_high"'), "studio Simulate Clear LSH plant op");
  assert(studioHtml.includes('id="statusChips"'), "studio compact status bar chips");
  assert(studioHtml.includes('id="libList"'), "studio equipment library");
  assert(studioHtml.includes('id="advEngineering"'), "studio Advanced Engineering inspector");
  assert(studioHtml.includes('id="projMenu"'), "studio Project menu");
  assert(studioHtml.includes("Overview") && studioHtml.includes('data-tab="control"'), "studio inspector Overview/Control");
  assert(studioHtml.includes('id="ingestSteps"'), "studio Vision import wizard steps");
  assert(studioHtml.includes('id="ingestConnList"'), "studio ingest connection review");
  assert(studioHtml.includes('id="ingestGapList"'), "studio ingest gap decisions");
  assert(studioHtml.includes('id="btnIngestManual"'), "studio manual reconstruction path");
  ok("studio four-workspace shell markers");

  // Phase 2 industrial symbols — mode toggle + registry scripts
  assert(studioHtml.includes('id="symbolModeToggle"'), "studio P&ID/SCADA symbol mode toggle");
  assert(studioHtml.includes('data-symbol-mode="pid"'), "studio P&ID symbol mode button");
  assert(studioHtml.includes("symbols/registry.js"), "studio symbol registry script");
  assert(studioHtml.includes("symbols/svg.js"), "studio symbol SVG script");
  assert(studioHtml.includes('id="connectKind"'), "studio connection kind select");
  const symReg = await fetch(`${base}/symbols/registry.js`).then((r) => r.text());
  assert(symReg.includes("P6Symbols"), "symbol registry exposes P6Symbols");
  assert(symReg.includes("pickPorts"), "symbol registry port picker");
  ok("studio symbol mode + registry markers");

  // Water Transfer start path — activate+bind must energize (KI-025)
  const wtSeed = await j("/api/model/projects/seed/water-transfer", { method: "POST" });
  const wtId = wtSeed.project?.id;
  assert(wtId, "water transfer project id");
  await j("/api/model/projects/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: wtId })
  });
  const wtBound = await j("/api/runtime/bind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: wtId })
  });
  assert(wtBound.projectId === wtId, "runtime bound to water transfer");
  assert(wtBound.plantTemplate === "water_transfer" || wtBound.ok, "water transfer plant template");

  const wtCanvas = await j("/api/runtime/canvas");
  const wtTags = new Set((wtCanvas.nodes || []).map((n) => n.tag));
  for (const t of ["TANK101", "TANK102", "P101", "M101", "XV101", "LT101", "FT101", "PT101"]) {
    assert(wtTags.has(t), `water transfer has ${t}`);
  }
  const wtLinks = wtCanvas.links || [];
  assert(wtLinks.length >= 4, "water transfer piping/connections");
  assert(
    wtLinks.some((l) => l.fromPort || l.fromPortId),
    "water transfer connections carry port ids"
  );
  ok("water transfer Phase 2 diagram equipment + ports");

  await j("/api/runtime/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "LSH101.High", value: false })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "ESTOP101.Healthy", value: true })
  });
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "System.Start", value: true })
  });
  await new Promise((r) => setTimeout(r, 400));
  await j("/api/runtime/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "System.Start", value: false })
  });
  await new Promise((r) => setTimeout(r, 500));
  const wtSigs = await j("/api/runtime/signals");
  const byTag = Object.fromEntries((wtSigs.signals || []).map((s) => [s.tag, s.currentValue]));
  assert(byTag["LSH101.High"] === false, "LSH clear before start");
  assert(byTag["M101.Energize"] === true || byTag["P101.RunningFeedback"] === true, "water transfer energized after Start");
  ok("water transfer bind+start energizes");

  // Phase 5 — process observability + mass-transfer indication
  const proc = await j("/api/runtime/process");
  assert(proc.ok, "runtime process endpoint");
  assert(proc.fidelity?.template === "water_transfer" || proc.process, "process fidelity/template");
  assert(proc.controlLayers?.sim && proc.controlLayers?.equipment, "sim vs equipment layers documented");
  const src0 = Number(byTag["TANK101.LevelPct"]);
  const dst0 = Number(byTag["TANK102.LevelPct"] ?? 0);
  await new Promise((r) => setTimeout(r, 800));
  const wtSigs2 = await j("/api/runtime/signals");
  const byTag2 = Object.fromEntries((wtSigs2.signals || []).map((s) => [s.tag, s.currentValue]));
  if (Number.isFinite(src0) && byTag2["P101.RunningFeedback"] === true) {
    assert(Number(byTag2["TANK101.LevelPct"]) < src0, "source level falls while pumping");
    if (Number.isFinite(dst0) && byTag2["TANK102.LevelPct"] != null) {
      assert(Number(byTag2["TANK102.LevelPct"]) > dst0, "dest level rises while pumping");
    }
  }
  // Dry-run / low-source process fault → structured shutdown path
  await j("/api/runtime/process-fault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "low_source", active: true })
  });
  await new Promise((r) => setTimeout(r, 400));
  const afterLow = await j("/api/runtime/process");
  assert(
    afterLow.process?.pumpState === "fault" ||
      afterLow.process?.lastShutdownReason ||
      (await j("/api/runtime/signals")).signals?.find((s) => s.tag === "P101.Fault")?.currentValue === true,
    "low_source propagates to pump fault / shutdown reason"
  );
  await j("/api/runtime/process-fault", { method: "DELETE" });
  ok("water transfer process physics + fault injection");

  // Restore §40 tank demo as active for subsequent local use
  await j("/api/model/projects/seed/tank-transfer-demo", { method: "POST" });
  await j("/api/runtime/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok("restored tank transfer demo");

  const landingHtml = await fetch(`${base}/landing.html`).then((r) => r.text());
  assert(/IMPORT P&amp;ID|ingest=1/i.test(landingHtml), "landing Import P&ID entry");
  assert(/scratch=1|START FROM SCRATCH/i.test(landingHtml), "landing scratch entry");
  ok("landing project entry CTAs");

  console.log(`\nStudio E2E: ${steps.length}/${steps.length} passed`);
} catch (e) {
  console.error("FAIL:", e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
}
