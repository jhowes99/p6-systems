/**
 * P6 Studio — unified interactive workspace.
 * Incremental canvas sync (no full DOM rebuild on poll). Runtime is SoR; visuals interpolate.
 */
(function () {
  const studio = document.getElementById("studio");
  const viewport = document.getElementById("viewport");
  const world = document.getElementById("world");
  const stage = document.getElementById("stage");
  const linksSvg = document.getElementById("links");
  const consoleLog = document.getElementById("consoleLog");
  const connectPanel = document.getElementById("connectPanel");

  let selected = null;
  const selectedIds = new Set();
  let lastCanvas = null;
  let projectId = null;
  let inspTab = "overview";
  let lastEventIds = new Set();
  let layoutDirty = false;
  let scale = 1;
  let panX = 40;
  let panY = 40;
  let view = "map";
  let drag = null;
  let resize = null;
  let panDrag = null;
  let marquee = null;
  let connectMode = false;
  let connectFrom = null;
  let xrayMode = false;
  let xrayData = null;
  let selectedLinkId = null;
  let workspaceMode = "simulation"; // engineering | simulation | diagnostic
  let rafId = 0;
  let pollInFlight = false;
  let lastPollAt = 0;
  let destroyed = false;
  let snapEnabled = true;
  let guidesEnabled = true;
  let playbackMode = false;
  let historyMeta = { count: 0 };
  let activeWorkflow = null;
  let waypointDrag = null;
  const layerVis = { process: true, signal: true, equipment: true, instruments: true };
  const wpEls = new Map(); // linkId -> [circle els]
  const SNAP = 10;
  const GUIDE_THRESH = 8;
  const undoStack = [];
  const redoStack = [];
  const UNDO_MAX = 40;
  const toolPanel = document.getElementById("toolPanel");
  const toolFrame = document.getElementById("toolFrame");

  /** Stable scene-graph: id -> element (never cleared on routine live updates) */
  const nodeEls = new Map();
  const linkEls = new Map();
  /** Display tank levels (interpolated toward authoritative live values) */
  const displayLevels = new Map();
  let motionEnabled = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const guidesSvg = document.getElementById("guides");
  const marqueeEl = document.getElementById("marquee");
  const ctxMenu = document.getElementById("ctxMenu");
  const minimapCanvas = document.getElementById("minimapCanvas");

  const LIB_TYPES = [
    { type: "tank", label: "Storage tank" },
    { type: "pump", label: "Centrifugal pump" },
    { type: "motor", label: "Electric motor" },
    { type: "valve", label: "Isolation valve" },
    { type: "level_transmitter", label: "Level transmitter" },
    { type: "pressure_transmitter", label: "Pressure transmitter" },
    { type: "flow_transmitter", label: "Flow transmitter" },
    { type: "emergency_stop_input", label: "E-stop (sim)" }
  ];

  /** Cached from /api/readiness — also posted into Alarms for a second reminder. */
  let platformLimitsCache = [];

  function updateAlarmsTabBadge() {
    const btn = document.querySelector('[data-actab="alarms"]');
    const alarmLog = document.getElementById("alarmLog");
    if (!btn || !alarmLog) return;
    const n = alarmLog.querySelectorAll(".ev").length;
    const limits = alarmLog.querySelectorAll(".ev.limit").length;
    btn.textContent = n ? `Alarms (${n}${limits ? ` · ${limits} limit` : ""})` : "Alarms";
  }

  /**
   * Post unfinished-capability items into Alarms (sticky).
   * Sidebar lists them; Alarms double-taps the need so demos never claim done.
   */
  function logPlatformAlarm(L) {
    const alarmLog = document.getElementById("alarmLog");
    if (!alarmLog || !L) return;
    const id = String(L.id || L.summary || "").trim();
    if (!id) return;
    if (alarmLog.querySelector(`[data-limit-id="${id.replace(/"/g, "")}"]`)) return;
    const row = document.createElement("div");
    const sev = L.severity || "medium";
    row.className = `ev alarm limit sev-${sev}`;
    row.dataset.limitId = id;
    row.dataset.stickyLimit = "1";
    const ts = new Date().toISOString().slice(11, 23);
    row.innerHTML =
      `<span class="ts">${esc(ts)}</span> ` +
      `<span class="limitTag">LIMIT</span> ` +
      `<strong>${esc(L.summary)}</strong> — ${esc(L.detail || "Unfinished capability")}`;
    alarmLog.prepend(row);
    while (alarmLog.children.length > 120) {
      const drop =
        [...alarmLog.children].reverse().find((c) => c.dataset.stickyLimit !== "1") ||
        alarmLog.lastChild;
      if (!drop) break;
      drop.remove();
    }
    updateAlarmsTabBadge();
  }

  function seedLimitAlarms(limits) {
    if (Array.isArray(limits)) platformLimitsCache = limits;
    for (const L of platformLimitsCache) logPlatformAlarm(L);
    updateAlarmsTabBadge();
  }

  /** Transient alarm (process or one-shot unfinished path) — not sticky. */
  function pushAlarm(msg, { limit = false, severity = "medium", id = "" } = {}) {
    const alarmLog = document.getElementById("alarmLog");
    if (!alarmLog) return;
    if (limit && id) {
      logPlatformAlarm({ id, summary: msg, detail: "", severity });
      return;
    }
    const row = document.createElement("div");
    row.className = "ev alarm" + (limit ? ` limit sev-${severity}` : "");
    const ts = new Date().toISOString().slice(11, 23);
    row.innerHTML =
      `<span class="ts">${esc(ts)}</span> ` +
      (limit ? `<span class="limitTag">LIMIT</span> ` : "") +
      esc(msg);
    alarmLog.prepend(row);
    while (alarmLog.children.length > 120) {
      const drop =
        [...alarmLog.children].reverse().find((c) => c.dataset.stickyLimit !== "1") ||
        alarmLog.lastChild;
      if (!drop) break;
      drop.remove();
    }
    updateAlarmsTabBadge();
  }

  async function loadPlatformLimits() {
    const host = document.getElementById("limitsList");
    if (!host) return;
    try {
      const d = await api("/api/readiness");
      const limits = d.knownLimits || [];
      if (!limits.length) {
        host.innerHTML = `<li class="muted">No limits reported by readiness API.</li>`;
        return;
      }
      host.innerHTML = limits.map((L) => `
        <li class="limitItem sev-${esc(L.severity || "medium")}" title="${esc(L.detail || "")}">
          <strong>${esc(L.summary)}</strong>
          <span>${esc(L.detail || "")}</span>
        </li>`).join("");
      seedLimitAlarms(limits);
      logEvent(
        `${limits.length} unfinished-capability LIMIT alarm(s) posted to Alarms tab`,
        "alarm"
      );
    } catch (e) {
      host.innerHTML = `<li class="muted">Could not load limits: ${esc(e.message)}</li>`;
      pushAlarm("Platform limits failed to load — honesty checklist unavailable", { limit: true });
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      const err = new Error(data.error || (data.reasons && data.reasons.join("; ")) || text || r.statusText);
      err.data = data;
      err.status = r.status;
      throw err;
    }
    return data;
  }

  /** Rebind Runtime to canonical model, then refresh live canvas (idempotent). */
  async function syncRuntime(reason) {
    if (!projectId) return null;
    try {
      const bound = await api("/api/runtime/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      if (reason) logEvent(`Runtime synced · ${reason}`, "ok");
      await refreshProject().catch(() => {});
      await refreshCanvas();
      await refreshStatus();
      return bound;
    } catch (e) {
      logEvent(`Runtime sync failed: ${e.message}`, "alarm");
      throw e;
    }
  }

  function logEvent(msg, cls) {
    const row = document.createElement("div");
    row.className = "ev " + (cls || "");
    const ts = new Date().toISOString().slice(11, 23);
    row.innerHTML = `<span class="ts">${esc(ts)}</span> ${esc(msg)}`;
    consoleLog.prepend(row);
    while (consoleLog.children.length > 200) consoleLog.lastChild.remove();
    // Mirror alarm-class events into Alarms so process faults and LIMIT notes stay visible there
    if (/\balarm\b/.test(String(cls || ""))) {
      if (!/LIMIT alarm\(s\) posted/i.test(String(msg))) {
        pushAlarm(msg);
      } else {
        updateAlarmsTabBadge();
      }
    }
  }

  function setSavePill(state) {
    const el = document.getElementById("pillSave");
    el.className = "pill " + (state === "dirty" ? "dirty" : state === "saved" ? "saved" : "");
    el.textContent = state === "dirty" ? "UNSAVED LAYOUT" : state === "saved" ? "SAVED" : "SAVE";
  }

  function applyTransform() {
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    scheduleMinimap();
  }

  function snapVal(v) {
    if (!snapEnabled) return Math.round(v);
    return Math.round(v / SNAP) * SNAP;
  }

  function captureLayout() {
    if (!lastCanvas?.nodes) return null;
    return lastCanvas.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, r: n.r || 0, locked: !!n.locked }));
  }

  function pushUndo(before) {
    if (!before?.length) return;
    undoStack.push(before);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }

  function updateUndoButtons() {
    const u = document.getElementById("btnUndo");
    const r = document.getElementById("btnRedo");
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  function applyLayoutSnapshot(snap) {
    if (!snap?.length || !lastCanvas?.nodes) return;
    const byId = Object.fromEntries(snap.map((s) => [s.id, s]));
    for (const n of lastCanvas.nodes) {
      const s = byId[n.id];
      if (!s) continue;
      n.x = s.x; n.y = s.y;
      if (s.w != null) n.w = s.w;
      if (s.h != null) n.h = s.h;
      if (s.r != null) n.r = s.r;
      if (s.locked != null) n.locked = !!s.locked;
      const el = nodeEls.get(n.id);
      if (el) {
        el.style.left = n.x + "px";
        el.style.top = n.y + "px";
        el.style.width = (n.w || 140) + "px";
        el.style.height = (n.h || 80) + "px";
        el.style.transform = n.r ? `rotate(${n.r}deg)` : "";
        el.classList.toggle("locked", !!n.locked);
      }
    }
    layoutDirty = true;
    setSavePill("dirty");
    redrawLinksOnly();
    scheduleMinimap();
  }

  function undoLayout() {
    if (!undoStack.length) return;
    const cur = captureLayout();
    const prev = undoStack.pop();
    if (cur) redoStack.push(cur);
    applyLayoutSnapshot(prev);
    updateUndoButtons();
    logEvent("Undo layout", "ok");
  }

  function redoLayout() {
    if (!redoStack.length) return;
    const cur = captureLayout();
    const next = redoStack.pop();
    if (cur) undoStack.push(cur);
    applyLayoutSnapshot(next);
    updateUndoButtons();
    logEvent("Redo layout", "ok");
  }

  function setSelection(ids, primaryId) {
    selectedIds.clear();
    for (const id of ids) selectedIds.add(id);
    selected = null;
    if (primaryId) selected = lastCanvas?.nodes?.find((n) => n.id === primaryId) || null;
    if (!selected && selectedIds.size) {
      const first = [...selectedIds][0];
      selected = lastCanvas?.nodes?.find((n) => n.id === first) || null;
    }
    selectedLinkId = null;
    if (selected) studio.classList.add("show-inspector");
    patchSelectionStyles();
    scheduleMinimap();
  }

  function clearGuides() {
    if (guidesSvg) guidesSvg.innerHTML = "";
  }

  function showGuides(lines) {
    if (!guidesSvg || !guidesEnabled) return;
    guidesSvg.innerHTML = "";
    for (const g of lines) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", g.x1);
      line.setAttribute("y1", g.y1);
      line.setAttribute("x2", g.x2);
      line.setAttribute("y2", g.y2);
      line.setAttribute("class", "guideLine");
      guidesSvg.appendChild(line);
    }
  }

  function computeGuides(movingIds, probeNodes) {
    if (!guidesEnabled || !lastCanvas) return { dx: 0, dy: 0, lines: [] };
    const others = (lastCanvas.nodes || []).filter((n) => !movingIds.has(n.id));
    let adjX = 0;
    let adjY = 0;
    const lines = [];
    const worldW = 2400;
    const worldH = 1600;
    for (const p of probeNodes) {
      const pcx = p.x + (p.w || 140) / 2;
      const pcy = p.y + (p.h || 80) / 2;
      const pr = p.x + (p.w || 140);
      const pb = p.y + (p.h || 80);
      for (const o of others) {
        const ocx = o.x + (o.w || 140) / 2;
        const ocy = o.y + (o.h || 80) / 2;
        const or = o.x + (o.w || 140);
        const ob = o.y + (o.h || 80);
        const pairsX = [
          [p.x, o.x], [p.x, ocx], [p.x, or],
          [pcx, o.x], [pcx, ocx], [pcx, or],
          [pr, o.x], [pr, ocx], [pr, or]
        ];
        for (const [a, b] of pairsX) {
          if (Math.abs(a - b) < GUIDE_THRESH) {
            adjX = b - a;
            lines.push({ x1: b, y1: 0, x2: b, y2: worldH });
            break;
          }
        }
        const pairsY = [
          [p.y, o.y], [p.y, ocy], [p.y, ob],
          [pcy, o.y], [pcy, ocy], [pcy, ob],
          [pb, o.y], [pb, ocy], [pb, ob]
        ];
        for (const [a, b] of pairsY) {
          if (Math.abs(a - b) < GUIDE_THRESH) {
            adjY = b - a;
            lines.push({ x1: 0, y1: b, x2: worldW, y2: b });
            break;
          }
        }
      }
    }
    return { dx: adjX, dy: adjY, lines };
  }

  function orthoSeg(a, b) {
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < 4 || dy < 4) return ` L ${b.x} ${b.y}`;
    const mx = Math.round((a.x + b.x) / 2);
    return ` L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
  }

  function orthoPath(x1, y1, x2, y2, waypoints) {
    const pts = [{ x: x1, y: y1 }, ...(waypoints || []).map((w) => ({ x: Number(w.x) || 0, y: Number(w.y) || 0 })), { x: x2, y: y2 }];
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += orthoSeg(pts[i - 1], pts[i]);
    return d;
  }

  function linkLayerVisible(link) {
    const kind = String(link.type || "process").toLowerCase();
    if (/signal|instrument|control|comm/i.test(kind)) return layerVis.signal;
    return layerVis.process;
  }

  function nodeLayerVisible(node) {
    const t = String(node.type || "").toLowerCase();
    if (/transmitter|sensor|switch|flow|pressure|level|temp/i.test(t) && !/tank|pump|valve|motor/i.test(t)) {
      return layerVis.instruments;
    }
    return layerVis.equipment;
  }

  let minimapRaf = 0;
  function scheduleMinimap() {
    if (minimapRaf || destroyed) return;
    minimapRaf = requestAnimationFrame(() => {
      minimapRaf = 0;
      drawMinimap();
    });
  }

  function drawMinimap() {
    if (!minimapCanvas || !lastCanvas) return;
    const ctx = minimapCanvas.getContext("2d");
    const W = minimapCanvas.width;
    const H = minimapCanvas.height;
    const worldW = 2400;
    const worldH = 1600;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(8,20,36,0.92)";
    ctx.fillRect(0, 0, W, H);
    const sx = W / worldW;
    const sy = H / worldH;
    for (const n of lastCanvas.nodes || []) {
      ctx.fillStyle = selectedIds.has(n.id) ? "#28C5FF" : statusClass(n) === "run" ? "#22C55E" : statusClass(n) === "alarm" ? "#EF4444" : "#3a5570";
      ctx.fillRect(n.x * sx, n.y * sy, Math.max(3, (n.w || 140) * sx), Math.max(2, (n.h || 80) * sy));
    }
    const vw = viewport.clientWidth / scale;
    const vh = viewport.clientHeight / scale;
    const vx = -panX / scale;
    const vy = -panY / scale;
    ctx.strokeStyle = "rgba(40,197,255,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(vx * sx, vy * sy, vw * sx, vh * sy);
  }

  function hideCtxMenu() {
    if (!ctxMenu) return;
    ctxMenu.classList.add("hidden");
    ctxMenu.innerHTML = "";
  }

  function openCtxMenu(clientX, clientY, node) {
    if (!ctxMenu || !node) return;
    const cmds = signalCommands(node);
    const items = [
      { label: "Inspect", action: () => { setSelection([node.id], node.id); inspTab = "overview"; syncInspTabs(); renderInspector(); } },
      { label: "Configure", action: () => { setSelection([node.id], node.id); inspTab = "overview"; syncInspTabs(); studio.classList.add("show-inspector"); renderInspector(); } },
      { label: "Control", action: () => { setSelection([node.id], node.id); inspTab = "control"; syncInspTabs(); renderInspector(); } },
      { label: "X-Ray / Why blocked?", action: () => { setSelection([node.id], node.id); setWorkspaceMode("diagnostic"); } },
      { label: "Inspect I/O", action: () => { setSelection([node.id], node.id); inspTab = "io"; syncInspTabs(); renderInspector(); } },
      { sep: true },
      ...cmds.map((c) => ({
        label: c.label,
        sim: true,
        action: () => sendCommand(c.tag, c.value, !!c.pulse)
      })),
      { sep: true },
      { label: node.locked ? "Unlock position" : "Lock position", action: () => { setSelection([node.id], node.id); toggleLockSelection(); } },
      { label: "Duplicate", action: () => duplicateEquipment(node).catch((e) => logEvent(e.message, "alarm")) },
      { label: "Delete from model", action: () => deleteEquipment(node).catch((e) => logEvent(e.message, "alarm")) },
      { label: "Zoom to selection", action: () => zoomToSelection() }
    ];
    ctxMenu.innerHTML = items.map((it, i) => {
      if (it.sep) return `<div class="ctxSep"></div>`;
      return `<button type="button" role="menuitem" data-i="${i}" class="${it.sim ? "simAction" : ""}">${esc(it.label)}${it.sim ? " <span class='muted'>sim</span>" : ""}</button>`;
    }).join("");
    ctxMenu.classList.remove("hidden");
    const pad = 8;
    const mw = ctxMenu.offsetWidth || 200;
    const mh = ctxMenu.offsetHeight || 240;
    ctxMenu.style.left = Math.min(clientX, window.innerWidth - mw - pad) + "px";
    ctxMenu.style.top = Math.min(clientY, window.innerHeight - mh - pad) + "px";
    ctxMenu.querySelectorAll("button[data-i]").forEach((btn) => {
      btn.onclick = () => {
        const it = items[Number(btn.dataset.i)];
        hideCtxMenu();
        if (it?.action) it.action();
      };
    });
  }

  function syncInspTabs() {
    [...document.getElementById("inspTabs").querySelectorAll("button")].forEach((x) =>
      x.classList.toggle("active", x.dataset.tab === inspTab)
    );
  }

  function symbolSvg(type, running, valveState) {
    const t = String(type || "").toLowerCase();
    if (t.includes("pump")) {
      const flow = running ? `<path class="flowPulse" d="M2 16 H12" stroke="#22C55E" stroke-width="2"/><path class="flowPulse" d="M36 16 H46" stroke="#22C55E" stroke-width="2"/>` : `<path d="M2 16 H12" stroke="#3a5570" stroke-width="2"/><path d="M36 16 H46" stroke="#3a5570" stroke-width="2"/>`;
      return `<svg viewBox="0 0 48 32"><circle class="${running ? "rotor" : ""}" cx="24" cy="16" r="10" fill="none" stroke="#28C5FF" stroke-width="2"/><path d="M24 6 L28 16 L24 26 L20 16 Z" fill="#168FF0" class="${running ? "rotor" : ""}"/>${flow}</svg>`;
    }
    if (t.includes("motor")) {
      return `<svg viewBox="0 0 48 32"><rect x="10" y="8" width="28" height="16" rx="3" fill="none" stroke="#28C5FF" stroke-width="2"/><circle class="${running ? "rotor" : ""}" cx="24" cy="16" r="5" fill="#168FF0"/></svg>`;
    }
    if (t.includes("valve")) {
      const open = valveState === "open";
      const mid = valveState === "opening";
      const fill = open ? "#22C55E" : mid ? "#F59E0B" : "#20B8A6";
      const stem = open ? `<rect class="valveStem open" x="22" y="4" width="4" height="24" fill="#28C5FF"/>` : mid ? `<rect class="valveStem mid" x="22" y="8" width="4" height="16" fill="#F59E0B"/>` : `<rect class="valveStem" x="22" y="10" width="4" height="12" fill="#8aa0b5"/>`;
      return `<svg viewBox="0 0 48 32"><path d="M8 16 L20 8 L20 24 Z" fill="${fill}"/><path d="M40 16 L28 8 L28 24 Z" fill="${fill}"/>${stem}</svg>`;
    }
    if (t.includes("tank")) {
      return `<svg viewBox="0 0 48 32"><rect x="12" y="4" width="24" height="24" rx="3" fill="none" stroke="#28C5FF" stroke-width="2"/><rect class="flowPulse" x="14" y="18" width="20" height="8" fill="rgba(34,197,94,0.45)"/></svg>`;
    }
    if (t.includes("estop") || t.includes("emergency")) {
      return `<svg viewBox="0 0 48 32"><circle cx="24" cy="16" r="11" fill="#EF4444"/><text x="24" y="20" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif">E</text></svg>`;
    }
    if (t.includes("flow")) {
      return `<svg viewBox="0 0 48 32"><path d="M6 16 H42" stroke="#20B8A6" stroke-width="2"/><path class="flowPulse" d="M18 10 L30 16 L18 22 Z" fill="#28C5FF"/></svg>`;
    }
    if (t.includes("pressure")) {
      return `<svg viewBox="0 0 48 32"><circle cx="24" cy="16" r="10" fill="none" stroke="#F59E0B" stroke-width="2"/><path d="M24 16 L30 10" stroke="#F59E0B" stroke-width="2"/></svg>`;
    }
    if (t.includes("level") || t.includes("switch") || t.includes("sensor") || t.includes("transmitter")) {
      return `<svg viewBox="0 0 48 32"><circle cx="24" cy="16" r="8" fill="none" stroke="#F59E0B" stroke-width="2"/><path d="M24 8 V4 M24 28 V24 M8 16 H4 M40 16 H44" stroke="#F59E0B" stroke-width="2"/></svg>`;
    }
    return `<svg viewBox="0 0 48 32"><rect x="10" y="8" width="28" height="16" rx="2" fill="none" stroke="#8aa0b5" stroke-width="2"/></svg>`;
  }

  function statusClass(node) {
    const live = node.live || {};
    const keys = Object.keys(live);
    if (keys.some((k) => /ESTOP|Healthy/i.test(k) && live[k] === false)) return "alarm";
    if (keys.some((k) => /Fault/i.test(k) && live[k] === true)) return "alarm";
    if (keys.some((k) => /Running|Energize/i.test(k) && live[k] === true)) return "run";
    if (/valve/i.test(node.type) && keys.some((k) => /Opened/i.test(k) && live[k] === true)) return "open";
    if (/valve/i.test(node.type) && keys.some((k) => /OpenCommand/i.test(k) && live[k] === true)) return "trans";
    return "";
  }

  function isActuallyRunning(node) {
    const live = node.live || {};
    return Object.keys(live).some((k) => /Running|Energize/i.test(k) && live[k] === true);
  }

  function valveVisualState(node) {
    const live = node.live || {};
    const opened = Object.entries(live).some(([k, v]) => /OpenedFeedback/i.test(k) && v === true);
    const cmd = Object.entries(live).some(([k, v]) => /OpenCommand/i.test(k) && v === true);
    if (opened) return "open";
    if (cmd) return "opening";
    return "closed";
  }

  function processFlowGpm(canvas) {
    let best = 0;
    for (const n of canvas?.nodes || []) {
      for (const [k, v] of Object.entries(n.live || {})) {
        if (/FlowGpm|FlowRate|Flow\b/i.test(k) && Number.isFinite(Number(v))) {
          best = Math.max(best, Number(v));
        }
      }
    }
    return best;
  }

  function isUnverified(node) {
    const dc = String(node.dataClass || node.properties?.dataClass || "");
    return /INFERENCE|EXTRACT|UNVERIFIED|OCR/i.test(dc);
  }

  async function refreshProject() {
    const d = await api("/api/model/projects/active");
    const p = d.project;
    if (!p) throw new Error("No active project");
    projectId = p.id;
    document.getElementById("projectName").textContent = p.name || "Untitled";
    document.getElementById("projectMeta").textContent =
      `id=${p.id} · model v${p.modelVersion} · layout ${p.ui?.graph?.updatedAt ? "saved" : "default"}`;
  }

  async function refreshStatus() {
    try {
      const s = await api("/api/runtime/status");
      const run = document.getElementById("pillRun");
      document.getElementById("pillMode").textContent = String(s.mode || "SIM").toUpperCase();
      const running = !!(s.running || s.scanning || s.state === "running");
      const paused = !!(s.paused || s.state === "paused");
      run.className = "pill " + (paused ? "pause" : running ? "run" : "stop");
      run.textContent = paused ? "PAUSED" : running ? "RUNNING" : "STOPPED";
      const t = s.simClock?.timeMs ?? s.timeMs ?? s.sim?.timeMs;
      document.getElementById("pillSim").textContent = t != null ? `SIM ${t}ms` : "SIM —";
      if (s.mem?.M1 || ioTripHint(lastCanvas)) run.classList.add("trip");
    } catch (_) { /* ignore */ }
  }

  function ioTripHint(canvas) {
    return !!(canvas?.mem?.M1);
  }

  function updateCanvasMeta(data) {
    document.getElementById("canvasMeta").textContent =
      `${data.name || ""} · nodes=${(data.nodes || []).length}` +
      (data.layoutSaved ? " · layout persisted" : " · default layout") +
      ` · zoom ${Math.round(scale * 100)}%` +
      ` · ${workspaceMode}`;
  }

  function nodeLiveText(node) {
    const liveKeys = Object.keys(node.live || {}).slice(0, 2);
    return liveKeys.map((k) => `${k.split(".").pop()}=${fmtLive(node.live[k])}`).join(" · ") || "—";
  }

  function onNodeClick(node, el, ev) {
    if (el.dataset.dragged === "1") {
      el.dataset.dragged = "0";
      return;
    }
    if (connectMode) {
      handleConnectClick(node);
      return;
    }
    hideCtxMenu();
    const multi = ev?.ctrlKey || ev?.metaKey;
    if (multi) {
      if (selectedIds.has(node.id)) selectedIds.delete(node.id);
      else selectedIds.add(node.id);
      setSelection([...selectedIds], node.id);
    } else {
      setSelection([node.id], node.id);
    }
    studio.classList.add("show-inspector");
    if (xrayMode || inspTab === "xray" || workspaceMode === "diagnostic") {
      inspTab = "xray";
      syncInspTabs();
      loadXray(node).then(() => {
        patchSelectionStyles();
        renderInspector();
      });
    } else {
      renderInspector();
    }
  }

  function ensureNodeEl(node) {
    let el = nodeEls.get(node.id);
    if (el) return el;
    el = document.createElement("div");
    el.dataset.id = node.id;
    el.dataset.type = node.type || "";
    el.innerHTML = `
      <span class="badge" hidden>!</span>
      <div class="tankFill" hidden></div>
      <div class="sym"></div>
      <h3></h3>
      <div class="type"></div>
      <div class="liveLine"></div>
      <div class="resizeHandle" data-resize="1" title="Resize"></div>`;
    el.addEventListener("pointerdown", (ev) => {
      const n = lastCanvas?.nodes?.find((x) => x.id === node.id);
      if (n) onNodePointerDown(ev, n, el);
    });
    el.addEventListener("click", (ev) => {
      const n = lastCanvas?.nodes?.find((x) => x.id === node.id);
      if (n) onNodeClick(n, el, ev);
    });
    el.addEventListener("dblclick", () => {
      const n = lastCanvas?.nodes?.find((x) => x.id === node.id);
      if (!n) return;
      setSelection([n.id], n.id);
      inspTab = "overview";
      syncInspTabs();
      studio.classList.add("show-inspector");
      renderInspector();
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const n = lastCanvas?.nodes?.find((x) => x.id === node.id);
      if (!n) return;
      if (!selectedIds.has(n.id)) setSelection([n.id], n.id);
      openCtxMenu(ev.clientX, ev.clientY, n);
    });
    stage.appendChild(el);
    nodeEls.set(node.id, el);
    return el;
  }

  function patchNodeEl(el, node) {
    const st = statusClass(node);
    const w = node.w || 140;
    const h = node.h || 80;
    const xrayHit = (xrayMode || workspaceMode === "diagnostic") && (xrayData?.highlightEquipmentIds || []).includes(node.id);
    const draggingThis = (drag && (drag.id === node.id || drag.ids?.includes(node.id))) || resize?.id === node.id;
    el.className =
      "eqNode " +
      st +
      (selectedIds.has(node.id) || selected?.id === node.id ? " selected" : "") +
      (xrayHit ? " xrayHit" : "") +
      (workspaceMode === "engineering" ? " engMode" : "") +
      (isUnverified(node) ? " unverified" : "") +
      (node.locked ? " locked" : "");
    el.style.display = nodeLayerVisible(node) ? "" : "none";
    if (!draggingThis) {
      el.style.left = node.x + "px";
      el.style.top = node.y + "px";
      el.style.width = w + "px";
      el.style.height = h + "px";
    }
    const rot = Number(node.r) || 0;
    el.style.transform = rot ? `rotate(${rot}deg)` : "";
    const badge = el.querySelector(".badge");
    if (badge) badge.hidden = st !== "alarm";
    const isTank = /tank/i.test(node.type);
    const fill = el.querySelector(".tankFill");
    if (fill) {
      fill.hidden = !isTank;
      if (isTank) {
        const target = tankLevelPct(node);
        if (!displayLevels.has(node.id)) displayLevels.set(node.id, target);
        const shown = displayLevels.get(node.id);
        fill.style.height = Math.max(4, Math.min(55, shown * 0.55)) + "%";
      }
    }
    const running = isActuallyRunning(node);
    const vState = /valve/i.test(node.type) ? valveVisualState(node) : "";
    const sym = el.querySelector(".sym");
    const symKey = `${node.type}|${running}|${vState}|${st}`;
    if (sym && el.dataset.symKey !== symKey) {
      sym.innerHTML = symbolSvg(node.type, running, vState);
      el.dataset.symKey = symKey;
    }
    const h3 = el.querySelector("h3");
    if (h3 && h3.textContent !== node.tag) h3.textContent = node.tag;
    const typeEl = el.querySelector(".type");
    const stateLabel = st === "alarm" ? "alarm" : running ? "running" : vState || st || "stopped";
    const typeTxt = `${node.type} · ${stateLabel}`;
    if (typeEl && typeEl.textContent !== typeTxt) typeEl.textContent = typeTxt;
    const liveEl = el.querySelector(".liveLine");
    const liveTxt = nodeLiveText(node);
    if (liveEl && liveEl.textContent !== liveTxt) liveEl.textContent = liveTxt;
  }

  function ensureLinkEl(link) {
    let path = linkEls.get(link.id);
    if (path) return path;
    path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.dataset.linkId = link.id;
    path.setAttribute("fill", "none");
    path.style.pointerEvents = "stroke";
    path.style.cursor = "pointer";
    path.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectedLinkId = link.id;
      selectedIds.clear();
      selected = null;
      patchSelectionStyles();
      const live = lastCanvas?.links?.find((l) => l.id === link.id) || link;
      showLinkInspector(live);
      syncWaypointHandles(live);
    });
    path.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const live = lastCanvas?.links?.find((l) => l.id === link.id) || link;
      addWaypointAt(live, ev.clientX, ev.clientY).catch((e) => logEvent(e.message, "alarm"));
    });
    linksSvg.appendChild(path);
    linkEls.set(link.id, path);
    return path;
  }

  function patchLinkEl(path, link, byId) {
    const a = byId[link.from];
    const b = byId[link.to];
    if (!a || !b || !linkLayerVisible(link) || !nodeLayerVisible(a) || !nodeLayerVisible(b)) {
      path.style.display = "none";
      clearWaypointHandles(link.id);
      return;
    }
    path.style.display = "";
    const aw = a.w || 140;
    const ah = a.h || 80;
    const bw = b.w || 140;
    const bh = b.h || 80;
    const x1 = a.x + aw / 2;
    const y1 = a.y + ah / 2;
    const x2 = b.x + bw / 2;
    const y2 = b.y + bh / 2;
    path.setAttribute("d", orthoPath(x1, y1, x2, y2, link.waypoints));
    // Flow animation only when hydraulically supported (pump/motor actually running)
    const flowing = isActuallyRunning(a) || isActuallyRunning(b);
    const gpm = processFlowGpm(lastCanvas);
    const intensity = flowing ? Math.max(0.25, Math.min(1, gpm / 50)) : 0;
    const xrayLinks = new Set(xrayData?.highlightConnectionIds || []);
    const kind = String(link.type || "process").toLowerCase();
    let stroke = flowing ? `rgba(34,197,94,${0.45 + intensity * 0.5})` : "rgba(40,197,255,0.4)";
    if (!flowing) {
      if (kind === "mechanical" || kind === "electrical") stroke = "rgba(245,158,11,0.55)";
      else if (kind === "signal" || kind === "instrumentation" || kind === "control") stroke = "rgba(168,85,247,0.55)";
      else if (kind === "communication") stroke = "rgba(148,163,184,0.55)";
    }
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", flowing ? String(2 + intensity * 2.5) : "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (flowing && motionEnabled) {
      path.style.animationDuration = `${Math.max(0.45, 1.6 - intensity)}s`;
    } else {
      path.style.animationDuration = "";
    }
    path.classList.toggle("flowPulse", flowing && motionEnabled && workspaceMode !== "engineering");
    path.classList.toggle("xrayLink", (xrayMode || workspaceMode === "diagnostic") && xrayLinks.has(link.id));
    path.classList.toggle("linkSelected", selectedLinkId === link.id);
    path.classList.toggle("linkSignal", /signal|instrument|control|comm/i.test(kind));
  }

  function patchSelectionStyles() {
    if (!lastCanvas) return;
    const byId = Object.fromEntries((lastCanvas.nodes || []).map((n) => [n.id, n]));
    for (const [id, el] of nodeEls) {
      const n = byId[id];
      if (n) patchNodeEl(el, n);
    }
    for (const [id, line] of linkEls) {
      const link = (lastCanvas.links || []).find((l) => l.id === id);
      if (link) patchLinkEl(line, link, byId);
    }
  }

  /** Incremental sync — preserve element identity across Runtime polls */
  function syncCanvas(data) {
    lastCanvas = data;
    updateCanvasMeta(data);
    const nodes = data.nodes || [];
    const links = data.links || [];
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const seenNodes = new Set();
    const seenLinks = new Set();

    for (const node of nodes) {
      seenNodes.add(node.id);
      const el = ensureNodeEl(node);
      patchNodeEl(el, node);
      const targetLvl = tankLevelPct(node);
      if (/tank/i.test(node.type)) {
        if (!motionEnabled || !displayLevels.has(node.id)) displayLevels.set(node.id, targetLvl);
      }
    }
    for (const [id, el] of [...nodeEls]) {
      if (!seenNodes.has(id)) {
        el.remove();
        nodeEls.delete(id);
        displayLevels.delete(id);
      }
    }

    for (const link of links) {
      seenLinks.add(link.id);
      const line = ensureLinkEl(link);
      patchLinkEl(line, link, byId);
    }
    for (const [id, line] of [...linkEls]) {
      if (!seenLinks.has(id)) {
        line.remove();
        linkEls.delete(id);
      }
    }
    scheduleVisualFrame();
    scheduleMinimap();
  }

  /** Alias used by existing call sites */
  function renderCanvas(data) {
    syncCanvas(data);
  }

  function scheduleVisualFrame() {
    if (rafId || destroyed || !motionEnabled) return;
    rafId = requestAnimationFrame(visualTick);
  }

  function visualTick() {
    rafId = 0;
    if (destroyed || !lastCanvas) return;
    let needAnother = false;
    for (const node of lastCanvas.nodes || []) {
      if (!/tank/i.test(node.type)) continue;
      const target = tankLevelPct(node);
      let cur = displayLevels.has(node.id) ? displayLevels.get(node.id) : target;
      const next = cur + (target - cur) * 0.22;
      if (Math.abs(next - target) < 0.15) {
        displayLevels.set(node.id, target);
      } else {
        displayLevels.set(node.id, next);
        needAnother = true;
      }
      const el = nodeEls.get(node.id);
      const fill = el?.querySelector(".tankFill");
      if (fill && !fill.hidden) {
        fill.style.height = Math.max(4, Math.min(55, displayLevels.get(node.id) * 0.55)) + "%";
      }
    }
    if (needAnother) scheduleVisualFrame();
  }

  function clearWaypointHandles(linkId) {
    const els = wpEls.get(linkId) || [];
    for (const el of els) el.remove();
    wpEls.delete(linkId);
  }

  function clearAllWaypointHandles() {
    for (const id of [...wpEls.keys()]) clearWaypointHandles(id);
  }

  function syncWaypointHandles(link) {
    clearAllWaypointHandles();
    if (!link || selectedLinkId !== link.id) return;
    const wps = link.waypoints || [];
    const els = [];
    wps.forEach((wp, idx) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", wp.x);
      c.setAttribute("cy", wp.y);
      c.setAttribute("r", "6");
      c.setAttribute("class", "wpHandle");
      c.style.cursor = "move";
      c.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        c.setPointerCapture(ev.pointerId);
        waypointDrag = { linkId: link.id, index: idx };
      });
      c.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        removeWaypoint(link.id, idx).catch((e) => logEvent(e.message, "alarm"));
      });
      linksSvg.appendChild(c);
      els.push(c);
    });
    wpEls.set(link.id, els);
  }

  function clientToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: snapVal((clientX - rect.left - panX) / scale),
      y: snapVal((clientY - rect.top - panY) / scale)
    };
  }

  async function persistWaypoints(linkId, waypoints) {
    if (!projectId) return;
    await api(`/api/model/projects/${projectId}/connections/${linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints })
    });
    const link = lastCanvas?.links?.find((l) => l.id === linkId);
    if (link) link.waypoints = waypoints;
    layoutDirty = true;
    setSavePill("dirty");
    redrawLinksOnly();
    if (selectedLinkId === linkId) syncWaypointHandles(link);
  }

  async function addWaypointAt(link, clientX, clientY) {
    const pt = clientToWorld(clientX, clientY);
    const wps = [...(link.waypoints || []), pt];
    await persistWaypoints(link.id, wps);
    selectedLinkId = link.id;
    showLinkInspector(lastCanvas.links.find((l) => l.id === link.id) || link);
    logEvent(`Waypoint added on ${link.id}`, "ok");
  }

  async function removeWaypoint(linkId, index) {
    const link = lastCanvas?.links?.find((l) => l.id === linkId);
    if (!link) return;
    const wps = [...(link.waypoints || [])];
    wps.splice(index, 1);
    await persistWaypoints(linkId, wps);
    logEvent("Waypoint removed", "ok");
  }

  function showLinkInspector(link) {
    const title = document.getElementById("inspTitle");
    const sub = document.getElementById("inspSub");
    const body = document.getElementById("inspBody");
    const byId = Object.fromEntries((lastCanvas?.nodes || []).map((n) => [n.id, n]));
    const a = byId[link.from];
    const b = byId[link.to];
    title.textContent = "Connection";
    sub.textContent = `${a?.tag || "?"} → ${b?.tag || "?"} · ${link.type || "process"}`;
    const wpCount = (link.waypoints || []).length;
    body.innerHTML = `
      <pre>${esc(JSON.stringify({ id: link.id, type: link.type, from: a?.tag, to: b?.tag, waypoints: wpCount }, null, 2))}</pre>
      <p class="muted">Double-click pipe to add waypoint · drag handles · double-click handle to remove</p>
      <div class="cmdRow">
        <button type="button" id="btnClearWps">Clear waypoints</button>
        <button type="button" id="btnDelLink">Delete connection</button>
        <button type="button" id="btnClearLinkSel">Clear selection</button>
      </div>
      <p class="warn">Deletes from canonical model — not a visual-only change.</p>`;
    document.getElementById("btnClearWps").onclick = () => persistWaypoints(link.id, []).then(() => {
      showLinkInspector(lastCanvas.links.find((l) => l.id === link.id) || link);
    });
    document.getElementById("btnDelLink").onclick = () => deleteConnection(link.id);
    document.getElementById("btnClearLinkSel").onclick = () => {
      selectedLinkId = null;
      clearAllWaypointHandles();
      renderCanvas(lastCanvas);
      renderInspector();
    };
    studio.classList.add("show-inspector");
    syncWaypointHandles(link);
  }

  async function deleteConnection(connectionId) {
    if (!projectId || !connectionId) return;
    await api(`/api/model/projects/${projectId}/connections/${connectionId}`, { method: "DELETE" });
    selectedLinkId = null;
    clearAllWaypointHandles();
    logEvent(`Connection deleted ${connectionId}`, "ok");
    await syncRuntime("connection deleted");
  }

  async function deleteEquipment(nodeOrId) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId?.id;
    if (!projectId || !id) return;
    const tag = typeof nodeOrId === "object" ? nodeOrId.tag : id;
    if (!confirm(`Delete equipment ${tag} from the canonical model? Connections and bound signals will be removed. Runtime will rebind.`)) {
      return;
    }
    await api(`/api/model/projects/${projectId}/equipment/${id}`, { method: "DELETE" });
    selectedIds.delete(id);
    if (selected?.id === id) selected = null;
    logEvent(`Deleted equipment ${tag}`, "ok");
    await syncRuntime("equipment deleted");
    renderInspector();
  }

  async function reworkEquipment(node, patch) {
    if (!projectId || !node?.id) return;
    await api(`/api/model/projects/${projectId}/equipment/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    logEvent(`Updated ${node.tag}`, "ok");
    await syncRuntime("equipment updated");
    selected = lastCanvas?.nodes?.find((n) => n.id === node.id) || selected;
    renderInspector();
  }

  async function handleConnectClick(node) {
    if (!connectFrom) {
      connectFrom = node;
      logEvent(`Connect: from ${node.tag} — select destination`, "ok");
      document.getElementById("modeHint").textContent = `connect from ${node.tag} → click target`;
      return;
    }
    if (connectFrom.id === node.id) {
      connectFrom = null;
      logEvent("Connect cancelled", "alarm");
      document.getElementById("modeHint").textContent = "connect mode · click source then target";
      return;
    }
    try {
      await api(`/api/model/projects/${projectId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromEquipmentId: connectFrom.id,
          toEquipmentId: node.id,
          connectionType: "process",
          description: `${connectFrom.tag} → ${node.tag}`
        })
      });
      logEvent(`Connected ${connectFrom.tag} → ${node.tag}`, "ok");
      connectFrom = null;
      document.getElementById("modeHint").textContent = "connect mode · click source then target";
      await syncRuntime("connection created");
    } catch (e) {
      logEvent(`Connect failed: ${e.message}`, "alarm");
      connectFrom = null;
    }
  }

  async function loadXray(node) {
    if (!node) return null;
    try {
      xrayData = await api(`/api/runtime/xray?equipmentId=${encodeURIComponent(node.id)}`);
      return xrayData;
    } catch (e) {
      xrayData = { ok: false, error: e.message, conditions: [], chain: [] };
      return xrayData;
    }
  }

  function renderXrayPanel(body, rejectHtml) {
    if (!xrayData || xrayData.ok === false) {
      body.innerHTML = `${rejectHtml}<p class="muted">${esc(xrayData?.error || "Select equipment and open X-Ray.")}</p>`;
      return;
    }
    const block = xrayData.primaryBlocker;
    const head = xrayData.inhibited
      ? `<div class="xrayBlock"><b>${esc(xrayData.title)}</b><br>${esc(block?.detail || "Inhibited")}</div>`
      : `<div class="xrayOk"><b>${esc(xrayData.title)}</b></div>`;
    const conds = (xrayData.conditions || [])
      .map(
        (c) => `<li data-tag="${esc(c.signalTag || "")}">
          <span>${esc(c.label)}</span>
          <span class="st-${esc(c.status)}">${esc(c.status)}</span>
        </li>`
      )
      .join("");
    const chain = (xrayData.chain || [])
      .map((c) => `<li><b>${esc(c.step)}</b> ${esc(c.tag)} = ${esc(typeof c.value === "object" ? JSON.stringify(c.value) : c.value)}${c.address ? ` · ${esc(c.address)}` : ""}</li>`)
      .join("");
    body.innerHTML = `${rejectHtml}${head}
      <p class="muted">Click a condition to focus its signal. Highlighted path uses live Runtime values.</p>
      <ul class="condList">${conds}</ul>
      <p><b>Signal path</b></p>
      <ul class="chainSteps">${chain || "<li class='muted'>No chain</li>"}</ul>
      <div class="cmdRow">
        <button type="button" id="btnRefreshXray">Refresh X-Ray</button>
        <button type="button" id="btnFaultValve">Inject stuck valve (sim)</button>
        <button type="button" id="btnClearFaults">Clear faults</button>
      </div>
      <p class="warn">${esc(xrayData.note || "")}</p>`;
    body.querySelectorAll(".condList li").forEach((li) => {
      li.onclick = () => {
        const tag = li.dataset.tag;
        if (tag) logEvent(`X-Ray focus ${tag}`, "ok");
      };
    });
    document.getElementById("btnRefreshXray").onclick = async () => {
      if (selected) {
        await loadXray(selected);
        renderCanvas(lastCanvas);
        renderInspector();
      }
    };
    document.getElementById("btnFaultValve").onclick = async () => {
      // Stuck closed feedback on VALVE opened address I1
      await api("/api/fault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ var: "I1", mode: "stuck", value: false })
      });
      logEvent("Fault injected: VALVE opened feedback stuck FALSE (sim)", "alarm");
      if (selected) {
        await loadXray(selected);
        renderCanvas(lastCanvas);
        renderInspector();
      }
    };
    document.getElementById("btnClearFaults").onclick = async () => {
      try {
        await api("/api/fault/I1", { method: "DELETE" });
      } catch (_) { /* ignore */ }
      logEvent("Faults cleared (I1)", "ok");
      if (selected) {
        await loadXray(selected);
        renderCanvas(lastCanvas);
        renderInspector();
      }
    };
  }

  function tankLevelPct(node) {
    const live = node.live || {};
    for (const [k, v] of Object.entries(live)) {
      if (/LevelPct/i.test(k) && Number.isFinite(Number(v))) return Number(v);
    }
    const init = Number(node.properties?.initialLevelPct);
    return Number.isFinite(init) ? init : 0;
  }

  function fmtLive(v) {
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
    return String(v);
  }

  function onNodePointerDown(ev, node, el) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    hideCtxMenu();
    if (node.locked && ev.target?.dataset?.resize !== "1") {
      // Allow select/click but not drag when locked
      return;
    }
    if (ev.target?.dataset?.resize === "1") {
      if (node.locked) return;
      el.setPointerCapture(ev.pointerId);
      resize = {
        id: node.id,
        el,
        startX: ev.clientX,
        startY: ev.clientY,
        origW: node.w || 140,
        origH: node.h || 80,
        before: captureLayout()
      };
      return;
    }
    if (!selectedIds.has(node.id) && !(ev.ctrlKey || ev.metaKey)) {
      setSelection([node.id], node.id);
    } else if (!selectedIds.has(node.id)) {
      selectedIds.add(node.id);
      setSelection([...selectedIds], node.id);
    }
    const ids = selectedIds.size ? [...selectedIds] : [node.id];
    const origins = {};
    for (const id of ids) {
      const n = lastCanvas?.nodes?.find((x) => x.id === id);
      if (n) origins[id] = { x: n.x, y: n.y };
    }
    el.setPointerCapture(ev.pointerId);
    drag = {
      id: node.id,
      ids,
      origins,
      el,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      before: captureLayout()
    };
  }

  function redrawLinksOnly() {
    if (!lastCanvas) return;
    const byId = Object.fromEntries((lastCanvas.nodes || []).map((n) => [n.id, n]));
    for (const link of lastCanvas.links || []) {
      const line = linkEls.get(link.id) || ensureLinkEl(link);
      patchLinkEl(line, link, byId);
    }
  }

  function onPointerMove(ev) {
    if (waypointDrag && lastCanvas) {
      const link = lastCanvas.links.find((l) => l.id === waypointDrag.linkId);
      if (link) {
        const pt = clientToWorld(ev.clientX, ev.clientY);
        if (!link.waypoints) link.waypoints = [];
        link.waypoints[waypointDrag.index] = pt;
        redrawLinksOnly();
        syncWaypointHandles(link);
      }
      return;
    }
    if (marquee) {
      const rect = viewport.getBoundingClientRect();
      const x0 = (marquee.startX - rect.left - panX) / scale;
      const y0 = (marquee.startY - rect.top - panY) / scale;
      const x1 = (ev.clientX - rect.left - panX) / scale;
      const y1 = (ev.clientY - rect.top - panY) / scale;
      const l = Math.min(x0, x1);
      const t = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      marqueeEl.classList.remove("hidden");
      marqueeEl.style.left = l + "px";
      marqueeEl.style.top = t + "px";
      marqueeEl.style.width = w + "px";
      marqueeEl.style.height = h + "px";
      marquee.box = { l, t, r: l + w, b: t + h };
      return;
    }
    if (resize) {
      const dw = (ev.clientX - resize.startX) / scale;
      const dh = (ev.clientY - resize.startY) / scale;
      const nw = Math.max(90, snapVal(resize.origW + dw));
      const nh = Math.max(60, snapVal(resize.origH + dh));
      resize.el.style.width = nw + "px";
      resize.el.style.height = nh + "px";
      const n = lastCanvas?.nodes?.find((x) => x.id === resize.id);
      if (n) { n.w = nw; n.h = nh; }
      layoutDirty = true;
      setSavePill("dirty");
      resize.el.dataset.dragged = "1";
      redrawLinksOnly();
      return;
    }
    if (drag) {
      let dx = (ev.clientX - drag.startX) / scale;
      let dy = (ev.clientY - drag.startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const moving = new Set(drag.ids);
      const probes = drag.ids.map((id) => {
        const o = drag.origins[id];
        const n = lastCanvas?.nodes?.find((x) => x.id === id);
        return { id, x: o.x + dx, y: o.y + dy, w: n?.w || 140, h: n?.h || 80 };
      });
      const g = computeGuides(moving, probes);
      if (g.lines.length) {
        dx += g.dx;
        dy += g.dy;
        showGuides(g.lines);
      } else clearGuides();
      for (const id of drag.ids) {
        const o = drag.origins[id];
        const nx = snapVal(o.x + dx);
        const ny = snapVal(o.y + dy);
        const n = lastCanvas?.nodes?.find((x) => x.id === id);
        const el = nodeEls.get(id);
        if (n) { n.x = nx; n.y = ny; }
        if (el) {
          el.style.left = nx + "px";
          el.style.top = ny + "px";
          if (drag.moved) el.dataset.dragged = "1";
        }
      }
      if (drag.moved) {
        layoutDirty = true;
        setSavePill("dirty");
        redrawLinksOnly();
        scheduleMinimap();
      }
      return;
    }
    if (panDrag) {
      panX = panDrag.ox + (ev.clientX - panDrag.x);
      panY = panDrag.oy + (ev.clientY - panDrag.y);
      applyTransform();
    }
  }

  function onPointerUp() {
    if (waypointDrag) {
      const link = lastCanvas?.links?.find((l) => l.id === waypointDrag.linkId);
      const wps = link?.waypoints || [];
      const id = waypointDrag.linkId;
      waypointDrag = null;
      persistWaypoints(id, wps).catch((e) => logEvent(e.message, "alarm"));
      return;
    }
    if (marquee) {
      const box = marquee.box;
      marqueeEl.classList.add("hidden");
      if (box && (box.r - box.l > 4 || box.b - box.t > 4)) {
        const hits = (lastCanvas?.nodes || []).filter((n) => {
          const cx = n.x + (n.w || 140) / 2;
          const cy = n.y + (n.h || 80) / 2;
          return cx >= box.l && cx <= box.r && cy >= box.t && cy <= box.b;
        }).map((n) => n.id);
        if (hits.length) {
          setSelection(hits, hits[0]);
          studio.classList.add("show-inspector");
          renderInspector();
        }
      }
      marquee = null;
    }
    if (drag?.moved && drag.before) pushUndo(drag.before);
    if (resize && resize.before) {
      const n = lastCanvas?.nodes?.find((x) => x.id === resize.id);
      if (n && (n.w !== resize.origW || n.h !== resize.origH)) pushUndo(resize.before);
    }
    clearGuides();
    drag = null;
    resize = null;
    panDrag = null;
    viewport.classList.remove("panning");
  }

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".eqNode")) return;
    if (ev.target.closest(".minimap")) return;
    if (ev.button !== 0) return;
    hideCtxMenu();
    if (ev.shiftKey) {
      marquee = { startX: ev.clientX, startY: ev.clientY, box: null };
      viewport.setPointerCapture(ev.pointerId);
      return;
    }
    if (!ev.ctrlKey && !ev.metaKey) {
      selectedIds.clear();
      selected = null;
      selectedLinkId = null;
      patchSelectionStyles();
    }
    panDrag = { x: ev.clientX, y: ev.clientY, ox: panX, oy: panY };
    viewport.classList.add("panning");
    viewport.setPointerCapture(ev.pointerId);
  });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointerdown", (ev) => {
    if (ctxMenu && !ctxMenu.contains(ev.target) && !ev.target.closest(".eqNode")) hideCtxMenu();
  });
  viewport.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const worldX = (mx - panX) / scale;
    const worldY = (my - panY) / scale;
    const factor = ev.deltaY > 0 ? 0.92 : 1.08;
    const next = Math.min(2.5, Math.max(0.25, scale * factor));
    scale = next;
    panX = mx - worldX * scale;
    panY = my - worldY * scale;
    applyTransform();
    if (lastCanvas) updateCanvasMeta(lastCanvas);
  }, { passive: false });

  async function refreshCanvas() {
    if (pollInFlight || destroyed) return;
    if (playbackMode) {
      // Playback freezes live visual SoR to recorded frame; still allow layout sync skip
      return;
    }
    pollInFlight = true;
    try {
      const data = await api("/api/runtime/canvas");
      // Preserve in-progress drag/resize geometry (authoritative layout is local until save)
      if ((layoutDirty || drag || resize) && lastCanvas?.nodes) {
        const pos = Object.fromEntries(lastCanvas.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h, r: n.r, locked: n.locked }]));
        for (const n of data.nodes || []) {
          if (pos[n.id]) {
            n.x = pos[n.id].x;
            n.y = pos[n.id].y;
            if (pos[n.id].w != null) n.w = pos[n.id].w;
            if (pos[n.id].h != null) n.h = pos[n.id].h;
            if (pos[n.id].r != null) n.r = pos[n.id].r;
            if (pos[n.id].locked != null) n.locked = pos[n.id].locked;
          }
        }
      }
      // Keep selected object identity for inspector
      if (selected?.id) {
        selected = (data.nodes || []).find((n) => n.id === selected.id) || selected;
      }
      syncCanvas(data);
      lastPollAt = performance.now();
      refreshHistoryMeta().catch(() => {});
    } finally {
      pollInFlight = false;
    }
  }

  async function saveLayout() {
    if (!projectId || !lastCanvas) return;
    const nodes = {};
    for (const n of lastCanvas.nodes || []) {
      nodes[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h, r: n.r || 0, locked: !!n.locked };
    }
    const r = await api(`/api/model/projects/${projectId}/graph`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes })
    });
    layoutDirty = false;
    setSavePill("saved");
    logEvent(`Layout saved (model v${r.modelVersion})`, "ok");
    await refreshProject();
  }

  function fitNodes(nodes) {
    if (!nodes?.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 160));
      maxY = Math.max(maxY, n.y + (n.h || 90));
    }
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const bw = Math.max(80, maxX - minX + 80);
    const bh = Math.max(80, maxY - minY + 80);
    scale = Math.min(1.8, Math.max(0.3, Math.min(vw / bw, vh / bh) * 0.9));
    panX = (vw - bw * scale) / 2 - minX * scale + 20;
    panY = (vh - bh * scale) / 2 - minY * scale + 20;
    applyTransform();
    if (lastCanvas) updateCanvasMeta(lastCanvas);
  }

  function fitView() {
    fitNodes(lastCanvas?.nodes || []);
  }

  function zoomToSelection() {
    const nodes = (lastCanvas?.nodes || []).filter((n) => selectedIds.has(n.id));
    fitNodes(nodes.length ? nodes : lastCanvas?.nodes || []);
  }

  async function duplicateEquipment(node) {
    if (!projectId || !node) return;
    const before = captureLayout();
    const tagBase = String(node.tag || node.type || "EQ").replace(/-\d+$/, "");
    const tag = `${tagBase}-${String(Date.now()).slice(-3)}`;
    const r = await api(`/api/model/projects/${projectId}/equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag,
        type: node.type,
        description: `Duplicate of ${node.tag}`,
        dataClass: "ENGINEERING_INFERENCE",
        initialState: node.operatingState || "stopped",
        properties: node.properties || undefined
      })
    });
    const eq = r.equipment;
    const x = snapVal((node.x || 0) + 40);
    const y = snapVal((node.y || 0) + 40);
    await api(`/api/model/projects/${projectId}/graph`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: { [eq.id]: { x, y, w: node.w || 140, h: node.h || 80 } } })
    });
    if (before) pushUndo(before);
    logEvent(`Duplicated ${node.tag} → ${eq.tag}`, "ok");
    await syncRuntime("duplicate");
    setSelection([eq.id], eq.id);
    renderInspector();
  }

  async function sendCommand(tag, value, pulse) {
    try {
      if (pulse) {
        await api("/api/runtime/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag, value: true })
        });
        setTimeout(() => {
          api("/api/runtime/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tag, value: false })
          }).catch(() => {});
        }, 250);
      } else {
        await api("/api/runtime/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag, value })
        });
      }
      logEvent(`CMD OK ${tag}=${pulse ? "pulse" : value}`, "ok");
      await refreshCanvas();
      await refreshStatus();
      if (selected) {
        selected = lastCanvas?.nodes?.find((n) => n.id === selected.id) || selected;
        renderInspector();
      }
    } catch (e) {
      const reasons = e.data?.reasons || [];
      logEvent(`CMD REJECTED ${tag}: ${reasons.join(" | ") || e.message}`, "alarm");
      renderInspector(reasons);
    }
  }

  function signalCommands(node) {
    const live = node.live || {};
    const tags = Object.keys(live);
    const cmds = [];
    if (/pump|motor/i.test(node.type) || tags.some((t) => /RunCommand/i.test(t))) {
      cmds.push({ label: "Show start / Start transfer", tag: "System.Start", pulse: true });
      cmds.push({ label: "Reset trip", tag: "System.Reset", pulse: true });
      const run = tags.find((t) => /RunCommand/i.test(t));
      if (run) cmds.push({ label: "Run command", tag: run, pulse: true });
    }
    if (/valve/i.test(node.type)) {
      const open = tags.find((t) => /OpenCommand/i.test(t));
      if (open) {
        cmds.push({ label: "Open", tag: open, value: true });
        cmds.push({ label: "Close", tag: open, value: false });
      }
    }
    if (/estop|emergency|esd/i.test(node.type) || tags.some((t) => /ESTOP|ESD/i.test(t))) {
      const healthy = tags.find((t) => /Healthy/i.test(t)) || "ESD-101.Healthy";
      cmds.push({ label: "Activate E-stop (sim)", tag: healthy, value: false });
      cmds.push({ label: "Clear E-stop (sim)", tag: healthy, value: true });
      cmds.push({ label: "Reset trip", tag: "System.Reset", pulse: true });
    }
    if (/level|lsh|transmitter/i.test(node.type)) {
      const high = tags.find((t) => /High/i.test(t));
      if (high) {
        cmds.push({ label: "Force high", tag: high, value: true });
        cmds.push({ label: "Clear high", tag: high, value: false });
      }
    }
    return cmds;
  }

  function renderInspector(rejectReasons) {
    const title = document.getElementById("inspTitle");
    const sub = document.getElementById("inspSub");
    const body = document.getElementById("inspBody");
    if (!selected) {
      title.textContent = "Select equipment";
      sub.textContent = "Click a node on the map";
      body.innerHTML = `<p class="muted">No selection.</p>`;
      return;
    }
    // refresh selected live from canvas
    selected = lastCanvas?.nodes?.find((n) => n.id === selected.id) || selected;
    title.textContent = selected.tag;
    sub.textContent = `${selected.type} · ${selected.operatingState || "—"}`;
    const live = selected.live || {};
    const rejectHtml = rejectReasons?.length
      ? `<p class="warn"><b>${esc(rejectReasons.join(" · "))}</b></p>`
      : "";

    if (inspTab === "overview") {
      const props = selected.properties || {};
      const typeOpts = LIB_TYPES.map((t) =>
        `<option value="${esc(t.type)}" ${selected.type === t.type ? "selected" : ""}>${esc(t.label)}</option>`
      ).join("");
      const tankForm = /tank/i.test(selected.type)
        ? `<div class="propGrid">
            <label>Height (m)<input type="number" step="0.1" id="propH" value="${esc(props.heightM ?? 3)}" /></label>
            <label>Diameter (m)<input type="number" step="0.1" id="propD" value="${esc(props.diameterM ?? 2)}" /></label>
            <label>Initial level %<input type="number" step="1" id="propLvl" value="${esc(props.initialLevelPct ?? 50)}" /></label>
            <label>High alarm %<input type="number" step="1" id="propHi" value="${esc(props.highAlarmPct ?? 90)}" /></label>
          </div>
          <p class="muted">Capacity (calc): <b id="propCap">${esc(props.capacityM3 ?? "—")}</b> m³ · visual size ≠ engineering size</p>
          <button type="button" id="btnSaveProps">Save tank properties</button>`
        : "";
      body.innerHTML = `${rejectHtml}
        <div class="propGrid">
          <label>Tag<input type="text" id="propTag" value="${esc(selected.tag)}" /></label>
          <label>Type<select id="propType">${typeOpts}<option value="${esc(selected.type)}">${esc(selected.type)}</option></select></label>
        </div>
        <div class="cmdRow">
          <button type="button" id="btnSaveIdentity">Save tag / type</button>
          <button type="button" id="btnApproveEq">Mark approved</button>
          <button type="button" id="btnDeleteEq">Delete</button>
        </div>
        ${tankForm}
        <pre>${esc(JSON.stringify({
        tag: selected.tag, type: selected.type, dataClass: selected.dataClass, operatingState: selected.operatingState, properties: props, live
      }, null, 2))}</pre>
        <p class="warn">Edits update the canonical model and rebind Runtime automatically. Simulated controls only — not certified physical safety.</p>`;
      document.getElementById("btnSaveIdentity").onclick = () => {
        reworkEquipment(selected, {
          tag: document.getElementById("propTag").value,
          type: document.getElementById("propType").value
        }).catch((e) => logEvent(e.message, "alarm"));
      };
      document.getElementById("btnApproveEq").onclick = () => {
        reworkEquipment(selected, { dataClass: "ENGINEER_APPROVED" }).catch((e) => logEvent(e.message, "alarm"));
      };
      document.getElementById("btnDeleteEq").onclick = () => {
        deleteEquipment(selected).catch((e) => logEvent(e.message, "alarm"));
      };
      const saveBtn = document.getElementById("btnSaveProps");
      if (saveBtn) {
        saveBtn.onclick = async () => {
          const heightM = Number(document.getElementById("propH").value);
          const diameterM = Number(document.getElementById("propD").value);
          const initialLevelPct = Number(document.getElementById("propLvl").value);
          const highAlarmPct = Number(document.getElementById("propHi").value);
          await reworkEquipment(selected, {
            properties: { heightM, diameterM, initialLevelPct, highAlarmPct }
          });
        };
      }
    } else if (inspTab === "xray") {
      if (!xrayData || xrayData.equipment?.id !== selected.id) {
        body.innerHTML = `${rejectHtml}<p class="muted">Loading X-Ray…</p>`;
        loadXray(selected).then(() => {
          renderCanvas(lastCanvas);
          renderXrayPanel(body, rejectHtml);
        });
      } else {
        renderXrayPanel(body, rejectHtml);
      }
    } else if (inspTab === "io") {
      body.innerHTML = `${rejectHtml}<pre>${esc(JSON.stringify(live, null, 2))}</pre>`;
    } else if (inspTab === "alarms") {
      const alarms = [];
      if (Object.entries(live).some(([k, v]) => /Healthy/i.test(k) && v === false)) alarms.push("E-STOP ACTIVE (sim)");
      if (Object.entries(live).some(([k, v]) => /Fault/i.test(k) && v === true)) alarms.push("FAULT");
      if (Object.entries(live).some(([k, v]) => /High/i.test(k) && v === true)) alarms.push("LEVEL HIGH");
      if (lastCanvas?.mem?.M1) alarms.push("TRIP LATCH M1");
      body.innerHTML = `${rejectHtml}<pre>${esc(alarms.length ? alarms.join("\n") : "No active alarms")}</pre>`;
    } else {
      const cmds = signalCommands(selected);
      body.innerHTML = `${rejectHtml}
        <div class="cmdRow">${cmds.map((c, i) => `<button type="button" data-cmd="${i}">${esc(c.label)}</button>`).join("") || "<span class='muted'>No commands</span>"}</div>
        <pre>${esc(JSON.stringify(live, null, 2))}</pre>
        <p class="warn">Commands use POST /api/runtime/command with permissive checks.</p>`;
      body.querySelectorAll("[data-cmd]").forEach((btn) => {
        btn.onclick = () => {
          const c = cmds[Number(btn.dataset.cmd)];
          if (c) sendCommand(c.tag, c.value, !!c.pulse);
        };
      });
    }
  }

  const timelineRecords = [];
  const TIMELINE_MAX = 200;

  function appendTimeline(ev) {
    const rec = {
      id: ev.id || `${ev.scanCount}:${ev.type}:${timelineRecords.length}`,
      type: ev.type || "event",
      message: ev.message || ev.detail?.message || ev.type || "",
      simTimeMs: ev.simTimeMs ?? ev.detail?.simTimeMs,
      scanCount: ev.scanCount,
      wallTime: ev.wallTime || new Date().toISOString(),
      alarm: /fault|trip|estop|reject|alarm/i.test(String(ev.type || "") + String(ev.message || ""))
    };
    timelineRecords.push(rec);
    if (timelineRecords.length > TIMELINE_MAX) timelineRecords.splice(0, timelineRecords.length - TIMELINE_MAX);
    const scrub = document.getElementById("timelineScrub");
    if (scrub) {
      scrub.max = String(Math.max(0, timelineRecords.length - 1));
      scrub.value = scrub.max;
      renderTimelineAt(timelineRecords.length - 1);
    }
    // Process alarms are mirrored into Alarms via logEvent(..., "alarm") — avoid double-post here.
  }

  function renderTimelineAt(idx) {
    const meta = document.getElementById("timelineMeta");
    const log = document.getElementById("timelineLog");
    if (!meta || !log) return;
    if (!timelineRecords.length) {
      meta.textContent = "No recorded events yet — run the simulation.";
      log.innerHTML = "";
      return;
    }
    const i = Math.max(0, Math.min(timelineRecords.length - 1, Number(idx) || 0));
    const cur = timelineRecords[i];
    meta.textContent = `#${i + 1}/${timelineRecords.length} · scan ${cur.scanCount ?? "—"} · sim ${cur.simTimeMs ?? "—"}ms · ${cur.type}`;
    log.innerHTML = timelineRecords
      .slice(0, i + 1)
      .slice(-40)
      .reverse()
      .map((r) => `<div class="ev ${r.alarm ? "alarm" : ""}"><span class="ts">${esc(String(r.scanCount ?? ""))}</span> ${esc(r.message || r.type)}</div>`)
      .join("");
  }

  async function refreshEvents() {
    try {
      const d = await api("/api/runtime/events?limit=40");
      const events = d.events || [];
      for (const ev of events.slice().reverse()) {
        const id = ev.id || ev.scanCount + ":" + ev.message + ":" + ev.type;
        if (lastEventIds.has(id)) continue;
        lastEventIds.add(id);
        const msg = ev.message || ev.type || JSON.stringify(ev);
        logEvent(msg, /fault|trip|estop|reject/i.test(String(msg)) ? "alarm" : "");
        appendTimeline(ev);
      }
    } catch (_) { /* optional */ }
  }

  async function runFat() {
    logEvent("P6 Verify: running P101_ESTOP_SHUTDOWN…");
    const verifyLog = document.getElementById("verifyLog");
    try {
      const r = await api("/api/verify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const pass = !!(r.pass || r.result?.pass);
      const line = `FAT ${pass ? "PASS" : "FAIL"} — ${r.testId || r.result?.testId || "P101_ESTOP_SHUTDOWN"}`;
      logEvent(line, pass ? "ok" : "alarm");
      if (verifyLog) {
        const row = document.createElement("div");
        row.className = "ev " + (pass ? "ok" : "alarm");
        row.textContent = line;
        verifyLog.prepend(row);
      }
      if (r.assertions || r.result?.assertions) {
        logEvent(JSON.stringify(r.assertions || r.result.assertions));
      }
    } catch (e) {
      logEvent("FAT error: " + e.message, "alarm");
      if (verifyLog) {
        const row = document.createElement("div");
        row.className = "ev alarm";
        row.textContent = "FAT error: " + e.message;
        verifyLog.prepend(row);
      }
    }
  }

  async function refreshConnect() {
    const [opc, mqtt, eng] = await Promise.all([
      api("/api/connect/opcua"),
      api("/api/connect/mqtt"),
      api("/api/connect/engineering/status")
    ]);
    document.getElementById("connectOut").textContent = JSON.stringify({ opcua: opc, mqtt, engineering: eng }, null, 2);
  }

  function setView(v) {
    view = v;
    const map = view === "map";
    const connect = view === "connect";
    document.getElementById("viewTitle").textContent = map ? "Engineering map" : connect ? "P6 Connect" : "Tool";
    connectPanel.classList.toggle("hidden", !connect);
    viewport.style.display = map ? "" : "none";
    if (map || connect) {
      closeEmbed();
      closeIngestPanel();
    }
    document.querySelectorAll(".navItem[data-view]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-view") === v);
    });
    if (connect) refreshConnect().catch((e) => logEvent(String(e.message), "alarm"));
  }

  function openEmbed(url, title) {
    if (!toolPanel || !toolFrame || !url) return;
    closeIngestPanel();
    view = "tool";
    connectPanel.classList.add("hidden");
    viewport.style.display = "none";
    toolPanel.classList.remove("hidden");
    document.getElementById("toolTitle").textContent = title || "Tool";
    document.getElementById("viewTitle").textContent = title || "Tool";
    const ext = document.getElementById("toolOpenExt");
    if (ext) ext.href = url;
    // Cache-bust lightly so embedded tools see fresh model after Studio edits
    const sep = url.includes("?") ? "&" : "?";
    toolFrame.src = `${url}${sep}embed=1&t=${Date.now()}`;
    logEvent(`Opened ${title || url} (embedded)`, "ok");
  }

  function closeEmbed() {
    if (!toolPanel || !toolFrame) return;
    toolPanel.classList.add("hidden");
    if (toolFrame.src && toolFrame.src !== "about:blank") toolFrame.src = "about:blank";
    if (view === "tool") {
      view = "map";
      viewport.style.display = "";
      document.getElementById("viewTitle").textContent = "Engineering map";
    }
  }

  function setPlayback(on) {
    playbackMode = !!on;
    studio.classList.toggle("playback", playbackMode);
    const pill = document.getElementById("playbackPill");
    if (pill) pill.classList.toggle("hidden", !playbackMode);
    if (!playbackMode) {
      refreshCanvas().catch(() => {});
    }
  }

  async function refreshHistoryMeta() {
    const d = await api("/api/runtime/history");
    historyMeta = d;
    const scrub = document.getElementById("timelineScrub");
    if (scrub && d.count > 0) {
      const max = Math.max(0, d.count - 1);
      scrub.max = String(max);
      if (!playbackMode) scrub.value = String(max);
      const meta = document.getElementById("timelineMeta");
      if (meta && !playbackMode) {
        meta.textContent =
          `${d.count} frames · scans ${d.oldestScan ?? "—"}–${d.newestScan ?? "—"} · ${d.recording ? "recording" : "paused"}` +
          ` · scrub = signal overlay (not physics rewind)`;
      }
    }
    return d;
  }

  async function applyHistoryFrame(index) {
    const d = await api(`/api/runtime/history?frame=${encodeURIComponent(index)}`);
    const frame = d.frame;
    if (!frame || !lastCanvas) return;
    setPlayback(true);
    for (const node of lastCanvas.nodes || []) {
      const live = { ...(node.live || {}) };
      for (const key of Object.keys(live)) {
        if (Object.prototype.hasOwnProperty.call(frame.signals, key)) live[key] = frame.signals[key];
      }
      // Also apply any new tags that belong to this equipment prefix
      for (const [tag, val] of Object.entries(frame.signals || {})) {
        if (tag.startsWith(node.tag + ".") || (node.signals || []).some((s) => s.tag === tag)) {
          live[tag] = val;
        }
      }
      node.live = live;
    }
    if (frame.mem) lastCanvas.mem = frame.mem;
    syncCanvas(lastCanvas);
    const meta = document.getElementById("timelineMeta");
    if (meta) {
      meta.textContent = `PLAYBACK #${frame.index + 1}/${d.count} · scan ${frame.scanCount} · sim ${frame.simTimeMs}ms`;
    }
    const log = document.getElementById("timelineLog");
    if (log) {
      const entries = Object.entries(frame.signals || {}).slice(0, 40);
      log.innerHTML = entries
        .map(([k, v]) => `<div class="ev"><span class="ts">${esc(k)}</span> ${esc(String(v))}</div>`)
        .join("");
    }
  }

  async function captureSignalSnapshot() {
    const d = await api("/api/runtime/signals");
    const out = {};
    for (const s of d.signals || []) out[s.tag] = s.currentValue;
    return out;
  }

  function diffSignalSnapshots(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const changes = [];
    for (const k of keys) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        changes.push({ tag: k, before: before[k], after: after[k] });
      }
    }
    return changes;
  }

  function reportScenarioDiff(name, changes) {
    const verifyLog = document.getElementById("verifyLog");
    const head = `Scenario ${name}: ${changes.length} signal change(s)`;
    logEvent(head, changes.length ? "ok" : "");
    if (verifyLog) {
      const row = document.createElement("div");
      row.className = "ev ok";
      row.innerHTML = `<b>${esc(head)}</b><br>${changes.slice(0, 12).map((c) =>
        `${esc(c.tag)}: ${esc(String(c.before))} → ${esc(String(c.after))}`
      ).join("<br>") || "<span class='muted'>No signal deltas</span>"}`;
      verifyLog.prepend(row);
    }
    document.querySelector('[data-actab="verify"]')?.click();
  }

  async function runScenario(name) {
    setPlayback(false);
    setWorkspaceMode("simulation");
    const cmd = (tag, value, pulse) => sendCommand(tag, value, !!pulse);
    try {
      const before = await captureSignalSnapshot();
      if (name === "normal_start") {
        await cmd("ESD-101.Healthy", true);
        await cmd("LT-101.High", false);
        await cmd("VALVE-101.OpenCommand", true);
        await new Promise((r) => setTimeout(r, 300));
        await cmd("System.Start", true, true);
        logEvent("Scenario: normal startup", "ok");
      } else if (name === "valve_close") {
        await cmd("VALVE-101.OpenCommand", false);
        logEvent("Scenario: valve closed", "ok");
      } else if (name === "pump_fault") {
        await api("/api/fault", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ var: "Q2", mode: "stuck", value: true })
        });
        logEvent("Scenario: pump fault injected (sim Q2)", "alarm");
      } else if (name === "high_level") {
        await cmd("LT-101.High", true);
        logEvent("Scenario: high level", "alarm");
      } else if (name === "estop") {
        await cmd("ESD-101.Healthy", false);
        logEvent("Scenario: E-stop activated (sim model only — not a certified physical safety function)", "alarm");
      } else if (name === "clear") {
        try { await api("/api/fault/Q2", { method: "DELETE" }); } catch (_) { /* ignore */ }
        try { await api("/api/fault/I1", { method: "DELETE" }); } catch (_) { /* ignore */ }
        await cmd("LT-101.High", false);
        await cmd("ESD-101.Healthy", true);
        await cmd("System.Reset", true, true);
        logEvent("Scenario: faults cleared / reset", "ok");
      }
      await new Promise((r) => setTimeout(r, 350));
      await refreshCanvas();
      const after = await captureSignalSnapshot();
      reportScenarioDiff(name, diffSignalSnapshots(before, after));
    } catch (e) {
      logEvent(`Scenario failed: ${e.message}`, "alarm");
    }
  }

  function toggleLockSelection() {
    if (!selectedIds.size || !lastCanvas) return;
    const before = captureLayout();
    const anyUnlocked = [...selectedIds].some((id) => {
      const n = lastCanvas.nodes.find((x) => x.id === id);
      return n && !n.locked;
    });
    for (const id of selectedIds) {
      const n = lastCanvas.nodes.find((x) => x.id === id);
      if (n) n.locked = anyUnlocked;
    }
    pushUndo(before);
    layoutDirty = true;
    setSavePill("dirty");
    patchSelectionStyles();
    logEvent(anyUnlocked ? "Equipment locked" : "Equipment unlocked", "ok");
  }

  function rotateSelection(delta) {
    if (!selectedIds.size || !lastCanvas) return;
    const before = captureLayout();
    for (const id of selectedIds) {
      const n = lastCanvas.nodes.find((x) => x.id === id);
      if (!n) continue;
      n.r = (((Number(n.r) || 0) + delta) % 360 + 360) % 360;
      const el = nodeEls.get(id);
      if (el) el.style.transform = n.r ? `rotate(${n.r}deg)` : "";
    }
    pushUndo(before);
    layoutDirty = true;
    setSavePill("dirty");
    redrawLinksOnly();
  }

  document.querySelectorAll("[data-rt]").forEach((btn) => {
    btn.onclick = async () => {
      const act = btn.getAttribute("data-rt");
      try {
        await api(`/api/runtime/${act}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        logEvent(`Runtime ${act}`, "ok");
        await refreshStatus();
        await refreshCanvas();
      } catch (e) {
        logEvent(`Runtime ${act} failed: ${e.message}`, "alarm");
      }
    };
  });

  document.getElementById("inspTabs").onclick = (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    inspTab = b.dataset.tab;
    [...document.getElementById("inspTabs").querySelectorAll("button")].forEach((x) => x.classList.toggle("active", x === b));
    if (inspTab === "xray" && selected) {
      xrayMode = true;
      studio.classList.add("xray-mode");
      loadXray(selected).then(() => {
        renderCanvas(lastCanvas);
        renderInspector();
      });
    } else {
      renderInspector();
    }
  };

  document.getElementById("btnToggleSide").onclick = () => studio.classList.toggle("collapsed-side");
  document.getElementById("btnToggleInsp").onclick = () => studio.classList.toggle("collapsed-insp");
  document.getElementById("btnToggleConsole").onclick = () => document.getElementById("console").classList.toggle("collapsed");
  document.getElementById("btnClearLog").onclick = () => {
    consoleLog.innerHTML = "";
    const a = document.getElementById("alarmLog");
    const v = document.getElementById("verifyLog");
    if (a) a.innerHTML = "";
    if (v) v.innerHTML = "";
    timelineRecords.length = 0;
    lastEventIds.clear();
    renderTimelineAt(0);
    // Double-tap honesty: unfinished capabilities stay in Alarms after Clear
    seedLimitAlarms();
    if (platformLimitsCache.length) {
      const row = document.createElement("div");
      row.className = "ev alarm";
      const ts = new Date().toISOString().slice(11, 23);
      row.innerHTML =
        `<span class="ts">${esc(ts)}</span> ` +
        `Cleared activity — re-posted ${platformLimitsCache.length} unfinished-capability LIMIT alarm(s)`;
      consoleLog.prepend(row);
    }
    updateAlarmsTabBadge();
  };
  document.querySelectorAll("[data-actab]").forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.getAttribute("data-actab");
      document.querySelectorAll("[data-actab]").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll("[data-panel]").forEach((p) => {
        p.classList.toggle("hidden", p.getAttribute("data-panel") !== tab);
      });
      document.getElementById("console")?.classList.remove("collapsed");
    };
  });
  document.getElementById("timelineScrub")?.addEventListener("input", (e) => {
    applyHistoryFrame(e.target.value).catch((err) => logEvent(err.message, "alarm"));
  });
  document.getElementById("btnLiveMode")?.addEventListener("click", () => {
    setPlayback(false);
    logEvent("Returned to live Runtime view", "ok");
  });
  document.getElementById("btnClearHistory")?.addEventListener("click", async () => {
    await api("/api/runtime/history/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setPlayback(false);
    await refreshHistoryMeta();
    logEvent("History cleared", "ok");
  });
  document.getElementById("chkRecord")?.addEventListener("change", async (e) => {
    await api("/api/runtime/history/recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recording: !!e.target.checked })
    });
    logEvent(`History recording ${e.target.checked ? "on" : "off"}`, "ok");
  });
  document.getElementById("btnCloseTool")?.addEventListener("click", () => {
    closeEmbed();
    setView("map");
  });
  document.querySelectorAll("[data-embed]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const url = el.getAttribute("data-embed");
      const title = el.getAttribute("data-embed-title") || url;
      openEmbed(url, title);
      if (el.hasAttribute("data-wf")) {
        activeWorkflow = el.getAttribute("data-wf");
        document.querySelectorAll("#workflowStrip button").forEach((b) =>
          b.classList.toggle("active", b.getAttribute("data-wf") === activeWorkflow)
        );
      }
    });
  });
  document.querySelectorAll("[data-scenario]").forEach((el) => {
    el.addEventListener("click", () => runScenario(el.getAttribute("data-scenario")));
  });
  document.querySelectorAll("#workflowStrip [data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      closeEmbed();
      setView(el.getAttribute("data-view") || "map");
      const mode = el.getAttribute("data-wsmode-set");
      if (mode) setWorkspaceMode(mode);
      activeWorkflow = el.getAttribute("data-wf");
      document.querySelectorAll("#workflowStrip button").forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-wf") === activeWorkflow)
      );
    });
  });
  document.getElementById("wfVerify")?.addEventListener("click", () => {
    activeWorkflow = "verify";
    document.querySelectorAll("#workflowStrip button").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-wf") === "verify")
    );
    runFat();
    document.querySelector('[data-actab="verify"]')?.click();
  });
  document.getElementById("selSimSpeed")?.addEventListener("change", async (e) => {
    const scanMs = Number(e.target.value);
    try {
      await api("/api/runtime/speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanMs })
      });
      logEvent(`Simulation pace → scan ${scanMs}ms`, "ok");
      await refreshStatus();
    } catch (err) {
      logEvent(`Speed change failed: ${err.message}`, "alarm");
    }
  });
  document.getElementById("btnSnapshot")?.addEventListener("click", async () => {
    try {
      const r = await api("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `studio-${new Date().toISOString().slice(0, 19)}` })
      });
      logEvent(`Snapshot saved ${r.snapshot?.id || ""}`, "ok");
      const verifyLog = document.getElementById("verifyLog");
      if (verifyLog) {
        const row = document.createElement("div");
        row.className = "ev ok";
        row.textContent = `Snapshot ${r.snapshot?.id || "ok"} · ${r.snapshot?.label || ""}`;
        verifyLog.prepend(row);
      }
    } catch (err) {
      logEvent(`Snapshot failed: ${err.message}`, "alarm");
    }
  });
  document.getElementById("btnSaveLayout").onclick = () => saveLayout().catch((e) => logEvent(e.message, "alarm"));
  document.getElementById("btnFit").onclick = fitView;
  document.getElementById("btnZoomSel").onclick = zoomToSelection;
  document.getElementById("btnUndo").onclick = undoLayout;
  document.getElementById("btnRedo").onclick = redoLayout;
  document.getElementById("btnZoomIn").onclick = () => {
    const rect = viewport.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const worldX = (mx - panX) / scale;
    const worldY = (my - panY) / scale;
    scale = Math.min(2.5, scale * 1.15);
    panX = mx - worldX * scale;
    panY = my - worldY * scale;
    applyTransform();
    if (lastCanvas) updateCanvasMeta(lastCanvas);
  };
  document.getElementById("btnZoomOut").onclick = () => {
    const rect = viewport.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const worldX = (mx - panX) / scale;
    const worldY = (my - panY) / scale;
    scale = Math.max(0.25, scale / 1.15);
    panX = mx - worldX * scale;
    panY = my - worldY * scale;
    applyTransform();
    if (lastCanvas) updateCanvasMeta(lastCanvas);
  };
  document.getElementById("chkSnap").onchange = (e) => { snapEnabled = !!e.target.checked; };
  document.getElementById("chkGuides").onchange = (e) => {
    guidesEnabled = !!e.target.checked;
    if (!guidesEnabled) clearGuides();
  };
  function wireLayer(id, key) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      layerVis[key] = !!e.target.checked;
      if (lastCanvas) syncCanvas(lastCanvas);
    });
  }
  wireLayer("chkLayerEq", "equipment");
  wireLayer("chkLayerInst", "instruments");
  wireLayer("chkLayerProc", "process");
  wireLayer("chkLayerSig", "signal");
  document.getElementById("minimap")?.addEventListener("pointerdown", (ev) => {
    if (!lastCanvas) return;
    const canvas = minimapCanvas;
    const rect = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * 2400;
    const my = ((ev.clientY - rect.top) / rect.height) * 1600;
    panX = viewport.clientWidth / 2 - mx * scale;
    panY = viewport.clientHeight / 2 - my * scale;
    applyTransform();
  });
  window.addEventListener("keydown", (ev) => {
    const tag = (ev.target && ev.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || ev.target?.isContentEditable) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
      ev.preventDefault();
      undoLayout();
      return;
    }
    if (mod && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) {
      ev.preventDefault();
      redoLayout();
      return;
    }
    if (mod && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      saveLayout().catch((e) => logEvent(e.message, "alarm"));
      return;
    }
    if (mod && ev.key.toLowerCase() === "d" && selected) {
      ev.preventDefault();
      duplicateEquipment(selected).catch((e) => logEvent(e.message, "alarm"));
      return;
    }
    if (ev.key === "f" || ev.key === "F") {
      ev.preventDefault();
      if (selectedIds.size) zoomToSelection();
      else fitView();
      return;
    }
    if (ev.key === "r" || ev.key === "R") {
      ev.preventDefault();
      rotateSelection(ev.shiftKey ? -90 : 90);
      return;
    }
    if (ev.key === "l" || ev.key === "L") {
      ev.preventDefault();
      toggleLockSelection();
      return;
    }
    if (ev.key === "Escape") {
      hideCtxMenu();
      setPlayback(false);
      closeEmbed();
      hideCtxMenu();
      selectedIds.clear();
      selected = null;
      selectedLinkId = null;
      patchSelectionStyles();
      renderInspector();
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && selectedLinkId) {
      ev.preventDefault();
      deleteConnection(selectedLinkId).catch((e) => logEvent(e.message, "alarm"));
      return;
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && selectedIds.size) {
      ev.preventDefault();
      const nodes = (lastCanvas?.nodes || []).filter((n) => selectedIds.has(n.id));
      (async () => {
        for (const n of nodes) await deleteEquipment(n);
      })().catch((e) => logEvent(e.message, "alarm"));
    }
  });
  updateUndoButtons();

  // —— In-Studio ingest (P&ID / docs) ——
  let ingestCandidates = [];
  let ingestLast = null;
  let ingestObjectUrl = null;
  let ingestSelected = -1;
  const ingestPanel = document.getElementById("ingestPanel");

  function openIngestPanel() {
    closeEmbed();
    connectPanel.classList.add("hidden");
    viewport.style.display = "none";
    if (toolPanel) toolPanel.classList.add("hidden");
    ingestPanel?.classList.remove("hidden");
    view = "ingest";
    document.getElementById("viewTitle").textContent = "Ingest";
    setWorkspaceMode("engineering");
    activeWorkflow = "upload";
    document.querySelectorAll("#workflowStrip button").forEach((b) =>
      b.classList.toggle("active", ["upload", "review", "map"].includes(b.getAttribute("data-wf")))
    );
  }

  function closeIngestPanel() {
    ingestPanel?.classList.add("hidden");
    if (view === "ingest") {
      view = "map";
      viewport.style.display = "";
      document.getElementById("viewTitle").textContent = "Engineering map";
    }
  }

  function renderIngestList() {
    const host = document.getElementById("ingestList");
    if (!host) return;
    host.innerHTML = ingestCandidates.map((c, i) => `
      <div class="ingestCand ${c.status || ""} ${i === ingestSelected ? "active" : ""}" data-i="${i}">
        <input type="checkbox" data-inc="${i}" ${c.include || c.status === "confirmed" ? "checked" : ""} ${c.status === "deleted" ? "disabled" : ""} />
        <input type="text" data-tag="${i}" value="${esc(c.tag)}" ${c.status === "deleted" ? "disabled" : ""} />
        <select data-type="${i}" ${c.status === "deleted" ? "disabled" : ""}>
          ${LIB_TYPES.map((t) => `<option value="${esc(t.type)}" ${c.type === t.type ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
          <option value="${esc(c.type || "equipment")}" ${!LIB_TYPES.some((t) => t.type === c.type) ? "selected" : ""}>${esc(c.type || "equipment")}</option>
        </select>
        <span class="muted">${esc(String(Math.round((c.confidence || 0) * 100)))}%</span>
      </div>`).join("") || `<p class="muted">No candidates yet — extract a document.</p>`;
    host.querySelectorAll(".ingestCand").forEach((row) => {
      row.onclick = (ev) => {
        if (ev.target.closest("input,select")) return;
        ingestSelected = Number(row.dataset.i);
        renderIngestList();
        const tag = ingestCandidates[ingestSelected]?.tag;
        const src = document.getElementById("ingestSource");
        const text = ingestLast?.extracted?.text || "";
        if (src && tag && text) {
          const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          src.innerHTML = esc(text).replace(re, (m) => `<mark>${m}</mark>`);
        }
      };
    });
    host.querySelectorAll("[data-inc]").forEach((el) => {
      el.onchange = () => {
        const i = Number(el.dataset.inc);
        ingestCandidates[i].include = el.checked;
        if (el.checked) ingestCandidates[i].status = "confirmed";
      };
    });
    host.querySelectorAll("[data-tag]").forEach((el) => {
      el.onchange = () => { ingestCandidates[Number(el.dataset.tag)].tag = el.value.trim().toUpperCase(); };
    });
    host.querySelectorAll("[data-type]").forEach((el) => {
      el.onchange = () => { ingestCandidates[Number(el.dataset.type)].type = el.value; };
    });
    const btn = document.getElementById("btnIngestPromote");
    if (btn) {
      btn.disabled = !ingestCandidates.some((c) => c.status !== "deleted" && (c.include || c.status === "confirmed"));
    }
  }

  document.getElementById("navIngest")?.addEventListener("click", openIngestPanel);
  document.getElementById("wfUpload")?.addEventListener("click", openIngestPanel);
  document.getElementById("wfReview")?.addEventListener("click", openIngestPanel);
  document.getElementById("wfMap")?.addEventListener("click", () => {
    document.getElementById("btnIngestPromote")?.click();
  });
  document.getElementById("btnCloseIngest")?.addEventListener("click", closeIngestPanel);

  document.getElementById("btnIngestExtract")?.addEventListener("click", async () => {
    const f = document.getElementById("ingestFile")?.files?.[0];
    if (!f) return logEvent("Choose a P&ID or document file first", "alarm");
    document.getElementById("ingestMeta").textContent = "Extracting…";
    document.getElementById("ingestWarn").textContent = "";
    if (ingestObjectUrl) URL.revokeObjectURL(ingestObjectUrl);
    const prev = document.getElementById("ingestPreview");
    if (/^image\//.test(f.type)) {
      ingestObjectUrl = URL.createObjectURL(f);
      prev.src = ingestObjectUrl;
      prev.hidden = false;
    } else {
      prev.removeAttribute("src");
      prev.hidden = true;
    }
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/ingest/ocr", { method: "POST", body: fd });
    ingestLast = await r.json();
    if (!ingestLast.ok && ingestLast.error) {
      document.getElementById("ingestWarn").textContent = ingestLast.error;
      logEvent("Extract failed: " + ingestLast.error, "alarm");
      return;
    }
    const ex = ingestLast.extracted || {};
    const isImage = /^image\//.test(f.type) || ex.engine === "tesseract.js" || ex.unfinished;
    document.getElementById("ingestMeta").textContent =
      `${f.name} · engine=${ex.engine || "?"} · conf=${ex.confidence != null ? Math.round(ex.confidence * 100) + "%" : "n/a"} · ${(ingestLast.candidates || []).length} tags` +
      (isImage ? " · image OCR unfinished" : "");
    const baseWarn =
      ex.warning ||
      "Candidates are UNVERIFIED until you confirm and promote. Runtime will rebind after promote.";
    document.getElementById("ingestWarn").textContent = isImage
      ? baseWarn
      : `${baseWarn} Prefer text/PDF/CSV for reliable tag mining.`;
    document.getElementById("ingestSource").textContent =
      ex.text ||
      (isImage
        ? "(LIMIT: No usable text from scanned image OCR — try a text export, searchable PDF, or equipment CSV.)"
        : "(No text extracted.)");
    ingestCandidates = (ingestLast.candidates || []).map((c) => ({
      ...c,
      status: "proposed",
      include: !isImage && (c.confidence || 0) >= 0.5
    }));
    ingestSelected = -1;
    renderIngestList();
    const n = ingestCandidates.length;
    if (isImage) {
      pushAlarm(
        n
          ? `Image OCR unfinished — ${n} candidate(s) are UNVERIFIED (prefer text/PDF/CSV)`
          : "Image OCR unfinished — no usable tags; use text/PDF/CSV or typed equipment list",
        { limit: true }
      );
    }
    const extractMsg = n
      ? `Extracted ${n} candidate tag(s)${isImage ? " (image OCR unfinished — review carefully)" : ""}`
      : isImage
        ? "Image OCR returned no tags (unfinished path) — use text/PDF/CSV"
        : "No candidate tags found";
    // Image LIMIT already posted to Alarms; avoid duplicate mirror via logEvent("alarm")
    logEvent(extractMsg, isImage ? "" : (n ? "ok" : "alarm"));
    activeWorkflow = "review";
  });

  document.getElementById("btnIngestSelectAll")?.addEventListener("click", () => {
    ingestCandidates.forEach((c) => {
      if (c.status === "deleted") return;
      c.include = true;
      c.status = "confirmed";
    });
    renderIngestList();
  });

  document.getElementById("btnIngestPromote")?.addEventListener("click", async () => {
    const selected = ingestCandidates.filter((c) => c.status !== "deleted" && (c.include || c.status === "confirmed"));
    if (!selected.length) return logEvent("Confirm at least one candidate", "alarm");
    const f = document.getElementById("ingestFile")?.files?.[0];
    try {
      const data = await api("/api/ingest/ocr/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-P6-Role": "engineer" },
        body: JSON.stringify({
          projectId,
          documentName: f?.name || "Studio ingest",
          format: f?.type || "unknown",
          placeOnCanvas: true,
          approveAll: !!document.getElementById("ingestApprove")?.checked,
          equipment: selected.map(({ tag, type }) => ({ tag, type }))
        })
      });
      projectId = data.project?.id || projectId;
      logEvent(
        `Promoted ${data.created?.equipment?.length || 0} equipment · Runtime rebound (${data.runtimeBound?.signalCount ?? "?"} signals)`,
        "ok"
      );
      closeIngestPanel();
      setWorkspaceMode("engineering");
      await refreshProject();
      await refreshCanvas();
      fitView();
      activeWorkflow = "configure";
      document.querySelectorAll("#workflowStrip button").forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-wf") === "configure")
      );
    } catch (e) {
      logEvent("Promote failed: " + e.message, "alarm");
    }
  });
  function renderLibrary(filter) {
    const host = document.getElementById("libList");
    if (!host) return;
    const q = String(filter || "").toLowerCase();
    host.innerHTML = LIB_TYPES.filter((t) => !q || t.type.includes(q) || t.label.toLowerCase().includes(q))
      .map((t) => `<button type="button" class="libItem" draggable="true" data-type="${esc(t.type)}">${esc(t.label)}</button>`)
      .join("");
    host.querySelectorAll(".libItem").forEach((btn) => {
      btn.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("application/p6-equipment-type", btn.dataset.type);
        ev.dataTransfer.effectAllowed = "copy";
      });
    });
  }

  async function dropEquipment(type, clientX, clientY) {
    if (!projectId) throw new Error("No active project");
    const before = captureLayout();
    const rect = viewport.getBoundingClientRect();
    const x = snapVal((clientX - rect.left - panX) / scale);
    const y = snapVal((clientY - rect.top - panY) / scale);
    const tagBase = type.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4) || "EQ";
    const tag = `${tagBase}-${String(Date.now()).slice(-3)}`;
    const r = await api(`/api/model/projects/${projectId}/equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag,
        type,
        description: `Added from library (${type})`,
        dataClass: "ENGINEERING_INFERENCE",
        initialState: /tank/i.test(type) ? "ready" : /valve/i.test(type) ? "closed" : "stopped",
        properties: /tank/i.test(type) ? { heightM: 3, diameterM: 2, capacityM3: 9.42, initialLevelPct: 50 } : undefined
      })
    });
    const eq = r.equipment;
    await api(`/api/model/projects/${projectId}/graph`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: { [eq.id]: { x, y, w: /tank/i.test(type) ? 160 : 140, h: /tank/i.test(type) ? 100 : 80 } } })
    });
    if (before) pushUndo(before);
    logEvent(`Library: added ${eq.tag} (${type})`, "ok");
    await syncRuntime("library add");
    setSelection([eq.id], eq.id);
    if (selected) renderInspector();
  }

  document.getElementById("libSearch")?.addEventListener("input", (e) => renderLibrary(e.target.value));
  renderLibrary("");
  viewport.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer?.types?.includes("application/p6-equipment-type")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    }
  });
  viewport.addEventListener("drop", (ev) => {
    const type = ev.dataTransfer.getData("application/p6-equipment-type");
    if (!type) return;
    ev.preventDefault();
    dropEquipment(type, ev.clientX, ev.clientY).catch((e) => logEvent(e.message, "alarm"));
  });

  function setConnectMode(on) {
    connectMode = !!on;
    connectFrom = null;
    studio.classList.toggle("connect-mode", connectMode);
    if (connectMode) {
      xrayMode = false;
      studio.classList.remove("xray-mode");
      document.getElementById("modeHint").textContent = "connect mode · click source then target";
    } else {
      document.getElementById("modeHint").textContent = "drag nodes · wheel zoom";
    }
  }

  function setXrayMode(on) {
    xrayMode = !!on;
    studio.classList.toggle("xray-mode", xrayMode);
    document.getElementById("btnXray").classList.toggle("active", xrayMode);
    if (xrayMode) {
      setConnectMode(false);
      if (workspaceMode !== "diagnostic") {
        document.getElementById("modeHint").textContent = "X-Ray · select equipment for root cause";
      }
      inspTab = "xray";
      [...document.getElementById("inspTabs").querySelectorAll("button")].forEach((x) =>
        x.classList.toggle("active", x.dataset.tab === "xray")
      );
      if (selected) {
        loadXray(selected).then(() => {
          syncCanvas(lastCanvas);
          renderInspector();
        });
      } else {
        xrayData = null;
        if (lastCanvas) syncCanvas(lastCanvas);
      }
    } else {
      xrayData = null;
      if (workspaceMode === "engineering") {
        document.getElementById("modeHint").textContent = "Engineering · place, connect, configure";
      } else if (workspaceMode === "simulation") {
        document.getElementById("modeHint").textContent = "Simulation · operate equipment · watch process";
      } else {
        document.getElementById("modeHint").textContent = "Diagnostic / X-Ray · select equipment";
      }
      if (lastCanvas) syncCanvas(lastCanvas);
    }
  }

  document.getElementById("btnConnectMode").onclick = () => setConnectMode(!connectMode);
  document.getElementById("btnXray").onclick = () => setXrayMode(!xrayMode);
  document.getElementById("btnVerify").onclick = runFat;
  document.getElementById("navVerify").onclick = runFat;
  const chkMotion = document.getElementById("chkMotion");
  if (chkMotion) {
    chkMotion.checked = motionEnabled;
    studio.classList.toggle("reduce-motion", !motionEnabled);
    chkMotion.onchange = (e) => {
      motionEnabled = !!e.target.checked;
      studio.classList.toggle("reduce-motion", !motionEnabled);
      if (motionEnabled && lastCanvas) scheduleVisualFrame();
      else if (lastCanvas) syncCanvas(lastCanvas);
    };
  }
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.onclick = () => setView(el.getAttribute("data-view"));
  });

  // —— Part 14 wizard ——
  const WIZARD_STEPS = [
    { id: 1, key: "project", label: "Project" },
    { id: 2, key: "documents", label: "Documents" },
    { id: 3, key: "review", label: "Review" },
    { id: 4, key: "configure", label: "Configure" },
    { id: 5, key: "map", label: "Map" },
    { id: 6, key: "simulate", label: "Simulate" },
    { id: 7, key: "verify", label: "Verify" }
  ];
  let wizardStep = 1;
  let wizardState = { completed: [], skipped: [], projectId: null };
  let wizardProject = null;

  function openWizard(step) {
    wizardStep = step || wizardState.step || 1;
    document.getElementById("wizardOverlay").classList.remove("hidden");
    renderWizard();
  }
  function closeWizard() {
    document.getElementById("wizardOverlay").classList.add("hidden");
  }

  async function persistWizard(patch) {
    wizardState = { ...wizardState, ...patch, step: wizardStep };
    if (!wizardState.projectId && !projectId) return;
    const id = wizardState.projectId || projectId;
    try {
      await api(`/api/model/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wizard: wizardState })
      });
    } catch (_) { /* non-fatal autosave */ }
  }

  function markStep(kind) {
    const completed = new Set(wizardState.completed || []);
    const skipped = new Set(wizardState.skipped || []);
    if (kind === "done") {
      completed.add(wizardStep);
      skipped.delete(wizardStep);
    } else if (kind === "skip") {
      skipped.add(wizardStep);
      completed.delete(wizardStep);
    }
    wizardState.completed = [...completed];
    wizardState.skipped = [...skipped];
  }

  function wizardLimitations() {
    const skips = wizardState.skipped || [];
    if (!skips.length) return "";
    return `<p class="hint">Skipped steps: ${skips.map((s) => WIZARD_STEPS.find((x) => x.id === s)?.label || s).join(", ")}. Model may be incomplete until resolved.</p>`;
  }

  async function loadWizardProject() {
    const d = await api("/api/model/projects/active");
    wizardProject = d.project;
    if (wizardProject) {
      projectId = wizardProject.id;
      wizardState.projectId = wizardProject.id;
      if (wizardProject.ui?.wizard) {
        wizardState = { ...wizardState, ...wizardProject.ui.wizard };
      }
    }
    return wizardProject;
  }

  function renderWizardChrome() {
    const ol = document.getElementById("wizardSteps");
    ol.innerHTML = WIZARD_STEPS.map((s) => {
      const done = (wizardState.completed || []).includes(s.id);
      const skipped = (wizardState.skipped || []).includes(s.id);
      const cls = s.id === wizardStep ? "active" : done ? "done" : skipped ? "skipped" : "";
      return `<li class="${cls}">${s.id}. ${esc(s.label)}</li>`;
    }).join("");
    document.getElementById("btnWizardBack").disabled = wizardStep <= 1;
    document.getElementById("btnWizardNext").textContent = wizardStep >= 7 ? "Finish" : "Continue";
  }

  async function renderWizard() {
    renderWizardChrome();
    const body = document.getElementById("wizardBody");
    await loadWizardProject().catch(() => null);
    const p = wizardProject;
    const eqCount = p?.equipment?.length || 0;
    const sigCount = p?.signals?.length || 0;
    const unresolvedIo = (p?.signals || []).filter((s) => !s.address).length;
    const docs = p?.documents?.length || 0;

    if (wizardStep === 1) {
      body.innerHTML = `
        <label for="wizName">Project name</label>
        <input type="text" id="wizName" value="${esc(p?.name && !p?.meta?.samplePlant ? p.name : "")}" placeholder="e.g. Site A Transfer Skid" />
        <label for="wizDesc">Description</label>
        <textarea id="wizDesc" placeholder="Short project description">${esc(p?.meta?.samplePlant ? "" : (p?.description || ""))}</textarea>
        <div class="btnRow">
          <button type="button" class="primary" id="wizCreate">Create / save project</button>
          <button type="button" id="wizLoadDemo">Load Part 13 sample plant</button>
        </div>
        <p class="hint">Creating a project writes the canonical model and sets it active. Sample plant is labeled sample/simulated.</p>
        ${wizardLimitations()}`;
      document.getElementById("wizCreate").onclick = async () => {
        const name = document.getElementById("wizName").value.trim();
        const description = document.getElementById("wizDesc").value.trim();
        if (!name) return logEvent("Wizard: name required", "alarm");
        let proj;
        if (p && !p.meta?.samplePlant && p.id === projectId) {
          const r = await api(`/api/model/projects/${p.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description })
          });
          proj = r.project;
        } else {
          const r = await api("/api/model/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description })
          });
          proj = r.project;
          await api("/api/model/projects/active", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: proj.id })
          });
        }
        await api("/api/runtime/bind", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: proj.id })
        });
        wizardState.projectId = proj.id;
        projectId = proj.id;
        markStep("done");
        await persistWizard({});
        await refreshProject();
        await refreshCanvas();
        logEvent(`Wizard: project ready ${proj.name}`, "ok");
        renderWizard();
      };
      document.getElementById("wizLoadDemo").onclick = async () => {
        const r = await api("/api/model/projects/seed/tank-transfer-demo", { method: "POST" });
        await api("/api/runtime/bind", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: r.project.id })
        });
        try {
          await api("/api/runtime/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        } catch (_) { /* reset optional if runtime busy */ }
        wizardState.projectId = r.project.id;
        markStep("done");
        await persistWizard({});
        await refreshProject();
        await refreshCanvas();
        fitView();
        logEvent("Wizard: Part 13 sample plant loaded", "ok");
        renderWizard();
      };
    } else if (wizardStep === 2) {
      body.innerHTML = `
        <p>Upload drawings and engineering data for extraction. OCR/promote uses the existing ingest pipeline.</p>
        <div class="statRow"><span class="stat">Documents on project: ${docs}</span></div>
        <div class="btnRow">
          <a class="linkish" href="/ingest.html" target="_blank" rel="noopener">Open Documents / OCR</a>
        </div>
        <p class="hint">You can skip this step to explore with an empty or sample model. Limitations remain visible.</p>
        ${wizardLimitations()}`;
    } else if (wizardStep === 3) {
      const list = (p?.equipment || []).slice(0, 40).map((e) => `<li>${esc(e.tag)} · ${esc(e.type)} · ${esc(e.dataClass)}</li>`).join("") || "<li>No equipment yet</li>";
      body.innerHTML = `
        <p>Approve equipment and relationships before simulation.</p>
        <div class="statRow">
          <span class="stat">Equipment: ${eqCount}</span>
          <span class="stat">Connections: ${(p?.connections || []).length}</span>
        </div>
        <ul class="plain">${list}</ul>
        <p class="${eqCount ? "okHint" : "hint"}">${eqCount ? "Equipment present — continue when reviewed." : "No equipment — skip or load sample / ingest first."}</p>
        ${wizardLimitations()}`;
    } else if (wizardStep === 4) {
      body.innerHTML = `
        <p>Resolve missing I/O, properties, and logic gaps.</p>
        <div class="statRow">
          <span class="stat">Signals: ${sigCount}</span>
          <span class="stat">Unresolved address: ${unresolvedIo}</span>
          <span class="stat">Interlocks: ${(p?.interlocks || []).length}</span>
        </div>
        <div class="btnRow"><a class="linkish" href="/monitor.html" target="_blank" rel="noopener">Open I/O mapping</a></div>
        <p class="${unresolvedIo ? "hint" : "okHint"}">${unresolvedIo ? `${unresolvedIo} signal(s) lack addresses — model limited until configured.` : "All current signals have addresses (or none defined)."}</p>
        ${wizardLimitations()}`;
    } else if (wizardStep === 5) {
      body.innerHTML = `
        <p>Open the interactive engineering graph. Layout autosaves to the canonical model.</p>
        <div class="statRow"><span class="stat">Nodes on canvas: ${(lastCanvas?.nodes || []).length || eqCount}</span></div>
        <div class="btnRow"><button type="button" class="primary" id="wizGoMap">Show map now</button></div>
        ${wizardLimitations()}`;
      document.getElementById("wizGoMap").onclick = () => {
        closeWizard();
        setView("map");
        fitView();
        logEvent("Wizard: map view", "ok");
      };
    } else if (wizardStep === 6) {
      body.innerHTML = `
        <p>Launch Runtime and interact with equipment on the map (valves, pump start permissives, ESD).</p>
        <div class="btnRow">
          <button type="button" class="primary" id="wizStartRt">Start runtime</button>
          <button type="button" id="wizResetRt">Reset</button>
        </div>
        <p class="hint">Simulated controls only — not certified physical safety.</p>
        ${wizardLimitations()}`;
      document.getElementById("wizStartRt").onclick = async () => {
        await api("/api/runtime/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        markStep("done");
        await persistWizard({});
        await refreshStatus();
        logEvent("Wizard: runtime started", "ok");
        renderWizard();
      };
      document.getElementById("wizResetRt").onclick = async () => {
        await api("/api/runtime/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        logEvent("Wizard: runtime reset", "ok");
      };
    } else {
      body.innerHTML = `
        <p>Execute verification tests and review evidence.</p>
        <div class="statRow"><span class="stat">Test cases: ${(p?.testCases || []).length}</span></div>
        <div class="btnRow">
          <button type="button" class="primary" id="wizFat">Run P101_ESTOP_SHUTDOWN</button>
          <a class="linkish" href="/verify.html" target="_blank" rel="noopener">Open P6 Verify</a>
        </div>
        ${wizardLimitations()}`;
      document.getElementById("wizFat").onclick = async () => {
        await runFat();
        markStep("done");
        await persistWizard({});
        renderWizard();
      };
    }
  }

  async function wizardAdvance(skip) {
    if (skip) markStep("skip");
    else markStep("done");
    await persistWizard({});
    if (wizardStep >= 7) {
      logEvent("Wizard finished — unresolved items remain marked if skipped", "ok");
      closeWizard();
      await refreshProject();
      await refreshCanvas();
      fitView();
      return;
    }
    wizardStep += 1;
    await persistWizard({});
    renderWizard();
  }

  document.getElementById("btnWizard").onclick = () => openWizard(1);
  document.getElementById("navWizard").onclick = () => openWizard(wizardState.step || 1);
  document.getElementById("btnWizardClose").onclick = closeWizard;
  document.getElementById("btnWizardBack").onclick = () => {
    if (wizardStep > 1) {
      wizardStep -= 1;
      renderWizard();
    }
  };
  document.getElementById("btnWizardSkip").onclick = () => wizardAdvance(true).catch((e) => logEvent(e.message, "alarm"));
  document.getElementById("btnWizardNext").onclick = () => wizardAdvance(false).catch((e) => logEvent(e.message, "alarm"));

  function setWorkspaceMode(mode) {
    const next = ["engineering", "simulation", "diagnostic"].includes(mode) ? mode : "simulation";
    workspaceMode = next;
    studio.classList.toggle("mode-engineering", next === "engineering");
    studio.classList.toggle("mode-simulation", next === "simulation");
    studio.classList.toggle("mode-diagnostic", next === "diagnostic");
    document.querySelectorAll("[data-wsmode]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-wsmode") === next);
    });
    if (next === "diagnostic") {
      document.getElementById("viewTitle").textContent = "Diagnostic map";
      setXrayMode(true);
    } else {
      if (xrayMode) setXrayMode(false);
      if (next === "engineering") {
        document.getElementById("modeHint").textContent = "Engineering · place, connect, configure";
        document.getElementById("viewTitle").textContent = "Engineering map";
      } else {
        document.getElementById("modeHint").textContent = "Simulation · operate equipment · watch process";
        document.getElementById("viewTitle").textContent = "Runtime map";
      }
      if (lastCanvas) syncCanvas(lastCanvas);
    }
  }

  document.querySelectorAll("[data-wsmode]").forEach((btn) => {
    btn.onclick = () => setWorkspaceMode(btn.getAttribute("data-wsmode"));
  });

  // Autosave layout after idle
  const autosaveTimer = setInterval(() => {
    if (layoutDirty) saveLayout().catch(() => {});
  }, 15000);

  const params = new URLSearchParams(location.search);
  async function boot() {
    applyTransform();
    setWorkspaceMode(params.get("mode") || "simulation");
    await refreshProject();
    await refreshStatus();
    await refreshCanvas();
    await loadPlatformLimits();
    fitView();
    logEvent("P6 Studio ready — incremental canvas sync (no full rebuild)", "ok");
    logEvent("Platform limits loaded in sidebar — unfinished paths stay labeled", "ok");
    if (params.get("demo") === "1") {
      await api("/api/runtime/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      logEvent("Sample plant: runtime started", "ok");
      await refreshStatus();
      await refreshCanvas();
    }
    if (params.get("wizard") === "1") openWizard(1);
  }

  boot().catch((e) => logEvent("Boot failed: " + e.message, "alarm"));

  // Separate poll from paint: Runtime fetch ~400ms; visuals via rAF
  const pollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshStatus();
    refreshCanvas().catch(() => {});
    refreshEvents();
  }, 400);

  window.addEventListener("beforeunload", () => {
    destroyed = true;
    clearInterval(pollTimer);
    clearInterval(autosaveTimer);
    if (rafId) cancelAnimationFrame(rafId);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && lastCanvas) scheduleVisualFrame();
  });
})();
