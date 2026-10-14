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
  /** When true, auto-fit (boot/resize/workspace) skips; explicit Fit buttons clear/override. */
  let userViewLocked = false;
  let interlocksData = null;
  let logicStatusCache = null;
  let selectedInterlockId = null;
  let ilkHighlightIds = new Set();
  let ilkHighlightActive = false;
  /** equipmentId -> "active" | "armed" — drives top-left interlock lock badge */
  let ilkCornerByEq = new Map();
  let ilkPollTick = 0;
  let selectedLinkId = null;
  let workspaceMode = "engineering"; // engineering | simulation | diagnostic (canvas behavior)
  let workspace = "design"; // design | engineer | simulate | verify
  /** P&ID schematic vs SCADA status — same equipment model */
  let symbolMode = "pid"; // pid | scada
  let showPorts = true;
  let symbolModeUserOverride = false;
  let dragLock = false; // prevent accidental moves when checked
  const DRAG_THRESHOLD_PX = 8;
  let clipboardNodes = null;
  let lastVerifyChip = "—";
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
  const toolPanel = document.getElementById("toolPanel"); // legacy — removed from shell
  const toolFrame = document.getElementById("toolFrame");
  const ioPanelPanel = document.getElementById("ioPanel");
  const verifyWorkspacePanel = document.getElementById("verifyWorkspacePanel");

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

  const LIB_CATEGORY_ORDER = [
    ["pumps", "Pumps", ["pump"]],
    ["tanks", "Tanks", ["tank", "vessel"]],
    ["motors", "Motors", ["motor"]],
    ["valves", "Valves", ["valve", "control_valve", "check_valve", "butterfly_valve"]],
    ["instrumentation", "Instrumentation", [
      "level_transmitter", "flow_transmitter", "pressure_transmitter", "temperature_transmitter",
      "level_switch", "pressure_switch"
    ]],
    ["process", "Process Equipment", ["mixer", "compressor", "blower", "heat_exchanger"]],
    ["electrical", "Electrical", ["motor"]],
    ["control", "Control Components", ["emergency_stop_input"]]
  ];
  function buildLibCategories() {
    const regTypes = (window.P6Symbols && typeof window.P6Symbols.libraryTypes === "function")
      ? window.P6Symbols.libraryTypes()
      : [];
    const byType = Object.fromEntries(regTypes.map((t) => [t.type, t]));
    if (!regTypes.length) {
      return [
        { id: "pumps", label: "Pumps", items: [{ type: "pump", label: "Centrifugal pump" }] },
        { id: "tanks", label: "Tanks", items: [{ type: "tank", label: "Storage tank" }] },
        { id: "motors", label: "Motors", items: [{ type: "motor", label: "Electric motor" }] },
        { id: "valves", label: "Valves", items: [{ type: "valve", label: "Isolation valve" }] },
        {
          id: "instrumentation",
          label: "Instrumentation",
          items: [
            { type: "level_transmitter", label: "Level transmitter" },
            { type: "pressure_transmitter", label: "Pressure transmitter" },
            { type: "flow_transmitter", label: "Flow transmitter" }
          ]
        },
        { id: "control", label: "Control Components", items: [{ type: "emergency_stop_input", label: "E-stop (sim)" }] }
      ];
    }
    const used = new Set();
    const cats = [];
    for (const [id, label, types] of LIB_CATEGORY_ORDER) {
      const items = [];
      for (const t of types) {
        if (used.has(t) || !byType[t]) continue;
        used.add(t);
        items.push({ type: byType[t].type, label: byType[t].label });
      }
      if (items.length) cats.push({ id, label, items });
    }
    const extras = regTypes.filter((t) => !used.has(t.type));
    if (extras.length) cats.push({ id: "other", label: "Other", items: extras.map((t) => ({ type: t.type, label: t.label })) });
    return cats;
  }
  const LIB_CATEGORIES = buildLibCategories();
  const LIB_TYPES = LIB_CATEGORIES.flatMap((c) => c.items).filter(
    (item, idx, arr) => arr.findIndex((x) => x.type === item.type) === idx
  );

  /** Cached from /api/readiness — also posted into Alarms for a second reminder. */
  let platformLimitsCache = [];
  /** CEM 2.0 — last engineering validation from /api/model/.../validation */
  let lastModelValidation = null;

  function updateAlarmsTabBadge() {
    const btn = document.querySelector('[data-actab="alarms"]');
    const alarmLog = document.getElementById("alarmLog");
    if (!btn || !alarmLog) return;
    const n = alarmLog.querySelectorAll(".ev").length;
    const limits = alarmLog.querySelectorAll(".ev.limit").length;
    btn.textContent = limits ? `Alarms · ${limits} limits` : (n ? `Alarms (${n})` : "Alarms");
    updateStatusChips();
  }

  function updateStatusChips() {
    const chipSave = document.getElementById("chipSave");
    const chipSim = document.getElementById("chipSim");
    const chipAlarms = document.getElementById("chipAlarms");
    const chipWarn = document.getElementById("chipWarn");
    const chipVerify = document.getElementById("chipVerify");
    const pillSave = document.getElementById("pillSave");
    const pillSim = document.getElementById("pillSim");
    const pillRun = document.getElementById("pillRun");
    if (chipSave && pillSave) {
      const dirty = /UNSAVED|dirty/i.test(pillSave.textContent || "") || pillSave.classList.contains("dirty");
      chipSave.textContent = dirty ? "Save · unsaved" : /SAVED/i.test(pillSave.textContent || "") ? "Save · saved" : "Save · —";
      chipSave.classList.toggle("dirty", dirty);
      chipSave.classList.toggle("ok", !dirty && /SAVED/i.test(pillSave.textContent || ""));
    }
    if (chipSim) {
      const simTxt = (pillSim?.textContent || pillRun?.textContent || "—").trim();
      chipSim.textContent = `Sim · ${simTxt}`;
      chipSim.classList.toggle("ok", /RUN|RUNNING|ACTIVE/i.test(simTxt));
      chipSim.classList.toggle("warn", /PAUSE|STOP|IDLE/i.test(simTxt));
    }
    const alarmLog = document.getElementById("alarmLog");
    const activeAlarms = alarmLog
      ? [...alarmLog.querySelectorAll(".ev.alarm")].filter((el) => !el.dataset.stickyLimit).length
      : 0;
    if (chipAlarms) {
      chipAlarms.textContent = `Alarms · ${activeAlarms}`;
      chipAlarms.classList.toggle("alarm", activeAlarms > 0);
    }
    const warnCount = (lastModelValidation?.issues || []).filter(
      (i) => i.severity === "warning" || i.severity === "error"
    ).length;
    if (chipWarn) {
      chipWarn.textContent = `Warnings · ${warnCount}`;
      chipWarn.classList.toggle("warn", warnCount > 0);
    }
    if (chipVerify) {
      chipVerify.textContent = `Verify · ${lastVerifyChip}`;
      chipVerify.classList.toggle("ok", /PASS/i.test(lastVerifyChip));
      chipVerify.classList.toggle("alarm", /FAIL/i.test(lastVerifyChip));
    }
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
    updateStatusChips();
  }

  /** Plain-language explanations for ordinary engineers (no raw reject codes). */
  function engineerExplain(tag, reasons, fallback) {
    const joined = (reasons || []).join(" · ");
    const src = `${tag || ""} ${joined} ${fallback || ""}`;
    if (/LEVEL HIGH|LSH|LT-10/i.test(src)) {
      return "Cannot start — destination tank level is above the high limit (high switch active). Clear the high level, then try again.";
    }
    if (/E-?STOP|ESD/i.test(src) && /ACTIVE|Healthy/i.test(src)) {
      return "Cannot start — emergency stop is active (simulation). Clear E-stop and reset the trip latch, then try again.";
    }
    if (/VALVE-101 NOT OPEN/i.test(src)) {
      return "Cannot start — isolation valve VALVE-101 is not open. Open the valve (or wait for open feedback), then start transfer.";
    }
    if (/XV-101 NOT OPEN/i.test(src)) {
      return "Cannot start — valve XV-101 is not open. Open the valve, then try again.";
    }
    if (/XV-102 NOT OPEN/i.test(src)) {
      return "Cannot start — valve XV-102 is not open. Open the valve, then try again.";
    }
    if (/NOT OPEN/i.test(src)) {
      return "Cannot start — a required valve is not open. Check valve commands and open feedback, then try again.";
    }
    if (joined) {
      return joined
        .replace(/START REJECTED\s*—?\s*/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    return fallback || "Command was rejected by Runtime permissives.";
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
      { label: "X-Ray / Why blocked?", action: () => { setSelection([node.id], node.id); setWorkspace("simulate", { xray: true }); } },
      { label: "Show Interlocks (inside)", action: () => { setSelection([node.id], node.id); openInterlocksPanel({ equipmentId: node.id }); } },
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
    const primary = ["overview", "control", "io", "interlocks"];
    [...document.getElementById("inspTabs").querySelectorAll("button")].forEach((x) =>
      x.classList.toggle("active", x.dataset.tab === inspTab)
    );
    document.querySelectorAll("#advEngineering [data-tab]").forEach((x) =>
      x.classList.toggle("active", x.dataset.tab === inspTab)
    );
    if (!primary.includes(inspTab)) {
      document.getElementById("advEngineering")?.setAttribute("open", "");
    }
  }

  function setSymbolMode(mode, { user = false, silent = false } = {}) {
    const next = mode === "scada" ? "scada" : "pid";
    if (user) symbolModeUserOverride = true;
    symbolMode = next;
    studio.dataset.symbolMode = next;
    studio.classList.toggle("symbol-scada", next === "scada");
    studio.classList.toggle("symbol-pid", next === "pid");
    const toggle = document.getElementById("symbolModeToggle");
    if (toggle) toggle.dataset.symbolMode = next;
    document.getElementById("btnSymPid")?.classList.toggle("active", next === "pid");
    document.getElementById("btnSymScada")?.classList.toggle("active", next === "scada");
    if (!silent && lastCanvas) {
      for (const [id, el] of nodeEls) {
        delete el.dataset.symKey;
        const n = lastCanvas.nodes?.find((x) => x.id === id);
        if (n) patchNodeEl(el, n);
      }
    }
  }

  function symbolSvg(type, running, valveState, live) {
    if (window.P6Symbols && typeof window.P6Symbols.renderSymbol === "function") {
      const liveObj = live && typeof live === "object" ? { ...live } : {};
      if (running && !Object.keys(liveObj).some((k) => /Running|Energize/i.test(k))) {
        liveObj.P6_Running = true;
      }
      if (valveState === "open") liveObj.OpenedFeedback = true;
      else if (valveState === "opening") liveObj.OpenCommand = true;
      return window.P6Symbols.renderSymbol(type, symbolMode, liveObj).html;
    }
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

  function syncPortAnchors(el, node) {
    let host = el.querySelector(".portAnchors");
    const show =
      showPorts &&
      (connectMode || selectedIds.has(node.id) || selected?.id === node.id || selectedLinkId);
    if (!window.P6Symbols?.portsFor) {
      if (host) host.remove();
      return;
    }
    const ports = window.P6Symbols.portsFor(node.type);
    if (!show || !ports.length) {
      if (host) host.hidden = true;
      return;
    }
    if (!host) {
      host = document.createElement("div");
      host.className = "portAnchors";
      el.appendChild(host);
    }
    host.hidden = false;
    const key = ports.map((p) => p.id).join(",");
    if (host.dataset.portKey !== key) {
      host.dataset.portKey = key;
      host.innerHTML = ports
        .map(
          (p) =>
            `<span class="portDot" data-port="${esc(p.id)}" data-kind="${esc((p.kinds || []).join(","))}" title="${esc(p.label || p.id)}" style="left:${(p.u || 0) * 100}%;top:${(p.v || 0) * 100}%"></span>`
        )
        .join("");
    }
  }

  /** Live-signal reason for the top-right "!" alarm badge (null = not in alarm). */
  function alarmBadgeReason(node) {
    const live = node.live || {};
    for (const [k, v] of Object.entries(live)) {
      if (/ESTOP/i.test(k) && v === false) {
        return `Alarm: ${k}=false — E-stop / trip input not healthy (sim).`;
      }
      if (/Healthy/i.test(k) && v === false) {
        return `Alarm: ${k}=false — equipment not healthy.`;
      }
      if (/Fault/i.test(k) && v === true) {
        return `Alarm: ${k}=true — fault active.`;
      }
    }
    return null;
  }

  function statusClass(node) {
    const live = node.live || {};
    const keys = Object.keys(live);
    if (alarmBadgeReason(node)) return "alarm";
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

  async function refreshModelValidation() {
    if (!projectId) return;
    try {
      const d = await api(`/api/model/projects/${projectId}/validation`);
      lastModelValidation = d.validation || null;
    } catch {
      lastModelValidation = null;
    }
  }

  async function refreshProjectList() {
    const host = document.getElementById("projectList");
    if (!host) return;
    try {
      const d = await api("/api/model/projects");
      const projects = d.projects || d || [];
      const list = Array.isArray(projects) ? projects : [];
      if (!list.length) {
        host.innerHTML = `<span class="muted">No projects yet — Import P&ID or New from scratch.</span>`;
        return;
      }
      host.innerHTML = list
        .map((p) => `<button type="button" data-pid="${esc(p.id)}">${esc(p.name || p.id)}${p.id === projectId ? " · active" : ""}</button>`)
        .join("");
      host.querySelectorAll("[data-pid]").forEach((btn) => {
        btn.onclick = async () => {
          try {
            if (layoutDirty && !confirm("You have unsaved layout changes. Open another project anyway?")) return;
            await api("/api/model/projects/active", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: btn.getAttribute("data-pid") })
            });
            projectId = btn.getAttribute("data-pid");
            await syncRuntime("project open");
            await refreshProjectList();
            fitViewSoon(2, { force: true });
            logEvent(`Opened project ${btn.textContent}`, "ok");
            setWorkspace("design");
            tryRestoreAutosave();
          } catch (e) {
            logEvent(e.message, "alarm");
          }
        };
      });
    } catch (e) {
      host.innerHTML = `<span class="warn">${esc(e.message)}</span>`;
    }
  }

  async function refreshProject() {
    const d = await api("/api/model/projects/active");
    const p = d.project;
    if (!p) throw new Error("No active project");
    projectId = p.id;
    document.getElementById("projectName").textContent = p.name || "Untitled";
    document.getElementById("projectMeta").textContent =
      `id=${p.id} · model v${p.modelVersion} · schema v${p.schemaVersion ?? "—"} · layout ${p.ui?.graph?.updatedAt ? "saved" : "default"}`;
    await refreshModelValidation();
  }

  async function refreshLogicStatus() {
    try {
      logicStatusCache = await api("/api/runtime/logic");
    } catch (_) {
      logicStatusCache = null;
    }
    // Avoid wiping inspector inputs while the engineer is typing
    const ae = document.activeElement;
    const typing = ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName || "");
    if (inspTab === "control" && selected && !typing) renderInspector();
    if (!selected && workspaceMode === "diagnostic" && !typing) renderInspectorEmptyLogic();
    if (workspace === "engineer" && view === "io") refreshIoPanel().catch(() => {});
  }

  function logicObservabilityHtml() {
    const L = logicStatusCache;
    if (!L?.ok) {
      return `<section class="logicObs"><h4>Runtime logic program</h4><p class="muted">Logic status unavailable — start Runtime.</p></section>`;
    }
    const st = L.staged
      ? `Staged deploy v${L.staged.version ?? "?"} (${esc(L.staged.note || "pending apply")})`
      : `Active program v${L.currentVersion ?? "default"}`;
    const rungs = L.program?.rungs?.length ?? L.program?.instructions?.length ?? (L.program ? Object.keys(L.program).length : 0);
    return `<section class="logicObs">
      <h4>Runtime logic program</h4>
      <p><b>${st}</b> · observability only — staged apply/rollback APIs unchanged.</p>
      <p class="muted">Program IR size hint: ${esc(String(rungs))} rung(s)/blocks · history ${esc(String(L.historyCount ?? 0))}</p>
      <details class="advDetails"><summary>Advanced (program IR excerpt)</summary><pre class="mono">${esc(JSON.stringify(L.program || {}, null, 2).slice(0, 2400))}${JSON.stringify(L.program || {}).length > 2400 ? "…" : ""}</pre></details>
    </section>`;
  }

  function renderInspectorEmptyLogic() {
    const title = document.getElementById("inspTitle");
    const sub = document.getElementById("inspSub");
    const body = document.getElementById("inspBody");
    if (selected || workspaceMode !== "diagnostic") return;
    title.textContent = "Diagnostics";
    sub.textContent = "Runtime logic · no equipment selected";
    body.innerHTML = `${logicObservabilityHtml()}<p class="muted">Select equipment for Control / X-Ray tabs.</p>`;
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
      const warn = document.getElementById("simBindWarn");
      if (warn) {
        const bound = s.boundProjectId || null;
        const mismatch = !!(projectId && bound && projectId !== bound);
        warn.hidden = !mismatch;
        warn.classList.toggle("visible", mismatch);
        warn.textContent = mismatch
          ? `Runtime bound to different project — click Sync or reopen project`
          : "";
        if (mismatch) warn.onclick = () => syncRuntime("bind mismatch").catch((e) => logEvent(e.message, "alarm"));
      }
      updateStatusChips();
    } catch (_) { /* ignore */ }
    if (workspaceMode === "diagnostic") refreshLogicStatus().catch(() => {});
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
    studio.classList.remove("collapsed-insp");
    if (xrayMode || inspTab === "xray" || workspaceMode === "diagnostic") {
      inspTab = "xray";
      syncInspTabs();
      loadXray(node).then(() => {
        patchSelectionStyles();
        renderInspector();
      });
    } else {
      // Prefer engineering edit surface when selecting on Design / Simulate canvas
      if (workspace === "design" && inspTab !== "overview" && inspTab !== "control") {
        inspTab = "overview";
        syncInspTabs();
      }
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
      <span class="ilkCorner" hidden title="Interlock" aria-label="Interlock">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path fill="currentColor" d="M8 1.5a2.75 2.75 0 0 0-2.75 2.75V6H4.5A1.5 1.5 0 0 0 3 7.5v5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 6h-.75V4.25A2.75 2.75 0 0 0 8 1.5zm1.25 4.5h-2.5V4.25a1.25 1.25 0 1 1 2.5 0V6zM8 9.25a.9.9 0 0 1 .9.9v1.2a.9.9 0 1 1-1.8 0v-1.2a.9.9 0 0 1 .9-.9z"/>
        </svg>
      </span>
      <span class="badge" hidden title="" aria-label="Alarm">!</span>
      <div class="tankFill" hidden></div>
      <div class="sym"></div>
      <h3></h3>
      <div class="type"></div>
      <div class="liveLine"></div>
      <div class="resizeHandle" data-resize="1" title="Resize"></div>`;
    el.querySelector(".ilkCorner")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const n = lastCanvas?.nodes?.find((x) => x.id === node.id);
      if (n) openInterlocksPanel({ equipmentId: n.id });
    });
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

  function ensureIlkCornerEl(el, node) {
    if (el.querySelector(".ilkCorner")) return;
    const corner = document.createElement("span");
    corner.className = "ilkCorner";
    corner.hidden = true;
    corner.title = "Interlock";
    corner.setAttribute("aria-label", "Interlock");
    corner.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path fill="currentColor" d="M8 1.5a2.75 2.75 0 0 0-2.75 2.75V6H4.5A1.5 1.5 0 0 0 3 7.5v5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 6h-.75V4.25A2.75 2.75 0 0 0 8 1.5zm1.25 4.5h-2.5V4.25a1.25 1.25 0 1 1 2.5 0V6zM8 9.25a.9.9 0 0 1 .9.9v1.2a.9.9 0 1 1-1.8 0v-1.2a.9.9 0 0 1 .9-.9z"/>
    </svg>`;
    corner.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const n = lastCanvas?.nodes?.find((x) => x.id === node.id);
      if (n) openInterlocksPanel({ equipmentId: n.id });
    });
    el.prepend(corner);
  }

  function patchNodeEl(el, node) {
    ensureIlkCornerEl(el, node);
    const st = statusClass(node);
    const w = node.w || 168;
    const h = node.h || 98;
    const xrayHit = (xrayMode || workspaceMode === "diagnostic") && (xrayData?.highlightEquipmentIds || []).includes(node.id);
    const ilkHit = ilkHighlightIds.has(node.id);
    const draggingThis = (drag && (drag.id === node.id || drag.ids?.includes(node.id))) || resize?.id === node.id;
    el.className =
      "eqNode " +
      st +
      (selectedIds.has(node.id) || selected?.id === node.id ? " selected" : "") +
      (xrayHit ? " xrayHit" : "") +
      (ilkHit ? (ilkHighlightActive ? " ilkHit" : " ilkHit clearHit") : "") +
      (workspaceMode === "engineering" ? " engMode" : "") +
      (symbolMode === "scada" ? " scadaSym" : " pidSym") +
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
    if (badge) {
      const reason = st === "alarm" ? alarmBadgeReason(node) : null;
      badge.hidden = !reason;
      badge.title = reason || "";
      badge.setAttribute("aria-label", reason || "Alarm");
    }
    const ilkCorner = el.querySelector(".ilkCorner");
    if (ilkCorner) {
      const mode = ilkCornerByEq.get(node.id); // "active" | "armed" | undefined
      if (mode) {
        ilkCorner.hidden = false;
        ilkCorner.classList.toggle("active", mode === "active");
        ilkCorner.classList.toggle("armed", mode === "armed");
        ilkCorner.title =
          mode === "active"
            ? "Interlock ACTIVE — equipment inhibited (sim). Click to see inside."
            : "Interlock armed — covered by model interlock (clear). Click to see inside.";
      } else {
        ilkCorner.hidden = true;
        ilkCorner.classList.remove("active", "armed");
      }
    }
    const isTank = /tank|vessel/i.test(node.type);
    const fill = el.querySelector(".tankFill");
    if (fill) {
      // SCADA tank SVG draws level; keep CSS fill only as P&ID fallback aid
      const useCssFill = isTank && symbolMode === "pid";
      fill.hidden = !useCssFill;
      if (useCssFill) {
        const target = tankLevelPct(node);
        if (!displayLevels.has(node.id)) displayLevels.set(node.id, target);
        const shown = displayLevels.get(node.id);
        fill.style.height = Math.max(4, Math.min(55, shown * 0.55)) + "%";
      }
    }
    const running = isActuallyRunning(node);
    const vState = /valve/i.test(node.type) ? valveVisualState(node) : "";
    const lvl = isTank ? Math.round(tankLevelPct(node)) : "";
    const sym = el.querySelector(".sym");
    const symKey = `${symbolMode}|${node.type}|${running}|${vState}|${st}|${lvl}`;
    if (sym && el.dataset.symKey !== symKey) {
      const liveForSym = { ...(node.live || {}) };
      if (isTank && liveForSym && !Object.keys(liveForSym).some((k) => /Level/i.test(k))) {
        liveForSym.LevelPct = tankLevelPct(node);
      }
      sym.innerHTML = symbolSvg(node.type, running, vState, liveForSym);
      el.dataset.symKey = symKey;
    }
    syncPortAnchors(el, node);
    const h3 = el.querySelector("h3");
    if (h3 && h3.textContent !== node.tag) h3.textContent = node.tag;
    const typeEl = el.querySelector(".type");
    const stateLabel = st === "alarm" ? "alarm" : running ? "running" : vState || st || "stopped";
    const typeName = String(node.type || "equipment");
    const typeHtml = `${esc(typeName)}<span class="st">${esc(stateLabel)}</span>`;
    if (typeEl && typeEl.dataset.full !== `${typeName}|${stateLabel}`) {
      typeEl.dataset.full = `${typeName}|${stateLabel}`;
      typeEl.innerHTML = typeHtml;
    }
    const liveEl = el.querySelector(".liveLine");
    const liveTxt = nodeLiveText(node);
    if (liveEl && liveEl.textContent !== liveTxt) liveEl.textContent = liveTxt;
    const tip = `${node.tag} · ${typeName} · ${stateLabel}${liveTxt ? ` · ${liveTxt}` : ""}`;
    if (el.title !== tip) el.title = tip;
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
    let x1 = a.x + (a.w || 140) / 2;
    let y1 = a.y + (a.h || 80) / 2;
    let x2 = b.x + (b.w || 140) / 2;
    let y2 = b.y + (b.h || 80) / 2;
    let invalid = !!link.invalid;
    if (window.P6Symbols?.linkEndpoints) {
      const ep = window.P6Symbols.linkEndpoints(link, a, b);
      x1 = ep.x1;
      y1 = ep.y1;
      x2 = ep.x2;
      y2 = ep.y2;
      invalid = !!ep.invalid || invalid;
    }
    path.setAttribute("d", orthoPath(x1, y1, x2, y2, link.waypoints));
    // Flow animation only when hydraulically supported (pump/motor actually running)
    const flowing = !invalid && (isActuallyRunning(a) || isActuallyRunning(b));
    const gpm = processFlowGpm(lastCanvas);
    const intensity = flowing ? Math.max(0.25, Math.min(1, gpm / 50)) : 0;
    const xrayLinks = new Set(xrayData?.highlightConnectionIds || []);
    const kind = String(link.type || "process").toLowerCase();
    let stroke = flowing ? `rgba(34,197,94,${0.45 + intensity * 0.5})` : "rgba(40,197,255,0.4)";
    if (invalid) stroke = "rgba(239,68,68,0.85)";
    else if (!flowing) {
      if (kind === "mechanical") stroke = "rgba(245,158,11,0.7)";
      else if (kind === "electrical") stroke = "rgba(250,204,21,0.75)";
      else if (kind === "signal" || kind === "instrument" || kind === "instrumentation" || kind === "control") {
        stroke = "rgba(168,85,247,0.65)";
      } else if (kind === "communication") stroke = "rgba(148,163,184,0.55)";
      else stroke = "rgba(40,197,255,0.55)"; // process
    }
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", flowing ? String(2 + intensity * 2.5) : invalid ? "2.5" : "2.5");
    if (invalid) path.setAttribute("stroke-dasharray", "6 4");
    else if (kind === "signal" || kind === "instrument" || kind === "control") path.setAttribute("stroke-dasharray", "4 3");
    else path.removeAttribute("stroke-dasharray");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (flowing && motionEnabled) {
      path.style.animationDuration = `${Math.max(0.45, 1.6 - intensity)}s`;
    } else {
      path.style.animationDuration = "";
    }
    path.classList.toggle("linkInvalid", invalid);
    path.dataset.connKind = kind;
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
      const connectionType = document.getElementById("connectKind")?.value || "process";
      let fromPortId = null;
      let toPortId = null;
      let invalid = false;
      if (window.P6Symbols?.pickPorts) {
        const pick = window.P6Symbols.pickPorts(connectFrom, node, connectionType);
        fromPortId = pick.fromPortId;
        toPortId = pick.toPortId;
        invalid = !pick.valid;
        if (invalid && pick.reason) logEvent(`Port warning: ${pick.reason}`, "alarm");
      }
      await api(`/api/model/projects/${projectId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromEquipmentId: connectFrom.id,
          toEquipmentId: node.id,
          connectionType,
          fromPortId,
          toPortId,
          invalid,
          description: `${connectFrom.tag} → ${node.tag} (${connectionType})`
        })
      });
      logEvent(
        `Connected ${connectFrom.tag} → ${node.tag}` +
          (fromPortId && toPortId ? ` · ${fromPortId}→${toPortId}` : "") +
          (invalid ? " · INVALID PORTS" : ""),
        invalid ? "alarm" : "ok"
      );
      connectFrom = null;
      document.getElementById("modeHint").textContent = "connect mode · click source then target";
      await syncRuntime("connection created");
    } catch (e) {
      logEvent(`Connect failed: ${e.message}`, "alarm");
      connectFrom = null;
    }
  }

  function fmtXrayValue(v) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function applyXrayHighlights(focusId) {
    const ids = xrayData?.highlightEquipmentIds || [];
    ilkHighlightIds = new Set(ids);
    if (focusId) ilkHighlightIds.add(focusId);
    ilkHighlightActive = ids.length > 0;
    if (lastCanvas) syncCanvas(lastCanvas);
  }

  function renderLiveSignalsTable(live) {
    const rows = Object.entries(live || {}).map(
      ([tag, val]) =>
        `<tr><td>${esc(tag)}</td><td class="liveVal">${esc(fmtLive(val))}</td></tr>`
    );
    return `<table class="ioTable"><thead><tr><th>Signal</th><th>Live value</th></tr></thead><tbody>${
      rows.length ? rows.join("") : `<tr><td colspan="2" class="muted">No live signals on this equipment</td></tr>`
    }</tbody></table>
      <details class="advDetails"><summary>Advanced (raw signal map)</summary><pre class="mono">${esc(JSON.stringify(live || {}, null, 2))}</pre></details>`;
  }

  function pathStepToCond(step) {
    if (!step) return null;
    const cond = (xrayData?.conditions || []).find((c) => c.id === step.conditionId);
    if (cond) return cond;
    return {
      label: step.label || step.role || step.step,
      signalTag: step.tag,
      equipmentId: step.equipmentId,
      equipmentTag: step.equipmentTag,
      status: step.status || step.step,
      blocking: !!step.blocking,
      interlockId: step.interlockId || null,
      rootCauseHint: step.rootCauseHint || step.detail || `Signal path · ${step.step} · ${step.tag}`,
      detail: step.detail || String(step.tag)
    };
  }

  async function loadXray(node) {
    if (!node) return null;
    try {
      xrayData = await api(`/api/runtime/xray?equipmentId=${encodeURIComponent(node.id)}`);
      if (xrayData?.ok) applyXrayHighlights(node.id);
      return xrayData;
    } catch (e) {
      xrayData = { ok: false, error: e.message, conditions: [], chain: [] };
      return xrayData;
    }
  }

  function findCanvasNodeByRoot(equipmentId, equipmentTag, signalTag) {
    const nodes = lastCanvas?.nodes || [];
    if (equipmentId) {
      const byId = nodes.find((n) => n.id === equipmentId);
      if (byId) return byId;
    }
    if (equipmentTag) {
      const byTag = nodes.find((n) => n.tag === equipmentTag);
      if (byTag) return byTag;
    }
    if (signalTag) {
      const prefix = String(signalTag).split(".")[0];
      return nodes.find((n) => n.tag === prefix) || null;
    }
    return null;
  }

  function applyXrayPathHighlight() {
    const ids = xrayData?.highlightEquipmentIds || [];
    if (!ids.length) return;
    ilkHighlightIds = new Set(ids);
    ilkHighlightActive = !!xrayData?.inhibited;
  }

  function enterDiagnosticWorkspace() {
    studio.classList.add("collapsed-side");
    studio.classList.remove("collapsed-insp");
    studio.classList.add("show-inspector");
    document.getElementById("console")?.classList.add("collapsed");
    // Refit after sidebar collapse retargets the grid so canvas keeps the 1fr track
    if (!userViewLocked) fitViewSoon(2);
  }

  function fitXraySelected() {
    userViewLocked = false;
    const nodes = (lastCanvas?.nodes || []).filter((n) => selectedIds.has(n.id) || n.id === selected?.id);
    fitNodes(nodes.length ? nodes : lastCanvas?.nodes || [], { force: true });
  }

  function fitXrayChain() {
    userViewLocked = false;
    const ids = new Set(xrayData?.highlightEquipmentIds || []);
    const nodes = (lastCanvas?.nodes || []).filter((n) => ids.has(n.id));
    fitNodes(nodes.length ? nodes : lastCanvas?.nodes || [], { force: true });
  }

  function fitXrayAll() {
    userViewLocked = false;
    fitNodes(lastCanvas?.nodes || [], { force: true });
  }

  /**
   * Whole-picture jump: condition/status click → canvas root cause (+ interlock inside when relevant).
   */
  async function goToXrayRootCause(cond, { openInterlock = true, fit = true } = {}) {
    if (!cond) return;
    const node = findCanvasNodeByRoot(cond.equipmentId, cond.equipmentTag, cond.signalTag);
    const hint = cond.rootCauseHint || cond.detail || cond.label;
    const liveVal =
      cond.value !== undefined && cond.value !== null
        ? typeof cond.value === "object"
          ? JSON.stringify(cond.value)
          : String(cond.value)
        : "";
    logEvent(
      `Root cause · ${cond.label || cond.step || "signal"}: ${cond.status || ""}` +
        (liveVal !== "" ? ` = ${liveVal}` : "") +
        ` — ${hint}`,
      cond.blocking ? "alarm" : "ok"
    );

    if (node) {
      setSelection([node.id], node.id);
      // Highlight full dependency path from X-Ray payload (not only the single root)
      applyXrayPathHighlight();
      if (!ilkHighlightIds.size) {
        ilkHighlightIds = new Set([node.id]);
        ilkHighlightActive = !!cond.blocking;
      }
      if (lastCanvas) syncCanvas(lastCanvas);
      if (fit && !userViewLocked) fitNodes([node]);
      studio.classList.add("show-inspector");
    }

    // Blocking ESD / high-level → open Interlocks inside for the whole picture
    if (openInterlock && cond.interlockId) {
      await openInterlocksPanel({ selectId: cond.interlockId });
      return;
    }
    if (openInterlock && cond.blocking && /esd|level_high/i.test(cond.id || cond.conditionId || "")) {
      await openInterlocksPanel({
        equipmentId: cond.equipmentId || node?.id,
        selectId: cond.interlockId || undefined
      });
      return;
    }

    // Stay in X-Ray on the root-cause equipment
    if (node) {
      setWorkspace("simulate", { xray: true });
      inspTab = "xray";
      syncInspTabs();
      await loadXray(node);
      applyXrayPathHighlight();
      if (lastCanvas) syncCanvas(lastCanvas);
      renderInspector();
    }
  }

  function renderXrayGroupList(items, key) {
    if (!items?.length) return `<li class="muted">None</li>`;
    return items
      .map((c, i) => {
        const st = String(c.status || "").replace(/\s+/g, "_");
        const val =
          c.value !== undefined && c.value !== null
            ? typeof c.value === "object"
              ? JSON.stringify(c.value)
              : String(c.value)
            : "";
        return `<li class="condJump ${c.blocking ? "isBlocking" : ""} ${c.status === "WARNING" ? "isWarning" : ""}"
            data-xray-item="${esc(key)}:${i}"
            title="${esc(c.rootCauseHint || c.detail || c.label || "")}">
          <span class="condLabel">${esc(c.label || c.name || "—")}${val !== "" ? ` · ${esc(val)}` : ""}</span>
          <button type="button" class="stLink st-${esc(st)}" data-xray-item="${esc(key)}:${i}">${esc(c.status || "—")} →</button>
        </li>`;
      })
      .join("");
  }

  function resolveXrayItem(key, index) {
    const groups = xrayData?.groups || {};
    if (key === "conditions") return (xrayData.conditions || [])[index];
    if (key === "path") return (xrayData.path || xrayData.chain || [])[index];
    if (key === "warnings") return (groups.warnings || [])[index];
    if (groups[key]) return groups[key][index];
    if (key === "interlocksRelated") {
      const ilk = (xrayData.interlocks || [])[index];
      if (!ilk) return null;
      return {
        label: ilk.name,
        interlockId: ilk.id,
        status: "RELATED",
        blocking: false,
        rootCauseHint: ilk.actionDescription || ilk.name,
        detail: ilk.actionDescription
      };
    }
    return null;
  }

  function renderXrayPanel(body, rejectHtml) {
    if (!xrayData || xrayData.ok === false) {
      body.innerHTML = `${rejectHtml}<p class="muted">${esc(xrayData?.error || "Select equipment and open X-Ray.")}</p>`;
      return;
    }
    const health = xrayData.health || {};
    const groups = xrayData.groups || {};
    const pathSteps = xrayData.path || xrayData.chain || [];
    const narrative = Array.isArray(xrayData.narrative)
      ? xrayData.narrative
      : xrayData.narrative
        ? [xrayData.narrative]
        : [];
    const verifyHints = xrayData.verifyHints || [];
    const stClass = (s) => String(s || "").replace(/\s+/g, "_");
    const stateChip = health.state || (xrayData.inhibited ? "INHIBITED" : xrayData.canStart ? "READY" : "—");
    const blocker = health.primaryBlocker || xrayData.primaryBlocker;
    const head = xrayData.inhibited
      ? `<div class="xrayBlock xrayRootLink" data-xray-item="conditions:${(xrayData.conditions || []).findIndex((c) => c.id === blocker?.id)}" title="Jump to root cause">
          <b>${esc(health.title || xrayData.title)}</b><br>${esc(blocker?.detail || "Inhibited")}
          <div class="rootCue">Click to jump to root cause →</div>
        </div>`
      : `<div class="xrayOk"><b>${esc(health.title || xrayData.title)}</b></div>`;

    const pathHtml = pathSteps
      .map((c, i) => {
        const st = stClass(c.status || c.step || c.role);
        const val =
          c.value !== undefined && c.value !== null
            ? typeof c.value === "object"
              ? JSON.stringify(c.value)
              : String(c.value)
            : "";
        return `<li class="xrayPathStep chainJump ${c.blocking ? "isBlocking" : ""} st-${esc(st)}" data-xray-item="path:${i}"
            title="${esc(c.rootCauseHint || c.detail || c.tag || "")}">
          <span class="xrayPathRole">${esc(c.role || c.step)}</span>
          <span class="xrayPathBody">
            <b>${esc(c.label || c.tag || c.step)}</b>
            <span class="muted">${esc(c.tag || "")}${val !== "" ? ` = ${esc(val)}` : ""}${c.address ? ` · ${esc(c.address)}` : ""}</span>
            ${c.status ? `<span class="stLink st-${esc(st)}">${esc(c.status)}</span>` : ""}
          </span>
        </li>`;
      })
      .join("");

    const verifyHtml = verifyHints.length
      ? `<div class="xrayVerify">
          <p><b>Verify</b> · real catalog only</p>
          <ul class="condList">${verifyHints
            .map(
              (t, i) => `<li>
              <span class="condLabel"><b>${esc(t.name || t.id)}</b><br><span class="muted">${esc(t.description || "")}</span></span>
              <button type="button" class="stLink" data-verify-run="${esc(t.id)}">Run FAT →</button>
            </li>`
            )
            .join("")}</ul>
          <div class="cmdRow">
            <button type="button" id="btnOpenVerifyPage">Open P6 Verify</button>
          </div>
        </div>`
      : `<div class="xrayVerify"><p class="muted">No matching Verify tests in catalog for this equipment.</p>
          <div class="cmdRow"><button type="button" id="btnOpenVerifyPage">Open P6 Verify</button></div></div>`;

    body.innerHTML = `${rejectHtml}
      <div class="xrayWorkspace">
        <div class="xrayToolbar cmdRow">
          <button type="button" id="btnRefreshXray">Refresh</button>
          <button type="button" id="btnXrayFitSel" title="Fit selected">Fit selected</button>
          <button type="button" id="btnXrayFitChain" title="Fit dependency chain">Fit chain</button>
          <button type="button" id="btnXrayFitAll" title="Fit all">Fit all</button>
        </div>
        <section class="xraySection">
          <h4 class="xraySectionTitle">Equipment Health</h4>
          <div class="xrayChips">
            <span class="xrayChip st-${esc(stClass(stateChip))}">${esc(stateChip)}</span>
            <span class="xrayChip">${esc(xrayData.equipment?.tag || "")} · ${esc(health.operatingState || xrayData.equipment?.operatingState || "—")}</span>
            <span class="xrayChip">${health.blockingCount ?? (xrayData.conditions || []).filter((c) => c.blocking).length} blocking</span>
            <span class="xrayChip">${health.clearCount ?? "—"} clear</span>
            ${(health.warningCount || 0) ? `<span class="xrayChip warnChip">${health.warningCount} warn</span>` : ""}
          </div>
          ${head}
        </section>
        <section class="xraySection">
          <h4 class="xraySectionTitle">Dashboard</h4>
          <div class="xrayDashGrid">
            <div><p class="xrayGroupLabel">Feedback</p><ul class="condList">${renderXrayGroupList(groups.feedback, "feedback")}</ul></div>
            <div><p class="xrayGroupLabel">Permissives</p><ul class="condList">${renderXrayGroupList(groups.permissives, "permissives")}</ul></div>
            <div><p class="xrayGroupLabel">Blockers</p><ul class="condList">${renderXrayGroupList(groups.blockers, "blockers")}</ul></div>
            <div><p class="xrayGroupLabel">Interlocks</p><ul class="condList">${renderXrayGroupList(groups.interlocks, "interlocks")}</ul></div>
            <div><p class="xrayGroupLabel">Warnings</p><ul class="condList">${renderXrayGroupList(groups.warnings, "warnings")}</ul></div>
          </div>
        </section>
        <section class="xraySection">
          <h4 class="xraySectionTitle">Signal Trace</h4>
          <p class="muted">Click a step to select equipment and highlight the dependency path.</p>
          <ol class="xrayPath">${pathHtml || "<li class='muted'>No path</li>"}</ol>
        </section>
        <section class="xraySection">
          <h4 class="xraySectionTitle">Diagnostic Explanation</h4>
          <div class="xrayNarrative">${narrative.map((p) => `<p>${esc(p)}</p>`).join("") || "<p class='muted'>No narrative</p>"}</div>
          <p class="warn">${esc(xrayData.note || "")}</p>
        </section>
        <section class="xraySection">
          <div class="cmdRow">
            <button type="button" id="btnFaultValve">Inject stuck valve (sim)</button>
            <button type="button" id="btnClearFaults">Clear faults</button>
            <button type="button" id="btnOpenIlkFromXray">Open Interlocks</button>
          </div>
          ${verifyHtml}
        </section>
        <details class="xrayAdvanced">
          <summary>Advanced signals</summary>
          <p class="muted">Raw equipment signals and related tags from the live runtime.</p>
          <pre class="xrayAdvPre">${esc(JSON.stringify({
            equipmentSignals: xrayData.equipmentSignals || [],
            related: xrayData.related || [],
            conditions: xrayData.conditions || []
          }, null, 2))}</pre>
        </details>
      </div>`;

    const jumpItem = (key, index) => {
      const item = resolveXrayItem(key, index);
      if (!item) return;
      if (item.interlockId && !item.equipmentId && !item.signalTag && key === "interlocks") {
        openInterlocksPanel({ selectId: item.interlockId });
        return;
      }
      goToXrayRootCause(
        {
          id: item.conditionId || item.id,
          conditionId: item.conditionId || item.id,
          label: item.label || item.role || item.step,
          signalTag: item.signalTag || item.tag,
          equipmentId: item.equipmentId,
          equipmentTag: item.equipmentTag,
          status: item.status,
          value: item.value,
          blocking: !!item.blocking,
          interlockId: item.interlockId,
          rootCauseHint: item.rootCauseHint || item.detail || item.label,
          detail: item.detail
        },
        { openInterlock: !!(item.interlockId && item.blocking) }
      ).catch((e) => logEvent(e.message, "alarm"));
    };

    body.querySelectorAll("[data-xray-item]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const raw = el.getAttribute("data-xray-item") || "";
        const colon = raw.lastIndexOf(":");
        if (colon < 0) return;
        jumpItem(raw.slice(0, colon), Number(raw.slice(colon + 1)));
      });
    });

    body.querySelectorAll("[data-verify-run]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const testId = btn.getAttribute("data-verify-run");
        runFat(testId).catch((e) => logEvent(e.message, "alarm"));
      });
    });
    document.getElementById("btnOpenVerifyPage")?.addEventListener("click", () => {
      setWorkspace("verify");
    });
    document.getElementById("btnOpenIlkFromXray")?.addEventListener("click", () => {
      setWorkspace("engineer", { openInterlocks: true, equipmentId: selected?.id });
    });
    document.getElementById("btnRefreshXray").onclick = async () => {
      if (selected) {
        await loadXray(selected);
        applyXrayPathHighlight();
        renderCanvas(lastCanvas);
        renderInspector();
      }
    };
    document.getElementById("btnXrayFitSel").onclick = () => fitXraySelected();
    document.getElementById("btnXrayFitChain").onclick = () => fitXrayChain();
    document.getElementById("btnXrayFitAll").onclick = () => fitXrayAll();
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
        applyXrayPathHighlight();
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
        applyXrayPathHighlight();
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
    if ((node.locked || dragLock) && ev.target?.dataset?.resize !== "1") {
      // Allow select/click but not drag when locked / drag-lock
      if (!selectedIds.has(node.id) && !(ev.ctrlKey || ev.metaKey)) {
        setSelection([node.id], node.id);
      } else if (!selectedIds.has(node.id)) {
        selectedIds.add(node.id);
        setSelection([...selectedIds], node.id);
      }
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
      if (dragLock || drag.locked) return;
      const rawDx = (ev.clientX - drag.startX) / scale;
      const rawDy = (ev.clientY - drag.startY) / scale;
      const distPx = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY);
      if (!drag.moved && distPx < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      let dx = rawDx;
      let dy = rawDy;
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
          el.dataset.dragged = "1";
        }
      }
      layoutDirty = true;
      setSavePill("dirty");
      redrawLinksOnly();
      scheduleMinimap();
      return;
    }
    if (panDrag) {
      const nx = panDrag.ox + (ev.clientX - panDrag.x);
      const ny = panDrag.oy + (ev.clientY - panDrag.y);
      if (Math.abs(nx - panX) > 1 || Math.abs(ny - panY) > 1) userViewLocked = true;
      panX = nx;
      panY = ny;
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
    userViewLocked = true;
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

  function autosaveKey() {
    return projectId ? `p6.studio.layout.${projectId}` : null;
  }

  function persistAutosaveDraft() {
    const key = autosaveKey();
    if (!key || !lastCanvas || !layoutDirty) return;
    try {
      const nodes = {};
      for (const n of lastCanvas.nodes || []) {
        nodes[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h, r: n.r || 0, locked: !!n.locked };
      }
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), nodes }));
    } catch (_) { /* quota */ }
  }

  function tryRestoreAutosave() {
    const key = autosaveKey();
    if (!key || !lastCanvas) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft?.nodes || Date.now() - (draft.at || 0) > 1000 * 60 * 60 * 24) {
        localStorage.removeItem(key);
        return;
      }
      const serverUpdated = Date.parse(lastCanvas.graphUpdatedAt || 0) || 0;
      if (serverUpdated && draft.at < serverUpdated) {
        localStorage.removeItem(key);
        return;
      }
      if (!confirm("Recover unsaved canvas layout from a previous session?")) {
        localStorage.removeItem(key);
        return;
      }
      const before = captureLayout();
      for (const n of lastCanvas.nodes || []) {
        const d = draft.nodes[n.id];
        if (!d) continue;
        n.x = d.x; n.y = d.y; n.w = d.w; n.h = d.h; n.r = d.r; n.locked = !!d.locked;
      }
      if (before) pushUndo(before);
      layoutDirty = true;
      setSavePill("dirty");
      syncCanvas(lastCanvas);
      logEvent("Recovered unsaved layout draft — Save to persist", "ok");
    } catch (_) { /* ignore */ }
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
    try {
      const key = autosaveKey();
      if (key) localStorage.removeItem(key);
    } catch (_) { /* ignore */ }
    logEvent(`Layout saved (model v${r.modelVersion})`, "ok");
    await refreshProject();
  }

  function mirrorSelection() {
    if (!selectedIds.size || !lastCanvas) return;
    const before = captureLayout();
    const nodes = [...selectedIds].map((id) => lastCanvas.nodes.find((x) => x.id === id)).filter(Boolean);
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x + (n.w || 140)));
    const mid = (minX + maxX) / 2;
    for (const n of nodes) {
      const w = n.w || 140;
      n.x = snapVal(mid - ((n.x + w) - mid));
      n.r = (((-(Number(n.r) || 0)) % 360) + 360) % 360;
      const el = nodeEls.get(n.id);
      if (el) {
        el.style.left = n.x + "px";
        el.style.transform = n.r ? `rotate(${n.r}deg)` : "";
      }
    }
    pushUndo(before);
    layoutDirty = true;
    setSavePill("dirty");
    redrawLinksOnly();
    logEvent("Mirrored selection", "ok");
  }

  function autoLayoutSelection() {
    if (!lastCanvas?.nodes?.length) return;
    const before = captureLayout();
    const ids = selectedIds.size ? [...selectedIds] : lastCanvas.nodes.map((n) => n.id);
    const cols = Math.max(2, Math.ceil(Math.sqrt(ids.length)));
    ids.forEach((id, i) => {
      const n = lastCanvas.nodes.find((x) => x.id === id);
      if (!n || n.locked) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      n.x = snapVal(80 + col * 220);
      n.y = snapVal(60 + row * 150);
      const el = nodeEls.get(id);
      if (el) {
        el.style.left = n.x + "px";
        el.style.top = n.y + "px";
      }
    });
    pushUndo(before);
    layoutDirty = true;
    setSavePill("dirty");
    redrawLinksOnly();
    fitViewSoon(2, { force: true });
    logEvent(`Auto-layout applied to ${ids.length} equipment`, "ok");
  }

  async function saveProjectAs() {
    if (!projectId) return;
    const name = prompt("Save As — new project name:", (document.getElementById("projectName")?.textContent || "Project") + " copy");
    if (!name?.trim()) return;
    if (layoutDirty) await saveLayout().catch(() => {});
    const active = await api("/api/model/projects/active");
    const src = active.project;
    if (!src) throw new Error("No active project");
    const created = await api("/api/model/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: src.description || "" })
    });
    const newId = created.project?.id;
    if (!newId) throw new Error("Save As failed — no project id");
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = newId;
    clone.name = name.trim();
    clone.description = src.description || "";
    delete clone.meta?.samplePlant;
    await api(`/api/model/projects/${newId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: clone })
    });
    await api("/api/model/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: newId })
    });
    await syncRuntime("save as");
    await refreshProject();
    await refreshProjectList();
    logEvent(`Saved As “${name.trim()}”`, "ok");
    setWorkspace("design");
  }

  async function exportEngineeringPackage() {
    if (!projectId) return;
    setWorkspace("verify");
    const [summary, eng] = await Promise.all([
      api(`/api/model/projects/${projectId}/summary`).catch(() => ({})),
      api("/api/connect/engineering/status").catch(() => ({}))
    ]);
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), summary, engineering: eng, projectId }, null, 2)],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `p6-export-${projectId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    logEvent("Exported engineering package JSON (summary + gate status)", "ok");
    lastVerifyChip = "export";
    updateStatusChips();
  }

  function fitNodes(nodes, { force = false } = {}) {
    if (!nodes?.length) return;
    if (userViewLocked && !force) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 160));
      maxY = Math.max(maxY, n.y + (n.h || 90));
    }
    const vw = Math.max(120, viewport.clientWidth || 0);
    const vh = Math.max(120, viewport.clientHeight || 0);
    const pad = 48;
    const bw = Math.max(80, maxX - minX + pad * 2);
    const bh = Math.max(80, maxY - minY + pad * 2);
    // Prefer fitting the whole plant into the visible viewport
    scale = Math.min(1.6, Math.max(0.18, Math.min(vw / bw, vh / bh) * 0.92));
    panX = (vw - bw * scale) / 2 - (minX - pad) * scale;
    panY = (vh - bh * scale) / 2 - (minY - pad) * scale;
    applyTransform();
    if (lastCanvas) updateCanvasMeta(lastCanvas);
  }

  function fitView(opts) {
    if (opts?.force || !userViewLocked) userViewLocked = false;
    fitNodes(lastCanvas?.nodes || [], { force: true, ...opts });
  }

  /** Fit after layout paints — boot often runs before the viewport has real size. */
  function fitViewSoon(passes = 3, opts) {
    if (userViewLocked && !opts?.force) return;
    let left = passes;
    const step = () => {
      fitView({ force: true, ...opts });
      left -= 1;
      if (left > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function zoomToSelection() {
    userViewLocked = false;
    const nodes = (lastCanvas?.nodes || []).filter((n) => selectedIds.has(n.id));
    fitNodes(nodes.length ? nodes : lastCanvas?.nodes || [], { force: true });
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
      const plain = engineerExplain(tag, reasons, e.message);
      logEvent(plain, "alarm");
      pushAlarm(plain, { severity: "high" });
      renderInspector([plain]);
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
      const healthy = tags.find((t) => /Healthy/i.test(t)) || "ESTOP101.Healthy";
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
      if (workspaceMode === "diagnostic") {
        renderInspectorEmptyLogic();
      } else {
        title.textContent = "Select equipment";
        sub.textContent = "Click a node on the map";
        body.innerHTML = `<p class="muted">No selection.</p>`;
      }
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
          <label>Tag<input type="text" id="propTag" value="${esc(selected.tag)}" autocomplete="off" /></label>
          <label>Type<select id="propType">${typeOpts}<option value="${esc(selected.type)}">${esc(selected.type)}</option></select></label>
        </div>
        <label class="propFull">Description<textarea id="propDesc" rows="2" placeholder="Engineering description">${esc(selected.description || "")}</textarea></label>
        <div class="cmdRow">
          <button type="button" id="btnSaveIdentity">Save tag / type / description</button>
          <button type="button" id="btnApproveEq">Mark approved</button>
          <button type="button" id="btnDeleteEq">Delete equipment</button>
        </div>
        ${tankForm}
        <dl class="inspKv">
          <dt>Data class</dt><dd>${esc(selected.dataClass || "—")}</dd>
          <dt>Operating state</dt><dd>${esc(selected.operatingState || "—")}</dd>
          <dt>Live signals</dt><dd>${Object.keys(live).length} on this equipment</dd>
        </dl>
        <details class="advDetails"><summary>Advanced (model record)</summary><pre class="mono">${esc(JSON.stringify({
        tag: selected.tag, type: selected.type, description: selected.description, dataClass: selected.dataClass, operatingState: selected.operatingState, properties: props
      }, null, 2))}</pre></details>
        <p class="warn">Edits update the simulation model and rebind Runtime automatically. Simulated controls only — not certified physical safety.</p>`;
      document.getElementById("btnSaveIdentity").onclick = () => {
        reworkEquipment(selected, {
          tag: document.getElementById("propTag").value,
          type: document.getElementById("propType").value,
          description: document.getElementById("propDesc")?.value ?? ""
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
    } else if (inspTab === "logic") {
      body.innerHTML = `${rejectHtml}
        ${logicObservabilityHtml()}
        <p class="muted">Logic observability from Runtime · selection preserved across workspace tabs.</p>
        <button type="button" id="btnOpenIlkFromLogic">Open interlocks workspace</button>`;
      document.getElementById("btnOpenIlkFromLogic")?.addEventListener("click", () => {
        setWorkspace("engineer", { openInterlocks: true, equipmentId: selected?.id });
      });
      refreshLogicStatus().then(() => {
        if (inspTab === "logic" && selected) renderInspector();
      }).catch(() => {});
    } else if (inspTab === "interlocks") {
      body.innerHTML = `${rejectHtml}<p class="muted">Loading interlocks…</p>`;
      loadInterlocks({ equipmentId: selected.id }).then(() => {
        renderInspectorInterlocks(body, rejectHtml);
      });
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
      body.innerHTML = `${rejectHtml}${renderLiveSignalsTable(live)}`;
    } else if (inspTab === "alarms") {
      const alarms = [];
      if (Object.entries(live).some(([k, v]) => /Healthy/i.test(k) && v === false)) alarms.push("E-STOP ACTIVE (sim)");
      if (Object.entries(live).some(([k, v]) => /Fault/i.test(k) && v === true)) alarms.push("FAULT");
      if (Object.entries(live).some(([k, v]) => /High/i.test(k) && v === true)) alarms.push("LEVEL HIGH");
      if (lastCanvas?.mem?.M1) alarms.push("TRIP LATCH M1");
      const eng = [];
      if (lastModelValidation?.issues?.length) {
        for (const iss of lastModelValidation.issues.slice(0, 12)) {
          if (iss.severity === "error" || iss.severity === "warning") {
            eng.push(`[MODEL ${iss.severity.toUpperCase()}] ${iss.code}: ${iss.message}`);
          }
        }
      }
      const blocks = [];
      if (alarms.length) blocks.push("Process (sim):\n" + alarms.join("\n"));
      else blocks.push("Process (sim):\nNo active alarms");
      if (eng.length) blocks.push("Engineering validation:\n" + eng.join("\n"));
      else if (lastModelValidation?.ok) blocks.push("Engineering validation:\nNo errors or warnings");
      body.innerHTML = `${rejectHtml}<pre>${esc(blocks.join("\n\n"))}</pre>`;
    } else {
      const cmds = signalCommands(selected);
      body.innerHTML = `${rejectHtml}
        <div class="cmdRow">${cmds.map((c, i) => `<button type="button" data-cmd="${i}">${esc(c.label)}</button>`).join("") || "<span class='muted'>No commands</span>"}</div>
        ${renderLiveSignalsTable(live)}
        ${workspaceMode === "diagnostic" ? logicObservabilityHtml() : ""}
        <p class="warn">Commands use Runtime permissive checks (simulation).</p>`;
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

  function appendVerifyResult({ testName, testId, pass, status, assertions, error, failureExplain, raw }) {
    const verifyLog = document.getElementById("verifyLog");
    if (!verifyLog) return;
    const wrap = document.createElement("div");
    const st = status || (pass ? "PASS" : "FAIL");
    const html = window.P6VerifyUI
      ? P6VerifyUI.renderVerifyRunRow({
          testName,
          testId,
          pass: st === "PASS",
          status: st,
          assertions,
          error,
          failureExplain,
          raw
        })
      : `<div class="verifyRow ${st === "PASS" ? "ok" : "alarm"}">${esc(testName || testId)} ${esc(st)}</div>`;
    wrap.innerHTML = html;
    verifyLog.prepend(wrap.firstElementChild);
    const wsLog = document.getElementById("verifyWorkspaceLog");
    if (wsLog) wsLog.prepend(wrap.firstElementChild.cloneNode(true));
    lastVerifyChip = st;
    updateStatusChips();
    document.querySelector('[data-actab="verify"]')?.click();
    document.getElementById("console")?.classList.remove("collapsed");
  }

  async function runFat(testId) {
    // onclick passes Event — only accept real catalog string ids
    const id = typeof testId === "string" && testId ? testId : "P101_ESTOP_SHUTDOWN";
    let testName = id;
    try {
      const cat = await api("/api/verify/tests");
      const match = (cat.tests || []).find((t) => t.id === id);
      if (match?.name) testName = match.name;
    } catch (_) { /* catalog optional */ }
    logEvent(`P6 Verify: running ${testName}…`);
    try {
      const r = await api("/api/verify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testId: id })
      });
      const status = r.status || r.result?.status || (r.pass ? "PASS" : "FAIL");
      const pass = status === "PASS";
      const assertions = r.result?.assertions || r.assertions || [];
      const explain = r.result?.failureExplain || r.result?.blockReason || null;
      const line = `${testName} ${status}` + (explain ? ` — ${explain}` : "");
      logEvent(line, pass ? "ok" : status === "BLOCKED" ? "warn" : "alarm");
      appendVerifyResult({
        testName,
        testId: id,
        pass,
        status,
        assertions,
        failureExplain: explain,
        raw: r
      });
    } catch (e) {
      logEvent("Run Test error: " + e.message, "alarm");
      appendVerifyResult({ testName, testId: id, pass: false, status: "NOT_RUN", error: e.message });
    }
  }

  function connectCard(title, status, detail, honest) {
    const st = String(status || "unknown").toLowerCase();
    return `<article class="connectCard ${esc(st)}">
      <h4>${esc(title)}</h4>
      <p class="connectStatus">${esc(status || "—")}</p>
      <p class="muted">${esc(detail || "")}</p>
      ${honest ? `<p class="warn connectHonest">${honest}</p>` : ""}
    </article>`;
  }

  async function refreshConnect() {
    const [opc, mqtt, eng] = await Promise.all([
      api("/api/connect/opcua"),
      api("/api/connect/mqtt"),
      api("/api/connect/engineering/status")
    ]);
    const cards = document.getElementById("connectCards");
    if (cards) {
      const opcSt = opc.connected ? "Connected" : opc.enabled === false ? "Disabled" : "Not connected";
      const mqttSt = mqtt.connected ? "Connected" : mqtt.enabled === false ? "Disabled" : "Not connected";
      const engSt = eng.approved ? "Approved for export" : eng.pending ? "Pending review" : "Engineering gate";
      cards.innerHTML =
        connectCard(
          "OPC UA / Ignition",
          opcSt,
          opc.endpoint || opc.message || "Optional profile — not required for Studio + Runtime.",
          "Live Ignition tags are not proven in this build unless you validate with the ignition compose profile."
        ) +
        connectCard("MQTT", mqttSt, mqtt.broker || mqtt.topic || "Observation / bridge when configured.") +
        connectCard(
          "Engineering export",
          engSt,
          `Project ${eng.projectId || "—"} · model v${eng.modelVersion ?? "—"}`,
          eng.approved ? "" : "Exports stay gated until engineering approval — P6 model remains authoritative."
        );
    }
    const out = document.getElementById("connectOut");
    if (out) out.textContent = JSON.stringify({ opcua: opc, mqtt, engineering: eng }, null, 2);
  }

  function hideAllWorkspacePanels() {
    connectPanel?.classList.add("hidden");
    document.getElementById("interlocksPanel")?.classList.add("hidden");
    document.getElementById("engineerPanel")?.classList.add("hidden");
    document.getElementById("ingestPanel")?.classList.add("hidden");
    ioPanelPanel?.classList.add("hidden");
    verifyWorkspacePanel?.classList.add("hidden");
    if (toolPanel) toolPanel.classList.add("hidden");
    if (toolFrame && toolFrame.src && toolFrame.src !== "about:blank") toolFrame.src = "about:blank";
  }

  /** Normalize legacy workspace ids (logic/io → engineer). Selection + project persist. */
  function normalizeWorkspace(ws) {
    if (ws === "logic" || ws === "io") return "engineer";
    if (["design", "engineer", "simulate", "verify"].includes(ws)) return ws;
    return "design";
  }

  /** Four workspace categories only — selection + project model persist. */
  function setWorkspace(ws, opts = {}) {
    const next = normalizeWorkspace(ws);
    workspace = next;
    studio.setAttribute("data-workspace", next);
    document.querySelectorAll(".wsTab").forEach((b) => {
      const on = b.getAttribute("data-ws") === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-ws-side]").forEach((el) => {
      el.classList.toggle("hidden", el.getAttribute("data-ws-side") !== next);
    });

    hideAllWorkspacePanels();
    const titles = {
      design: "Design",
      engineer: "Engineer",
      simulate: "Simulate",
      verify: "Verify & Export"
    };
    const hints = {
      design: "place · connect · library · Import Drawing",
      engineer: "configure · signals · interlocks · codegen · selection preserved",
      simulate: "run · scenarios · X-Ray · process viz",
      verify: "FAT catalog · snapshot · export package"
    };
    document.getElementById("viewTitle").textContent = titles[next];
    document.getElementById("modeHint").textContent = hints[next];

    if (next === "design") {
      view = "map";
      viewport.classList.remove("hidden");
      viewport.style.display = "";
      setWorkspaceMode("engineering", { silent: true });
      if (!symbolModeUserOverride) setSymbolMode("pid", { silent: true });
      if (!opts.openIngest && !opts.openConnect) {
        inspTab = "overview";
        syncInspTabs();
        studio.classList.add("show-inspector");
        if (selected) renderInspector();
      }
      if (opts.openIngest) openIngestPanel({ stayInWorkspace: true });
      if (opts.openConnect) {
        view = "connect";
        viewport.classList.add("hidden");
        connectPanel.classList.remove("hidden");
        refreshConnect().catch((e) => logEvent(String(e.message), "alarm"));
      }
    } else if (next === "engineer") {
      view = "map";
      viewport.classList.remove("hidden");
      viewport.style.display = "";
      setWorkspaceMode("engineering", { silent: true });
      if (!symbolModeUserOverride) setSymbolMode("pid", { silent: true });
      studio.classList.add("show-inspector");
      if (opts.openEngineer || opts.panel === "engineer") {
        openEngineerPanel({ stayInWorkspace: true });
        inspTab = "logic";
        document.getElementById("advEngineering")?.setAttribute("open", "");
      } else if (opts.openInterlocks || opts.panel === "interlocks") {
        openInterlocksPanel({
          equipmentId: opts.equipmentId || selected?.id,
          selectId: opts.selectId,
          stayInWorkspace: true
        });
        inspTab = "interlocks";
      } else if (opts.openIo || opts.panel === "io" || ws === "io") {
        view = "io";
        viewport.classList.add("hidden");
        ioPanelPanel?.classList.remove("hidden");
        refreshIoPanel().catch((e) => logEvent(e.message, "alarm"));
        inspTab = "io";
        document.getElementById("viewTitle").textContent = "Engineer · I/O map";
      } else if (opts.panel === "logic") {
        inspTab = "logic";
        document.getElementById("advEngineering")?.setAttribute("open", "");
      } else if (selected) {
        if (!["overview", "control", "io", "interlocks"].includes(inspTab)) inspTab = "overview";
      } else {
        inspTab = "overview";
      }
      syncInspTabs();
      if (selected) renderInspector();
      else if (inspTab === "logic") renderInspectorEmptyLogic();
    } else if (next === "simulate") {
      view = "map";
      viewport.classList.remove("hidden");
      viewport.style.display = "";
      setWorkspaceMode("simulation", { silent: true });
      if (!symbolModeUserOverride) setSymbolMode("scada", { silent: true });
      // Focus the P&ID: collapse events drawer + side library; inspector only if something selected / X-Ray
      document.getElementById("console")?.classList.add("collapsed");
      const expandBtn = document.getElementById("btnToggleConsole");
      if (expandBtn) expandBtn.textContent = "Expand";
      studio.classList.add("collapsed-side");
      hideAllWorkspacePanels();
      if (opts.xray === true) {
        setXrayMode(true);
        studio.classList.add("show-inspector");
        studio.classList.remove("collapsed-insp");
      } else {
        if (opts.xray === false) setXrayMode(false);
        if (inspTab === "interlocks" || inspTab === "io" || inspTab === "logic" || inspTab === "xray") {
          inspTab = "overview";
          syncInspTabs();
        }
        if (selected) {
          studio.classList.add("show-inspector");
          studio.classList.remove("collapsed-insp");
          if (!xrayMode) renderInspector();
        } else {
          studio.classList.add("collapsed-insp");
          studio.classList.remove("show-inspector");
        }
      }
      userViewLocked = false;
    } else if (next === "verify") {
      view = "verify";
      viewport.classList.add("hidden");
      setWorkspaceMode("simulation", { silent: true });
      verifyWorkspacePanel?.classList.remove("hidden");
      loadVerifyCatalog().catch((e) => logEvent(e.message, "alarm"));
    }

    document.querySelectorAll(".navItem[data-view]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-view") === view);
    });
    if (!userViewLocked && (next === "design" || next === "engineer" || next === "simulate")) fitViewSoon(2);
  }

  function setView(v) {
    if (v === "connect") {
      setWorkspace("design", { openConnect: true });
      return;
    }
    if (v === "map") {
      setWorkspace(workspace === "simulate" ? "simulate" : "design");
      return;
    }
    setWorkspace("design");
  }

  function openEmbed(url, title) {
    // Nested full-app iframes removed — fold into workspace or open standalone honestly.
    logEvent(`${title || url}: open from landing / dedicated page (not embedded in Studio)`, "ok");
    if (url && /verify/i.test(url)) setWorkspace("verify");
    else if (url && /interlock/i.test(url)) setWorkspace("engineer", { openInterlocks: true });
    else if (url && /monitor|tag/i.test(url)) setWorkspace("engineer", { openIo: true });
    else if (url && /ingest|pid/i.test(url)) setWorkspace("design", { openIngest: true });
    else if (url && /connect/i.test(url)) setWorkspace("design", { openConnect: true });
  }

  function closeEmbed() {
    if (toolPanel) toolPanel.classList.add("hidden");
    if (toolFrame && toolFrame.src && toolFrame.src !== "about:blank") toolFrame.src = "about:blank";
  }

  async function refreshIoPanel() {
    const body = document.getElementById("ioBody");
    const meta = document.getElementById("ioMeta");
    if (!body) return;
    const d = await api("/api/runtime/signals");
    const signals = d.signals || [];
    const q = (document.getElementById("ioSearch")?.value || "").trim().toLowerCase();
    const selectedOnly = !!document.getElementById("ioSelectedOnly")?.checked;
    const selTag = selected?.tag || "";
    const selIds = selected ? new Set([selected.tag, ...(selected.signals || []).map((s) => s.tag)]) : new Set();
    let rows = signals;
    if (selectedOnly && selected) {
      rows = rows.filter((s) => {
        const tag = s.tag || "";
        return tag === selTag || tag.startsWith(selTag + ".") || selIds.has(tag) ||
          (selected.signals || []).some((x) => x.tag === tag);
      });
    }
    if (q) rows = rows.filter((s) => String(s.tag || "").toLowerCase().includes(q));
    if (meta) {
      meta.textContent = selected
        ? `${rows.length} signal(s) · focused ${selected.tag}`
        : `${rows.length} signal(s) · select equipment to focus`;
    }
    if (!rows.length) {
      body.innerHTML = `<p class="muted">No signals match${selectedOnly && selected ? ` for ${esc(selected.tag)}` : ""}.</p>`;
      return;
    }
    body.innerHTML = `<table class="ioTable"><thead><tr><th>Tag</th><th>Value</th><th>Type</th></tr></thead><tbody>${rows
      .slice(0, 200)
      .map((s) => {
        const hilite = selected && String(s.tag || "").startsWith(selected.tag);
        return `<tr class="${hilite ? "hilite" : ""}"><td>${esc(s.tag)}</td><td>${esc(String(s.currentValue ?? s.value ?? "—"))}</td><td>${esc(s.dataType || s.type || "—")}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  async function loadVerifyCatalog() {
    const host = document.getElementById("verifyCatalog");
    if (!host) return;
    try {
      const cat = await api("/api/verify/tests");
      const tests = cat.tests || [];
      if (!tests.length) {
        host.innerHTML = `<p class="muted">No FAT tests in catalog.</p>`;
        return;
      }
      const limitsHtml = (cat.limits || [])
        .map((l) => `<li class="muted">${esc(l)}</li>`)
        .join("");
      host.innerHTML =
        `<p class="warn">VIRTUAL evidence only · status PASS/FAIL/BLOCKED/NOT RUN from Runtime</p>` +
        tests
          .map((t) => {
            const exec = t.executable !== false;
            return `<div class="verifyTest">
            <div><b>${esc(t.name || t.id)}</b>
              <span class="muted">${esc(t.requirementRef || "")}</span>
              <div class="muted">${esc(t.description || t.id)}</div>
              ${!exec ? `<div class="warn">BLOCKED — ${esc(t.blockReason || "not executable")}</div>` : ""}
            </div>
            <button type="button" data-fat="${esc(t.id)}">${exec ? "Run" : "Record BLOCKED"}</button>
          </div>`;
          })
          .join("") +
        (limitsHtml ? `<ul class="condList">${limitsHtml}</ul>` : "") +
        `<div class="cmdRow">
          <button type="button" id="btnVerifySuite">Run executable suite</button>
          <button type="button" id="btnVerifyPkg">Download package (preview)</button>
        </div>`;
      host.querySelectorAll("[data-fat]").forEach((btn) => {
        btn.onclick = () => runFat(btn.getAttribute("data-fat")).catch((e) => logEvent(e.message, "alarm"));
      });
      document.getElementById("btnVerifySuite")?.addEventListener("click", async () => {
        try {
          const r = await api("/api/verify/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suite: true })
          });
          const s = r.summary || {};
          logEvent(
            `Verify suite: ${s.passed || 0} PASS · ${s.failed || 0} FAIL · ${s.blocked || 0} BLOCKED · ${s.notRun || 0} NOT RUN`,
            s.failed ? "alarm" : "ok"
          );
          for (const result of r.results || []) {
            appendVerifyResult({
              testName: result.testName || result.testId,
              testId: result.testId,
              pass: result.status === "PASS",
              status: result.status,
              assertions: result.assertions || [],
              failureExplain: result.failureExplain || result.blockReason,
              raw: result
            });
          }
        } catch (e) {
          logEvent(e.message, "alarm");
        }
      });
      document.getElementById("btnVerifyPkg")?.addEventListener("click", () => {
        window.open("/api/exports/package/download?forcePreview=1", "_blank");
        logEvent("Engineering package preview download started (VIRTUAL · not physical FAT)", "ok");
      });
    } catch (e) {
      host.innerHTML = `<p class="warn">${esc(e.message)}</p>`;
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
    const head = `Scenario ${name}: ${changes.length} signal change(s)`;
    logEvent(head, changes.length ? "ok" : "");
    const row = document.createElement("div");
    row.className = "ev ok";
    row.innerHTML = `<b>${esc(head)}</b> · <span class="muted">live Runtime only — not Verify FAT</span><br>${changes.slice(0, 12).map((c) =>
      `${esc(c.tag)}: ${esc(String(c.before))} → ${esc(String(c.after))}`
    ).join("<br>") || "<span class='muted'>No signal deltas</span>"}`;
    consoleLog.prepend(row);
    document.querySelector('[data-actab="events"]')?.click();
    document.getElementById("console")?.classList.remove("collapsed");
  }

  /** Resolve live tags for tank-transfer OR water-transfer demos. */
  async function resolvePlantTags() {
    const d = await api("/api/runtime/signals");
    const tags = (d.signals || []).map((s) => s.tag);
    const pick = (...cands) => cands.find((t) => tags.includes(t)) || cands[0];
    return {
      tags,
      estop: pick("ESTOP101.Healthy", "ESD-101.Healthy", "ESD101.Healthy"),
      high: pick("LSH101.High", "LT-101.High", "LSH-101.High"),
      valveOpen: pick("XV101.OpenCommand", "VALVE-101.OpenCommand", "XV-101.OpenCommand"),
      start: "System.Start",
      reset: "System.Reset"
    };
  }

  async function runScenario(name) {
    setPlayback(false);
    if (workspace !== "simulate") setWorkspace("simulate");
    else setWorkspaceMode("simulation", { silent: true });
    const cmd = (tag, value, pulse) => sendCommand(tag, value, !!pulse);
    try {
      const plant = await resolvePlantTags();
      const before = await captureSignalSnapshot();
      if (name === "normal_start") {
        await cmd(plant.estop, true);
        await cmd(plant.high, false);
        // Water transfer opens valve from System.Start; tank demo needs Open first
        if (/VALVE-101|XV-101/i.test(plant.valveOpen) && !/XV101/i.test(plant.valveOpen)) {
          await cmd(plant.valveOpen, true);
          await new Promise((r) => setTimeout(r, 300));
        }
        await cmd(plant.start, true, true);
        logEvent(`Scenario: normal startup (${plant.estop} / ${plant.high})`, "ok");
      } else if (name === "valve_close") {
        await cmd(plant.valveOpen, false);
        logEvent("Scenario: valve closed", "ok");
      } else if (name === "pump_fault") {
        await api("/api/fault", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ var: "Q2", mode: "stuck", value: true })
        });
        logEvent("Scenario: pump fault injected (sim Q2)", "alarm");
      } else if (name === "high_level") {
        await cmd(plant.high, true);
        logEvent(`Scenario: high level (${plant.high})`, "alarm");
      } else if (name === "estop") {
        await cmd(plant.estop, false);
        logEvent("Scenario: E-stop activated (sim model only — not a certified physical safety function)", "alarm");
      } else if (name === "clear") {
        try { await api("/api/fault/Q2", { method: "DELETE" }); } catch (_) { /* ignore */ }
        try { await api("/api/fault/I1", { method: "DELETE" }); } catch (_) { /* ignore */ }
        await cmd(plant.high, false);
        await cmd(plant.estop, true);
        await cmd(plant.reset, true, true);
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

  async function runPlantOp(op) {
    try {
      await syncRuntime("plant op").catch(() => {});
      const plant = await resolvePlantTags();
      if (op === "clear_high") {
        await sendCommand(plant.high, false);
        logEvent(`Cleared high-level (${plant.high})`, "ok");
      } else if (op === "clear_estop") {
        await sendCommand(plant.estop, true);
        await sendCommand(plant.reset, true, true);
        logEvent(`E-stop cleared (${plant.estop}) + reset`, "ok");
      } else if (op === "reset_trip") {
        await sendCommand(plant.reset, true, true);
        logEvent("Trip reset pulsed (System.Reset)", "ok");
      } else if (op === "start_transfer") {
        await sendCommand(plant.high, false);
        await sendCommand(plant.estop, true);
        if (/VALVE-101|XV-101/i.test(plant.valveOpen) && !/XV101\.OpenCommand/i.test(plant.valveOpen)) {
          await sendCommand(plant.valveOpen, true);
          await new Promise((r) => setTimeout(r, 350));
        }
        await sendCommand(plant.start, true, true);
        logEvent("START TRANSFER pulsed — watch valve/pump on canvas", "ok");
      } else if (op === "estop") {
        await sendCommand(plant.estop, false);
        logEvent("E-stop activated (sim only — not a certified physical safety function)", "alarm");
      }
    } catch (e) {
      logEvent(`Plant op failed: ${e.message}`, "alarm");
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

  function onInspTabClick(e) {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    inspTab = b.dataset.tab;
    syncInspTabs();
    if (inspTab === "xray" && selected) {
      xrayMode = true;
      studio.classList.add("xray-mode");
      enterDiagnosticWorkspace();
      loadXray(selected).then(() => {
        applyXrayPathHighlight();
        renderCanvas(lastCanvas);
        renderInspector();
      });
    } else {
      renderInspector();
    }
  }
  document.getElementById("inspTabs").onclick = onInspTabClick;
  document.getElementById("advEngineering")?.addEventListener("click", onInspTabClick);

  document.getElementById("btnToggleSide").onclick = () => {
    studio.classList.toggle("collapsed-side");
    fitViewSoon(2);
  };
  document.getElementById("btnToggleInsp").onclick = () => {
    // Desktop: collapsed-insp retargets grid. Narrow (≤1100px): .show-inspector overlays.
    const open = !studio.classList.contains("collapsed-insp");
    if (open) {
      studio.classList.add("collapsed-insp");
      studio.classList.remove("show-inspector");
    } else {
      studio.classList.remove("collapsed-insp");
      studio.classList.add("show-inspector");
    }
    fitViewSoon(2);
  };
  document.getElementById("btnToggleConsole").onclick = () => {
    const el = document.getElementById("console");
    el?.classList.toggle("collapsed");
    const btn = document.getElementById("btnToggleConsole");
    if (btn) btn.textContent = el?.classList.contains("collapsed") ? "Expand" : "Collapse";
    fitViewSoon(2);
  };
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
  document.querySelectorAll(".wsTab").forEach((btn) => {
    btn.addEventListener("click", () => setWorkspace(btn.getAttribute("data-ws")));
  });
  document.querySelectorAll("[data-scenario]").forEach((el) => {
    el.addEventListener("click", () => {
      setWorkspace("simulate");
      runScenario(el.getAttribute("data-scenario"));
    });
  });
  document.querySelectorAll("[data-plant]").forEach((el) => {
    el.addEventListener("click", () => runPlantOp(el.getAttribute("data-plant")));
  });
  document.getElementById("navImportPid")?.addEventListener("click", () => setWorkspace("design", { openIngest: true }));
  document.getElementById("navScratch")?.addEventListener("click", () => openWizard(1));
  document.getElementById("navOpenExisting")?.addEventListener("click", () => {
    setWorkspace("design");
    refreshProjectList().catch((e) => logEvent(e.message, "alarm"));
    document.getElementById("projectList")?.scrollIntoView({ block: "nearest" });
  });
  function closeProjMenu() {
    document.getElementById("projMenu")?.removeAttribute("open");
  }
  document.getElementById("btnProjNew")?.addEventListener("click", () => {
    closeProjMenu();
    openWizard(1);
  });
  document.getElementById("btnProjImport")?.addEventListener("click", () => {
    closeProjMenu();
    setWorkspace("design", { openIngest: true });
  });
  document.getElementById("btnProjOpen")?.addEventListener("click", () => {
    closeProjMenu();
    setWorkspace("design");
    studio.classList.remove("collapsed-side");
    refreshProjectList().catch((e) => logEvent(e.message, "alarm"));
    document.getElementById("projectList")?.scrollIntoView({ block: "nearest" });
  });
  document.getElementById("btnProjSaveAs")?.addEventListener("click", () => {
    closeProjMenu();
    saveProjectAs().catch((e) => logEvent(e.message, "alarm"));
  });
  document.getElementById("btnProjExport")?.addEventListener("click", () => {
    closeProjMenu();
    exportEngineeringPackage().catch((e) => logEvent(e.message, "alarm"));
  });
  document.getElementById("btnExportPackage")?.addEventListener("click", () => {
    exportEngineeringPackage().catch((e) => logEvent(e.message, "alarm"));
  });
  document.getElementById("btnExportConnect")?.addEventListener("click", () => {
    setWorkspace("design", { openConnect: true });
  });
  document.getElementById("btnAutoLayout")?.addEventListener("click", () => autoLayoutSelection());
  document.getElementById("btnRotate")?.addEventListener("click", () => rotateSelection(90));
  document.getElementById("btnMirror")?.addEventListener("click", () => mirrorSelection());
  document.getElementById("chkDragLock")?.addEventListener("change", (e) => {
    dragLock = !!e.target.checked;
    logEvent(dragLock ? "Drag lock on — equipment won't move until unlocked" : "Drag lock off", "ok");
  });
  // Ensure Project menu Save still wired (same id as before)
  document.getElementById("btnSaveLayout")?.addEventListener("click", () => {
    closeProjMenu();
    saveLayout().catch((e) => logEvent(e.message, "alarm"));
  });
  document.getElementById("btnSettings")?.addEventListener("click", () => {
    const ov = document.getElementById("settingsOverlay");
    const host = document.getElementById("settingsLimits");
    if (host) host.innerHTML = document.getElementById("limitsList")?.innerHTML || "<li class='muted'>No limits loaded</li>";
    ov?.classList.remove("hidden");
  });
  document.getElementById("btnSettingsClose")?.addEventListener("click", () => {
    document.getElementById("settingsOverlay")?.classList.add("hidden");
  });
  document.getElementById("btnIoRefresh")?.addEventListener("click", () => refreshIoPanel().catch((e) => logEvent(e.message, "alarm")));
  document.getElementById("ioSearch")?.addEventListener("input", () => {
    if (workspace === "engineer" && view === "io") refreshIoPanel().catch(() => {});
  });
  document.getElementById("ioSelectedOnly")?.addEventListener("change", () => {
    if (workspace === "engineer" && view === "io") refreshIoPanel().catch(() => {});
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
    if (mod && ev.key.toLowerCase() === "c" && selectedIds.size) {
      ev.preventDefault();
      clipboardNodes = [...selectedIds].map((id) => {
        const n = lastCanvas?.nodes?.find((x) => x.id === id);
        return n ? { id: n.id, tag: n.tag, type: n.type, x: n.x, y: n.y, w: n.w, h: n.h, r: n.r, properties: n.properties } : null;
      }).filter(Boolean);
      logEvent(`Copied ${clipboardNodes.length} equipment`, "ok");
      return;
    }
    if (mod && ev.key.toLowerCase() === "v" && clipboardNodes?.length) {
      ev.preventDefault();
      (async () => {
        for (const c of clipboardNodes) {
          const node = lastCanvas?.nodes?.find((n) => n.id === c.id) || c;
          await duplicateEquipment({ ...node, x: (c.x || 0), y: (c.y || 0), tag: c.tag, type: c.type, properties: c.properties });
        }
      })().catch((e) => logEvent(e.message, "alarm"));
      return;
    }
    if ((ev.key === "m" || ev.key === "M") && selectedIds.size) {
      ev.preventDefault();
      mirrorSelection();
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
      closeIngestPanel();
      closeInterlocksPanel();
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

  // —— Studio Interlocks (see inside: conditions → action → inhibits) ——
  const interlocksPanel = document.getElementById("interlocksPanel");

  function rebuildIlkCornerMap(items) {
    const next = new Map();
    for (const ilk of items || []) {
      const mode = ilk.active ? "active" : "armed";
      for (const id of ilk.highlightEquipmentIds || []) {
        if (!id) continue;
        // active wins over armed
        if (next.get(id) === "active") continue;
        next.set(id, mode);
      }
      for (const inh of ilk.inhibits || []) {
        if (!inh.equipmentId) continue;
        if (next.get(inh.equipmentId) === "active") continue;
        next.set(inh.equipmentId, mode);
      }
    }
    ilkCornerByEq = next;
  }

  async function loadInterlocks(opts = {}) {
    const q = opts.equipmentId ? `?equipmentId=${encodeURIComponent(opts.equipmentId)}` : "";
    interlocksData = await api("/api/runtime/interlocks" + q);
    // Corner badges always reflect the full project picture
    if (opts.equipmentId) {
      try {
        const full = await api("/api/runtime/interlocks");
        rebuildIlkCornerMap(full.interlocks);
      } catch (_) {
        rebuildIlkCornerMap(interlocksData?.interlocks);
      }
    } else {
      rebuildIlkCornerMap(interlocksData?.interlocks);
    }
    if (lastCanvas) {
      for (const n of lastCanvas.nodes || []) {
        const el = nodeEls.get(n.id);
        if (el) patchNodeEl(el, n);
      }
    }
    return interlocksData;
  }

  async function refreshIlkCorners() {
    try {
      const full = await api("/api/runtime/interlocks");
      rebuildIlkCornerMap(full.interlocks);
      if (lastCanvas) {
        for (const n of lastCanvas.nodes || []) {
          const el = nodeEls.get(n.id);
          if (el) patchNodeEl(el, n);
        }
      }
    } catch (_) { /* optional */ }
  }

  function applyInterlockHighlight(ilk) {
    ilkHighlightIds = new Set(ilk?.highlightEquipmentIds || []);
    ilkHighlightActive = !!ilk?.active;
    if (lastCanvas) syncCanvas(lastCanvas);
  }

  function clearInterlockHighlight() {
    ilkHighlightIds = new Set();
    ilkHighlightActive = false;
    if (lastCanvas) syncCanvas(lastCanvas);
  }

  function renderIlkList() {
    const host = document.getElementById("ilkList");
    const count = document.getElementById("ilkCount");
    if (!host) return;
    const items = interlocksData?.interlocks || [];
    if (count) {
      count.textContent = items.length
        ? `(${items.length} · ${interlocksData.activeCount || 0} active)`
        : "";
    }
    if (!items.length) {
      host.innerHTML = `<p class="muted">No interlocks in the model yet. Ingest ESD/level tags or use the tank-transfer demo.</p>`;
      return;
    }
    host.innerHTML = items.map((i) => `
      <button type="button" class="ilkRow ${i.id === selectedInterlockId ? "activeSel" : ""}" data-id="${esc(i.id)}">
        <span class="ilkName">${esc(i.name)}<span class="ilkBadge ${esc(i.status)}">${esc(i.status)}</span></span>
        <span class="ilkMeta">${esc(i.actionDescription || "").slice(0, 120)}</span>
      </button>`).join("");
    host.querySelectorAll(".ilkRow").forEach((btn) => {
      btn.onclick = () => selectInterlock(btn.dataset.id);
    });
  }

  function renderIlkDetail() {
    const host = document.getElementById("ilkDetail");
    const title = document.getElementById("ilkDetailTitle");
    const sub = document.getElementById("ilkDetailSub");
    if (!host) return;
    const ilk = (interlocksData?.interlocks || []).find((i) => i.id === selectedInterlockId);
    if (!ilk) {
      if (title) title.textContent = "Select an interlock";
      if (sub) sub.textContent = "See the condition chain and what equipment it inhibits — the whole picture after document promote.";
      host.innerHTML = `<p class="muted">Pick an interlock on the left to open the inside view.</p>
        <p class="warn">${esc(interlocksData?.note || "")}</p>`;
      return;
    }
    if (title) title.textContent = ilk.name;
    if (sub) {
      sub.textContent = `${ilk.status} · ${ilk.dataClass || "—"} · ${(ilk.conditions || []).length} condition(s) · ${(ilk.inhibits || []).length} inhibit(s)`;
    }
    const chain = (ilk.chain || [])
      .map((c) => `<li class="${esc(c.status || "")}"><b>${esc(c.step)}</b> ${esc(c.tag)}
        <div class="muted">${esc(c.detail || "")}${c.value != null && c.value !== "" ? ` · value=${esc(c.value)}` : ""}</div></li>`)
      .join("");
    const inhibits = (ilk.inhibits || [])
      .map((i) => `<li>${esc(i.tag)} <span class="muted">${esc(i.type)}</span></li>`)
      .join("");
    host.innerHTML = `
      <p>${esc(ilk.actionDescription || "")}</p>
      <p><b>Inside chain</b> — condition → action → inhibited equipment</p>
      <ul class="ilkChain">${chain || "<li class='muted'>No chain</li>"}</ul>
      <p><b>Inhibits</b></p>
      <ul class="ilkChain">${inhibits || "<li class='muted'>None</li>"}</ul>
      <div class="cmdRow">
        <button type="button" id="btnIlkHighlight">Highlight on canvas</button>
        <button type="button" id="btnIlkTestEstope" ${/ESD|ESTOP/i.test(ilk.name) ? "" : "hidden"}>Force E-stop trip (sim)</button>
      </div>
      <p class="warn">${esc(interlocksData?.note || "")}</p>`;
    document.getElementById("btnIlkHighlight")?.addEventListener("click", () => {
      applyInterlockHighlight(ilk);
      closeInterlocksPanel({ keepHighlight: true });
      fitViewSoon(2);
      logEvent(`Interlock ${ilk.name} highlighted on canvas (${ilk.status})`, ilk.active ? "alarm" : "ok");
    });
    document.getElementById("btnIlkTestEstope")?.addEventListener("click", async () => {
      try {
        const plant = await resolvePlantTags();
        await sendCommand(plant.estop, false);
        await loadInterlocks();
        selectInterlock(ilk.id);
        logEvent(`E-stop trip forced (sim ${plant.estop}) — refresh Interlocks to see ACTIVE chain`, "alarm");
      } catch (e) {
        logEvent(e.message, "alarm");
      }
    });
  }

  function selectInterlock(id) {
    selectedInterlockId = id;
    const ilk = (interlocksData?.interlocks || []).find((i) => i.id === id);
    applyInterlockHighlight(ilk);
    renderIlkList();
    renderIlkDetail();
  }

  function renderInspectorInterlocks(body, rejectHtml) {
    const items = interlocksData?.interlocks || [];
    if (!items.length) {
      body.innerHTML = `${rejectHtml}<p class="muted">No interlocks involve this equipment.</p>
        <div class="cmdRow"><button type="button" id="btnOpenIlkPanel">Browse all Interlocks</button></div>`;
      document.getElementById("btnOpenIlkPanel")?.addEventListener("click", () => openInterlocksPanel());
      return;
    }
    body.innerHTML = `${rejectHtml}
      <p class="muted">${items.length} interlock(s) · click to open inside view</p>
      <ul class="condList">${items.map((i) =>
        `<li data-ilkid="${esc(i.id)}"><span>${esc(i.name)}</span><span class="st-${i.active ? "fail" : "ok"}">${esc(i.status)}</span></li>`
      ).join("")}</ul>
      <div class="cmdRow"><button type="button" id="btnOpenIlkPanel">Open Interlocks panel</button></div>
      <p class="warn">${esc(interlocksData?.note || "")}</p>`;
    body.querySelectorAll("[data-ilkid]").forEach((li) => {
      li.onclick = () => openInterlocksPanel({ selectId: li.dataset.ilkid });
    });
    document.getElementById("btnOpenIlkPanel")?.addEventListener("click", () => {
      openInterlocksPanel({ equipmentId: selected?.id });
    });
  }

  async function openInterlocksPanel(opts = {}) {
    if (!opts.stayInWorkspace && workspace !== "engineer") {
      setWorkspace("engineer", {
        openInterlocks: true,
        equipmentId: opts.equipmentId,
        selectId: opts.selectId
      });
      return;
    }
    closeEmbed();
    document.getElementById("ingestPanel")?.classList.add("hidden");
    document.getElementById("engineerPanel")?.classList.add("hidden");
    ioPanelPanel?.classList.add("hidden");
    interlocksPanel?.classList.remove("hidden");
    view = "interlocks";
    document.getElementById("viewTitle").textContent = "Engineer · Interlocks";
    document.getElementById("navInterlocks")?.classList.add("active");
    document.getElementById("navEngineerGen")?.classList.remove("active");
    try {
      await loadInterlocks(opts.equipmentId ? { equipmentId: opts.equipmentId } : {});
      if (opts.equipmentId && !(interlocksData?.interlocks || []).length) {
        await loadInterlocks();
      }
      renderIlkList();
      if (opts.selectId) selectInterlock(opts.selectId);
      else if ((interlocksData?.interlocks || []).length) {
        const prefer = opts.equipmentId
          ? (interlocksData.interlocks.find((i) =>
              (i.inhibits || []).some((h) => h.equipmentId === opts.equipmentId || h.id === opts.equipmentId)
            ) || interlocksData.interlocks[0])
          : interlocksData.interlocks[0];
        selectInterlock(prefer.id);
      } else {
        renderIlkDetail();
      }
      logEvent(
        `Interlocks: ${interlocksData?.count || 0} in model · ${interlocksData?.activeCount || 0} active (sim)`,
        interlocksData?.activeCount ? "alarm" : "ok"
      );
    } catch (e) {
      logEvent("Interlocks failed: " + e.message, "alarm");
    }
  }

  function closeInterlocksPanel({ keepHighlight = false } = {}) {
    interlocksPanel?.classList.add("hidden");
    document.getElementById("navInterlocks")?.classList.remove("active");
    if (!keepHighlight) {
      selectedInterlockId = null;
      clearInterlockHighlight();
    }
    if (view === "interlocks" && workspace === "engineer") {
      view = "map";
      viewport.classList.remove("hidden");
      viewport.style.display = "";
      document.getElementById("viewTitle").textContent = "Engineer";
    } else if (view === "interlocks") {
      view = "map";
      viewport.classList.remove("hidden");
      viewport.style.display = "";
    }
  }

  document.getElementById("navInterlocks")?.addEventListener("click", () =>
    setWorkspace("engineer", { openInterlocks: true })
  );
  document.getElementById("navIoMap")?.addEventListener("click", () =>
    setWorkspace("engineer", { openIo: true })
  );
  document.getElementById("navLogicObs")?.addEventListener("click", () => {
    setWorkspace("engineer", { panel: "logic" });
    document.getElementById("advEngineering")?.setAttribute("open", "");
  });
  document.getElementById("navEngineerGen")?.addEventListener("click", () =>
    setWorkspace("engineer", { openEngineer: true })
  );

  function engProjectId() {
    return projectId || "active";
  }

  function renderEngJson(title, data) {
    const body = document.getElementById("engBody");
    if (!body) return;
    body.innerHTML = `<h4>${esc(title)}</h4><pre class="mono engOut">${esc(JSON.stringify(data, null, 2))}</pre>`;
  }

  async function openEngineerPanel(opts = {}) {
    if (!opts.stayInWorkspace && workspace !== "engineer") {
      setWorkspace("engineer", { openEngineer: true });
      return;
    }
    closeEmbed();
    interlocksPanel?.classList.add("hidden");
    ioPanelPanel?.classList.add("hidden");
    document.getElementById("ingestPanel")?.classList.add("hidden");
    const panel = document.getElementById("engineerPanel");
    panel?.classList.remove("hidden");
    view = "engineer_gen";
    viewport.classList.add("hidden");
    document.getElementById("viewTitle").textContent = "Engineer · Controls codegen";
    document.getElementById("navEngineerGen")?.classList.add("active");
    document.getElementById("navInterlocks")?.classList.remove("active");
    logEvent("P6 Engineer panel — preliminary deliverables; approval required", "ok");
  }

  document.getElementById("btnOpenEngineer")?.addEventListener("click", () => openEngineerPanel());
  document.getElementById("btnEngBackIlk")?.addEventListener("click", () =>
    openInterlocksPanel({ stayInWorkspace: true, equipmentId: selected?.id })
  );
  document.getElementById("btnEngTemplates")?.addEventListener("click", async () => {
    try {
      const r = await api(`/api/engineer/projects/${engProjectId()}/templates/apply-defaults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true })
      });
      renderEngJson("Template apply-defaults", r);
      logEvent(`Templates applied (suggestions=${(r.suggestions || []).length})`, "ok");
      await syncRuntime("engineer.templates");
    } catch (e) {
      logEvent("Template apply failed: " + e.message, "alarm");
    }
  });
  document.getElementById("btnEngIo")?.addEventListener("click", async () => {
    try {
      const r = await api(`/api/engineer/projects/${engProjectId()}/io/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const p = r.proposal || {};
      renderEngJson("I/O proposal (no invented addresses)", {
        counts: p.counts,
        honesty: p.honesty,
        missingRequired: p.missingRequired,
        sampleRows: (p.rows || []).slice(0, 24)
      });
      logEvent(`I/O list: DI=${p.counts?.DI} DO=${p.counts?.DO} unassigned=${p.counts?.unassignedHardware}`, "ok");
    } catch (e) {
      logEvent("I/O generate failed: " + e.message, "alarm");
    }
  });
  document.getElementById("btnEngStrategies")?.addEventListener("click", async () => {
    try {
      const r = await api(`/api/engineer/projects/${engProjectId()}/strategies`);
      renderEngJson("Control strategy suggestions", {
        suggestions: r.suggestions,
        missingRequirements: r.missingRequirements,
        topology: r.topology
      });
      logEvent(`Strategies: ${(r.suggestions || []).length} · gaps=${(r.missingRequirements || []).length}`, "ok");
    } catch (e) {
      logEvent("Strategies failed: " + e.message, "alarm");
    }
  });
  document.getElementById("btnEngSt")?.addEventListener("click", async () => {
    try {
      const r = await api(`/api/engineer/projects/${engProjectId()}/st/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: "iec61131_st" })
      });
      const st = r.artifact?.st || "";
      const body = document.getElementById("engBody");
      if (body) {
        body.innerHTML = `<h4>Preliminary ST ${esc(r.artifact?.id || "")}</h4>
          <p class="warn">${esc((r.artifact?.limitations || []).join(" · "))}</p>
          <p class="muted">sample: ${esc(r.samplePath || "n/a")} · deployable=${esc(String(r.deployable))}</p>
          <div class="cmdRow">
            <button type="button" id="btnEngApproveSt">Approve</button>
            <button type="button" id="btnEngRejectSt">Reject</button>
          </div>
          <pre class="mono engOut">${esc(st.slice(0, 12000))}</pre>`;
        document.getElementById("btnEngApproveSt")?.addEventListener("click", async () => {
          try {
            await api(`/api/engineer/projects/${engProjectId()}/logic/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ artifactId: r.artifact.id, decision: "approve", reviewer: "studio" })
            });
            logEvent("ST artifact approved (engineer gate)", "ok");
          } catch (e) {
            logEvent(e.message, "alarm");
          }
        });
        document.getElementById("btnEngRejectSt")?.addEventListener("click", async () => {
          try {
            await api(`/api/engineer/projects/${engProjectId()}/logic/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ artifactId: r.artifact.id, decision: "reject", comment: "Rejected from Studio", reviewer: "studio" })
            });
            logEvent("ST artifact rejected", "alarm");
          } catch (e) {
            logEvent(e.message, "alarm");
          }
        });
      }
      logEvent(`ST generated · ${r.artifact?.id}`, "ok");
    } catch (e) {
      logEvent("ST generate failed: " + e.message, "alarm");
      if (e.data) renderEngJson("ST generate blocked", e.data);
    }
  });
  document.getElementById("btnEngAcceptWt")?.addEventListener("click", async () => {
    try {
      const r = await api(`/api/engineer/projects/${engProjectId()}/acceptance/water-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false })
      });
      renderEngJson("Water-transfer acceptance path", r);
      logEvent(
        r.ok ? `Acceptance path OK · sample=${r.samplePath || "?"}` : `Acceptance gaps: ${(r.gaps || []).join("; ")}`,
        r.ok ? "ok" : "alarm"
      );
    } catch (e) {
      logEvent("Acceptance path failed: " + e.message, "alarm");
      if (e.data) renderEngJson("Acceptance blocked", e.data);
    }
  });
  document.getElementById("btnIlkRefresh")?.addEventListener("click", async () => {
    await loadInterlocks();
    renderIlkList();
    if (selectedInterlockId) selectInterlock(selectedInterlockId);
    else renderIlkDetail();
  });
  document.getElementById("btnIlkShowMap")?.addEventListener("click", () => {
    const ilk = (interlocksData?.interlocks || []).find((i) => i.id === selectedInterlockId);
    if (ilk) applyInterlockHighlight(ilk);
    setWorkspace("simulate");
    fitViewSoon(2);
  });

  // —— In-Studio ingest (P6 Vision / P&ID import wizard) ——
  let ingestCandidates = [];
  let ingestConnections = [];
  let ingestGaps = [];
  let ingestLast = null;
  let ingestObjectUrl = null;
  let ingestSelected = -1;
  let ingestWizardStep = 1;
  const ingestPanel = document.getElementById("ingestPanel");

  function setIngestStep(step) {
    ingestWizardStep = step;
    document.querySelectorAll("#ingestSteps li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("active", n === step);
      li.classList.toggle("done", n < step);
    });
  }

  function openIngestPanel(opts = {}) {
    if (!opts.stayInWorkspace && workspace !== "design") {
      setWorkspace("design", { openIngest: true });
      return;
    }
    closeEmbed();
    closeInterlocksPanel({ keepHighlight: false });
    connectPanel.classList.add("hidden");
    viewport.classList.add("hidden");
    if (toolPanel) toolPanel.classList.add("hidden");
    ingestPanel?.classList.remove("hidden");
    view = "ingest";
    document.getElementById("viewTitle").textContent = "Import P&ID";
    setWorkspaceMode("engineering", { silent: true });
    activeWorkflow = "upload";
    setIngestStep(ingestCandidates.length ? 3 : 1);
  }

  function closeIngestPanel() {
    ingestPanel?.classList.add("hidden");
    if (view === "ingest") {
      view = "map";
      viewport.classList.remove("hidden");
      viewport.style.display = "";
      document.getElementById("viewTitle").textContent = "Design";
    }
  }

  function highlightIngestSource(tag) {
    const src = document.getElementById("ingestSource");
    const text = ingestLast?.extracted?.text || "";
    if (!src || !text) return;
    if (!tag) {
      src.textContent = text;
      return;
    }
    const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    src.innerHTML = esc(text).replace(re, (m) => `<mark>${m}</mark>`);
  }

  function renderIngestConnections() {
    const host = document.getElementById("ingestConnList");
    if (!host) return;
    if (!ingestConnections.length) {
      host.innerHTML = `<p class="muted">No proposed connections — accept tags first, or draw links manually on the canvas after promote.</p>`;
      return;
    }
    host.innerHTML = ingestConnections
      .map(
        (c, i) => `
      <div class="ingestConnRow ${c.ambiguous ? "ambiguous" : ""}">
        <input type="checkbox" data-conn="${i}" ${c.include ? "checked" : ""} title="${c.ambiguous ? "Ambiguous — only include after drawing check" : "Include connection"}" />
        <span>${esc(c.fromTag)} → ${esc(c.toTag)} <span class="muted">(${esc(c.connectionType || "process")})</span>
          ${c.ambiguous ? `<span class="ingestAmbBadge">ambiguous</span>` : ""}
          <div class="muted">${esc(c.reason || "")}</div>
        </span>
        <span class="muted">${esc(String(Math.round((c.confidence || 0) * 100)))}%</span>
      </div>`
      )
      .join("");
    host.querySelectorAll("[data-conn]").forEach((el) => {
      el.onchange = () => {
        const i = Number(el.dataset.conn);
        ingestConnections[i].include = el.checked;
        if (el.checked) setIngestStep(Math.max(ingestWizardStep, 4));
      };
    });
  }

  function renderIngestGaps() {
    const host = document.getElementById("ingestGapList");
    if (!host) return;
    if (!ingestGaps.length) {
      host.innerHTML = `<p class="muted">No open engineering gaps from this extract.</p>`;
      return;
    }
    host.innerHTML =
      `<h4 style="margin:0 0 0.35rem;font-size:0.75rem">Engineering decisions</h4>` +
      ingestGaps
        .map(
          (g) => `
      <div class="ingestGap ${g.severity === "blocker" ? "blocker" : ""}">
        <strong>${esc(g.topic || "Decision")}</strong>
        <div>${esc(g.message || "")}</div>
        ${g.relatedTags?.length ? `<div class="muted">${esc(g.relatedTags.join(", "))}</div>` : ""}
      </div>`
        )
        .join("");
  }

  function renderIngestList() {
    const host = document.getElementById("ingestList");
    if (!host) return;
    if (!ingestCandidates.length) {
      host.innerHTML = `<p class="muted">No equipment rows yet — upload documents and Extract. On failure, use Manual reconstruct.</p>`;
      renderIngestConnections();
      renderIngestGaps();
      return;
    }
    const hideDemo = !!document.getElementById("ingestHideDemo")?.checked;
    const visible = ingestCandidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.status !== "deleted" && (!hideDemo || c.tagOrigin !== "demo_reference"));
    const head = `<div class="ingestRow ingestHead"><span>Inc</span><span>Tag</span><span>Type</span><span>Origin</span><span>Conf</span><span>Src</span></div>`;
    host.innerHTML =
      head +
      visible
        .map(({ c, i }) => {
          const ref = c.sourceRef || (c.sourceRefs && c.sourceRefs[0]) || {};
          const srcLabel = ref.page != null ? `p${ref.page}` : "—";
          return `
      <div class="ingestCand ingestRow ${c.status || ""} ${i === ingestSelected ? "active" : ""}" data-i="${i}">
        <input type="checkbox" data-inc="${i}" ${c.include || c.status === "confirmed" ? "checked" : ""} ${c.status === "deleted" ? "disabled" : ""} />
        <input type="text" data-tag="${i}" value="${esc(c.tag)}" ${c.status === "deleted" ? "disabled" : ""} />
        <select data-type="${i}" ${c.status === "deleted" ? "disabled" : ""}>
          ${LIB_TYPES.map((t) => `<option value="${esc(t.type)}" ${c.type === t.type ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
          <option value="${esc(c.type || "equipment")}" ${!LIB_TYPES.some((t) => t.type === c.type) ? "selected" : ""}>${esc(c.type || "equipment")}</option>
        </select>
        <span class="${c.tagOrigin === "demo_reference" ? "ingestOriginDemo" : "muted"}">${esc(c.tagOrigin === "demo_reference" ? "demo ref" : "extracted")}</span>
        <span class="muted">${esc(String(Math.round((c.confidence || 0) * 100)))}%</span>
        <span class="muted" title="${esc(ref.excerpt || ref.documentName || "")}">${esc(srcLabel)}</span>
      </div>`;
        })
        .join("") +
      (hideDemo && ingestCandidates.some((c) => c.tagOrigin === "demo_reference")
        ? `<p class="muted">Demo/reference tags hidden — uncheck “Hide demo/reference tags” to review training P&amp;ID fixtures.</p>`
        : "");
    host.querySelectorAll(".ingestCand").forEach((row) => {
      row.onclick = (ev) => {
        if (ev.target.closest("input,select")) return;
        ingestSelected = Number(row.dataset.i);
        renderIngestList();
        highlightIngestSource(ingestCandidates[ingestSelected]?.tag);
      };
    });
    host.querySelectorAll("[data-inc]").forEach((el) => {
      el.onchange = () => {
        const i = Number(el.dataset.inc);
        ingestCandidates[i].include = el.checked;
        if (el.checked) ingestCandidates[i].status = "confirmed";
        else if (ingestCandidates[i].status === "confirmed") ingestCandidates[i].status = "proposed";
        setIngestStep(Math.max(ingestWizardStep, 3));
        updateIngestPromoteEnabled();
      };
    });
    host.querySelectorAll("[data-tag]").forEach((el) => {
      el.onchange = () => {
        ingestCandidates[Number(el.dataset.tag)].tag = el.value.trim().toUpperCase();
      };
    });
    host.querySelectorAll("[data-type]").forEach((el) => {
      el.onchange = () => {
        ingestCandidates[Number(el.dataset.type)].type = el.value;
        ingestCandidates[Number(el.dataset.type)].classification = el.value;
      };
    });
    renderIngestConnections();
    renderIngestGaps();
    updateIngestPromoteEnabled();
  }

  function updateIngestPromoteEnabled() {
    const btn = document.getElementById("btnIngestPromote");
    if (btn) {
      btn.disabled = !ingestCandidates.some((c) => c.status !== "deleted" && (c.include || c.status === "confirmed"));
    }
  }

  document.getElementById("btnCloseIngest")?.addEventListener("click", () => {
    closeIngestPanel();
    setWorkspace("design");
  });

  document.getElementById("btnIngestManual")?.addEventListener("click", () => {
    logEvent(
      "Manual reconstruction: place equipment from the library, draw connections, keep source docs as references. No fabricated confidence.",
      "ok"
    );
    closeIngestPanel();
    setWorkspace("design");
    setIngestStep(1);
  });

  document.getElementById("btnIngestExtract")?.addEventListener("click", async () => {
    const input = document.getElementById("ingestFile");
    const fileList = input?.files ? [...input.files] : [];
    if (!fileList.length) return logEvent("Choose one or more P&ID / document files first", "alarm");
    setIngestStep(2);
    document.getElementById("ingestMeta").textContent = `Extracting ${fileList.length} file(s)…`;
    document.getElementById("ingestWarn").textContent = "";
    const prog = document.getElementById("ingestProgress");
    if (prog) {
      prog.hidden = false;
      prog.textContent = "Pipeline: receive → extract → mine → connections → gaps…";
    }
    if (ingestObjectUrl) URL.revokeObjectURL(ingestObjectUrl);
    const prev = document.getElementById("ingestPreview");
    const firstImg = fileList.find((f) => /^image\//.test(f.type) && !/svg/i.test(f.type));
    if (firstImg) {
      ingestObjectUrl = URL.createObjectURL(firstImg);
      prev.src = ingestObjectUrl;
      prev.hidden = false;
    } else {
      prev.removeAttribute("src");
      prev.hidden = true;
    }
    const fd = new FormData();
    fileList.forEach((f, i) => {
      if (i === 0) fd.append("file", f);
      fd.append("files", f);
    });
    const r = await fetch("/api/ingest/ocr", { method: "POST", body: fd });
    ingestLast = await r.json();
    if (!ingestLast.ok && ingestLast.error) {
      document.getElementById("ingestWarn").textContent = ingestLast.error;
      logEvent("Extract failed: " + ingestLast.error + " — use Manual reconstruct", "alarm");
      setIngestStep(1);
      return;
    }
    if (prog && ingestLast.stages) {
      prog.textContent = ingestLast.stages
        .map((s) => `${s.id}:${s.status}${s.candidateCount != null ? `(${s.candidateCount})` : ""}`)
        .join(" → ");
    }
    const ex = ingestLast.extracted || {};
    const isImage = !!ex.unfinished || ex.engine === "tesseract.js";
    const names = (ingestLast.documents || []).map((d) => d.name).join(", ") || fileList.map((f) => f.name).join(", ");
    document.getElementById("ingestMeta").textContent =
      `${names} · engine=${ex.engine || "?"} · conf=${ex.confidence != null ? Math.round(ex.confidence * 100) + "%" : "n/a"} · ${(ingestLast.candidates || []).length} tags · ${(ingestLast.connections || []).length} conn` +
      (isImage ? " · image OCR unfinished" : "");
    const baseWarn =
      ex.warning ||
      ingestLast.note ||
      "Candidates are UNVERIFIED until you confirm and promote. Runtime will rebind after promote.";
    document.getElementById("ingestWarn").textContent = isImage
      ? baseWarn
      : `${baseWarn} Ambiguous connections stay unchecked until you accept them.`;
    document.getElementById("ingestSource").textContent =
      ex.text ||
      (isImage
        ? "(LIMIT: No usable text from scanned image OCR — try a text export, searchable PDF, SVG, or equipment CSV.)"
        : "(No text extracted.)");
    ingestCandidates = (ingestLast.candidates || []).map((c) => ({
      ...c,
      status: "proposed",
      include: !isImage && c.tagOrigin !== "demo_reference" && (c.confidence || 0) >= 0.5
    }));
    ingestConnections = (ingestLast.connections || []).map((c) => ({
      ...c,
      include: !!c.include && !c.ambiguous
    }));
    ingestGaps = ingestLast.gaps || [];
    ingestSelected = -1;
    renderIngestList();
    setIngestStep(ingestCandidates.length ? 3 : 1);
    if (ingestGaps.length) setIngestStep(Math.max(ingestWizardStep, 5));
    const n = ingestCandidates.length;
    if (isImage) {
      pushAlarm(
        n
          ? `Image OCR unfinished — ${n} candidate(s) are UNVERIFIED (prefer text/PDF/SVG/CSV)`
          : "Image OCR unfinished — no usable tags; use text/PDF/SVG/CSV or Manual reconstruct",
        { limit: true }
      );
    }
    const extractMsg = n
      ? `Extracted ${n} candidate tag(s), ${(ingestConnections || []).length} connection proposal(s)${isImage ? " (image OCR unfinished)" : ""}`
      : isImage
        ? "Image OCR returned no tags (unfinished path) — use Manual reconstruct"
        : "No candidate tags found — use Manual reconstruct";
    logEvent(extractMsg, isImage ? "" : n ? "ok" : "alarm");
    activeWorkflow = "review";
  });

  document.getElementById("btnIngestSelectAll")?.addEventListener("click", () => {
    ingestCandidates.forEach((c) => {
      if (c.status === "deleted") return;
      c.include = true;
      c.status = "confirmed";
    });
    setIngestStep(3);
    renderIngestList();
  });

  document.getElementById("btnIngestReject")?.addEventListener("click", () => {
    if (ingestSelected < 0) return logEvent("Select a candidate row to reject", "alarm");
    ingestCandidates[ingestSelected].status = "deleted";
    ingestCandidates[ingestSelected].include = false;
    ingestSelected = -1;
    renderIngestList();
  });

  document.getElementById("btnIngestMerge")?.addEventListener("click", () => {
    const selected = ingestCandidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.status !== "deleted" && (c.include || c.status === "confirmed"));
    if (selected.length < 2) return logEvent("Confirm at least two tags to merge into the first", "alarm");
    const [keep, ...rest] = selected;
    rest.forEach(({ c }) => {
      c.status = "deleted";
      c.include = false;
      keep.c.sourceRefs = [...(keep.c.sourceRefs || [keep.c.sourceRef].filter(Boolean)), c.sourceRef].filter(Boolean);
    });
    logEvent(`Merged ${rest.length} tag(s) into ${keep.c.tag}`, "ok");
    renderIngestList();
  });

  document.getElementById("ingestHideDemo")?.addEventListener("change", () => renderIngestList());

  document.getElementById("btnIngestPromote")?.addEventListener("click", async () => {
    const selected = ingestCandidates.filter((c) => c.status !== "deleted" && (c.include || c.status === "confirmed"));
    if (!selected.length) return logEvent("Confirm at least one equipment row before promote", "alarm");
    const connSelected = ingestConnections.filter((c) => c.include);
    const amb = connSelected.filter((c) => c.ambiguous);
    const approve = !!document.getElementById("ingestApprove")?.checked;
    const tags = selected.map((c) => c.tag).join(", ");
    const ok = window.confirm(
      `Promote ${selected.length} equipment tag(s) and ${connSelected.length} connection(s)?\n\n${tags}\n\n` +
        (amb.length ? `Includes ${amb.length} AMBIGUOUS connection(s) you explicitly checked.\n\n` : "") +
        (approve
          ? "Marked approved: equipment will be ENGINEER_APPROVED."
          : "Not marked approved: equipment stays UNVERIFIED (inference) until you approve in the inspector.")
    );
    if (!ok) {
      logEvent("Promote cancelled — no silent approve", "ok");
      return;
    }
    setIngestStep(6);
    const fileInput = document.getElementById("ingestFile");
    const fileList = fileInput?.files ? [...fileInput.files] : [];
    const retain = !!document.getElementById("ingestRetain")?.checked;
    try {
      let data;
      if (retain && fileList.length) {
        const fd = new FormData();
        fd.append("projectId", projectId || "");
        fd.append("placeOnCanvas", "true");
        fd.append("approveAll", approve ? "true" : "false");
        fd.append("documentName", fileList[0]?.name || "Studio ingest");
        fd.append("equipment", JSON.stringify(selected.map(({ tag, type, sourceRef, sourceRefs }) => ({ tag, type, sourceRef, sourceRefs }))));
        fd.append("connections", JSON.stringify(connSelected));
        fd.append("gaps", JSON.stringify(ingestGaps));
        fileList.forEach((f, i) => {
          if (i === 0) fd.append("file", f);
          fd.append("files", f);
        });
        const r = await fetch("/api/ingest/ocr/promote", {
          method: "POST",
          headers: { "X-P6-Role": "engineer" },
          body: fd
        });
        data = await r.json();
        if (!r.ok) throw new Error(data.error || r.statusText);
      } else {
        data = await api("/api/ingest/ocr/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-P6-Role": "engineer" },
          body: JSON.stringify({
            projectId,
            documentName: fileList[0]?.name || "Studio ingest",
            format: fileList[0]?.type || "unknown",
            placeOnCanvas: true,
            approveAll: approve,
            equipment: selected.map(({ tag, type, sourceRef, sourceRefs }) => ({ tag, type, sourceRef, sourceRefs })),
            connections: connSelected,
            gaps: ingestGaps
          })
        });
      }
      projectId = data.project?.id || projectId;
      logEvent(
        `Promoted ${data.created?.equipment?.length || 0} equipment · ${data.created?.connections?.length || 0} connections · ${data.created?.documents?.length || 0} doc ref(s) · Runtime rebound (${data.runtimeBound?.signalCount ?? "?"} signals)`,
        "ok"
      );
      closeIngestPanel();
      setWorkspace("design");
      await refreshProject();
      await refreshCanvas();
      fitView();
      activeWorkflow = "configure";
    } catch (e) {
      logEvent("Promote failed: " + e.message, "alarm");
    }
  });
  function renderLibrary(filter) {
    const host = document.getElementById("libList");
    if (!host) return;
    const q = String(filter || "").toLowerCase();
    const cats = LIB_CATEGORIES.map((cat) => {
      const items = cat.items.filter(
        (t) =>
          !q ||
          t.type.includes(q) ||
          t.label.toLowerCase().includes(q) ||
          cat.label.toLowerCase().includes(q)
      );
      if (!items.length) return "";
      return `<details class="libCat" ${q || cat.id === "pumps" || cat.id === "tanks" ? "open" : ""}>
        <summary>${esc(cat.label)}</summary>
        <div class="libCatItems">${items
          .map(
            (t) => `<button type="button" class="libItem" draggable="true" data-type="${esc(t.type)}" title="Drag onto canvas">
              <span class="libSym" aria-hidden="true">${symbolSvg(t.type, false, "closed")}</span>
              <span class="libLabel">${esc(t.label)}</span>
            </button>`
          )
          .join("")}</div>
      </details>`;
    }).filter(Boolean);
    host.innerHTML = cats.join("") || `<p class="muted">No library matches.</p>`;
    host.querySelectorAll(".libItem").forEach((btn) => {
      btn.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("application/p6-equipment-type", btn.dataset.type);
        ev.dataTransfer.effectAllowed = "copy";
      });
      btn.addEventListener("dblclick", () => {
        const rect = viewport.getBoundingClientRect();
        dropEquipment(btn.dataset.type, rect.left + rect.width / 2, rect.top + rect.height / 2).catch((e) =>
          logEvent(e.message, "alarm")
        );
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
      enterDiagnosticWorkspace();
      if (workspaceMode !== "diagnostic") {
        document.getElementById("modeHint").textContent = "X-Ray · select equipment for root cause";
      }
      inspTab = "xray";
      [...document.getElementById("inspTabs").querySelectorAll("button")].forEach((x) =>
        x.classList.toggle("active", x.dataset.tab === "xray")
      );
      if (selected) {
        loadXray(selected).then(() => {
          applyXrayPathHighlight();
          syncCanvas(lastCanvas);
          renderInspector();
          if (!userViewLocked) fitViewSoon(2);
        });
      } else {
        xrayData = null;
        if (lastCanvas) syncCanvas(lastCanvas);
        if (!userViewLocked) fitViewSoon(2);
      }
    } else {
      xrayData = null;
      ilkHighlightIds = new Set();
      ilkHighlightActive = false;
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

  document.getElementById("btnConnectMode")?.addEventListener("click", () => {
    setWorkspace("design");
    setConnectMode(!connectMode);
  });
  document.getElementById("btnSymPid")?.addEventListener("click", () => setSymbolMode("pid", { user: true }));
  document.getElementById("btnSymScada")?.addEventListener("click", () => setSymbolMode("scada", { user: true }));
  document.getElementById("chkShowPorts")?.addEventListener("change", (e) => {
    showPorts = !!e.target.checked;
    if (lastCanvas) patchSelectionStyles();
  });
  setSymbolMode(symbolMode, { silent: true });
  document.getElementById("btnXray")?.addEventListener("click", () => {
    if (workspace !== "simulate") setWorkspace("simulate");
    setXrayMode(!xrayMode);
  });
  document.getElementById("btnVerify")?.addEventListener("click", () => {
    setWorkspace("verify");
    runFat().catch((e) => logEvent(e.message, "alarm"));
  });
  document.getElementById("navVerify")?.addEventListener("click", () => {
    setWorkspace("verify");
    runFat().catch((e) => logEvent(e.message, "alarm"));
  });
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

  document.getElementById("btnWizardClose").onclick = closeWizard;
  document.getElementById("btnWizardBack").onclick = () => {
    if (wizardStep > 1) {
      wizardStep -= 1;
      renderWizard();
    }
  };
  document.getElementById("btnWizardSkip").onclick = () => wizardAdvance(true).catch((e) => logEvent(e.message, "alarm"));
  document.getElementById("btnWizardNext").onclick = () => wizardAdvance(false).catch((e) => logEvent(e.message, "alarm"));

  function setWorkspaceMode(mode, opts = {}) {
    const next = ["engineering", "simulation", "diagnostic"].includes(mode) ? mode : "simulation";
    workspaceMode = next;
    studio.classList.toggle("mode-engineering", next === "engineering");
    studio.classList.toggle("mode-simulation", next === "simulation");
    studio.classList.toggle("mode-diagnostic", next === "diagnostic");
    document.querySelectorAll("[data-wsmode]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-wsmode") === next);
    });
    if (opts.silent) {
      if (next === "diagnostic") refreshLogicStatus().catch(() => {});
      else if (xrayMode && next !== "diagnostic") { /* keep caller control */ }
      if (lastCanvas) syncCanvas(lastCanvas);
      return;
    }
    if (next === "diagnostic") {
      enterDiagnosticWorkspace();
      setXrayMode(true);
      refreshLogicStatus().catch(() => {});
      if (!selected) renderInspectorEmptyLogic();
    } else {
      if (xrayMode) setXrayMode(false);
      if (lastCanvas) syncCanvas(lastCanvas);
    }
  }

  // Autosave layout after idle (+ local recovery draft)
  const autosaveTimer = setInterval(() => {
    if (!layoutDirty) return;
    persistAutosaveDraft();
    saveLayout().catch(() => {});
  }, 15000);

  const params = new URLSearchParams(location.search);
  async function boot() {
    applyTransform();
    const wsParam = params.get("ws") || params.get("workspace");
    const modeParam = params.get("mode");
    let initialWs = "design";
    if (wsParam) initialWs = normalizeWorkspace(wsParam);
    else if (modeParam === "simulation") initialWs = "simulate";
    else if (modeParam === "diagnostic") initialWs = "simulate";
    else if (modeParam === "engineering" || params.get("demo") === "1") initialWs = "design";
    setWorkspace(initialWs);
    await refreshProject();
    await refreshProjectList();
    // Always bind Runtime to the active Studio project (fixes Water Transfer canvas vs Tank Transfer PLC mismatch)
    await syncRuntime("boot").catch((e) => logEvent(`Boot bind: ${e.message}`, "alarm"));
    await refreshStatus();
    await refreshCanvas();
    tryRestoreAutosave();
    await loadPlatformLimits();
    await refreshIlkCorners();
    updateStatusChips();
    fitViewSoon(4, { force: true });
    logEvent("P6 Studio ready — Design · Engineer · Simulate · Verify & Export · same model across views", "ok");
    if (params.get("demo") === "1") {
      await api("/api/runtime/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      logEvent("Sample plant: runtime started", "ok");
      await refreshStatus();
      await refreshCanvas();
      fitViewSoon(3, { force: true });
    }
    if (params.get("wizard") === "1" || params.get("scratch") === "1") openWizard(1);
    if (params.get("ingest") === "1") setWorkspace("design", { openIngest: true });
  }

  boot().catch((e) => logEvent("Boot failed: " + e.message, "alarm"));

  // Re-fit when the browser window changes size (skips when user has manually zoomed/panned)
  let resizeFitTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeFitTimer);
    resizeFitTimer = setTimeout(() => {
      if (!userViewLocked) fitViewSoon(2);
    }, 140);
  });

  // Separate poll from paint: Runtime fetch ~400ms; visuals via rAF
  const pollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshStatus();
    refreshCanvas().catch(() => {});
    refreshEvents();
    ilkPollTick += 1;
    // Keep top-left interlock locks live without hammering every frame
    if (ilkPollTick % 5 === 0) refreshIlkCorners();
  }, 400);

  window.addEventListener("beforeunload", (ev) => {
    if (layoutDirty) persistAutosaveDraft();
    destroyed = true;
    clearInterval(pollTimer);
    clearInterval(autosaveTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (layoutDirty) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && lastCanvas) scheduleVisualFrame();
  });
})();
