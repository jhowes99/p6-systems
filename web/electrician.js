const elControls = document.getElementById("controls");
const elDevices = document.getElementById("devices");
const elLogic = document.getElementById("logicList");
const elScan = document.getElementById("scanInfo");
const elProjectInfo = document.getElementById("projectInfo");

async function apiState() {
  const r = await fetch("/api/state");
  return r.json();
}
async function apiProgram() {
  const r = await fetch("/api/program");
  return r.json();
}
async function apiLastProject() {
  const r = await fetch("/api/project/last");
  return r.json();
}
async function setInput(name, value) {
  const r = await fetch(`/api/input/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value })
  });
  return r.json();
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function isSafetyText(s) {
  const t = String(s ?? "").toLowerCase();
  return t.includes("e-stop") || t.includes("estop") || t.includes("emergency") || t.includes("overload") || t.includes("safety") || t.includes("guard") || t.includes("door");
}

function resolveVarValue(varName, s) {
  const bank = varName?.[0];
  if (bank === "I") return !!s.inputs?.[varName];
  if (bank === "Q") return !!s.outputs?.[varName];
  if (bank === "M") return !!s.mem?.[varName];
  return false;
}

function evalExpr(expr, s) {
  if (!expr) return false;
  if (typeof expr === "boolean") return !!expr;
  if (expr.var) return resolveVarValue(expr.var, s);
  if (expr.op === "NOT") return !evalExpr(expr.x, s);
  if (expr.op === "AND") return evalExpr(expr.a, s) && evalExpr(expr.b, s);
  if (expr.op === "OR") return evalExpr(expr.a, s) || evalExpr(expr.b, s);
  return false;
}

function exprToPlain(expr, nameForVar) {
  if (!expr) return "FALSE";
  if (typeof expr === "boolean") return expr ? "TRUE" : "FALSE";
  if (expr.var) return nameForVar(expr.var);
  if (expr.op === "NOT") return `NOT (${exprToPlain(expr.x, nameForVar)})`;
  if (expr.op === "AND") return `(${exprToPlain(expr.a, nameForVar)}) AND (${exprToPlain(expr.b, nameForVar)})`;
  if (expr.op === "OR") return `(${exprToPlain(expr.a, nameForVar)}) OR (${exprToPlain(expr.b, nameForVar)})`;
  return "FALSE";
}

function actionTargets(actions) {
  const out = [];
  for (const a of actions || []) {
    if (a.type === "COIL" || a.type === "SET" || a.type === "RESET") out.push(a.target);
    else if (a.type === "TON" && a.doneTarget) out.push(a.doneTarget);
  }
  return out;
}

function buildLabelMaps(project, ir) {
  // Map address -> label info
  const addrToTag = {};
  const addrToNice = {};

  // From IR ioMap: signalName (tag-ish) -> address (I/Q/M)
  const ioMap = ir?.ioMap || ir?.metadata?.ioMap || ir?.io_map || {};
  for (const [signal, addr] of Object.entries(ioMap)) {
    addrToTag[addr] = signal;
  }

  // From last project IO entries: use Service/Location for friendly label
  for (const e of project?.ioEntries || []) {
    // If project stored tag->address mapping, prefer it; else find by matching tag in addrToTag values
    const tag = e.tag;
    // best-effort: locate address by searching addrToTag
    let addr = null;
    for (const [a, sig] of Object.entries(addrToTag)) {
      if (String(sig).toUpperCase() === String(tag).toUpperCase()) { addr = a; break; }
    }
    if (!addr) continue;
    const nice = e.service || e.instrumentType || e.location || tag;
    addrToNice[addr] = nice;
  }

  function nameForVar(v) {
    const tag = addrToTag[v] || v;
    const nice = addrToNice[v];
    if (nice && nice !== tag) return `${tag} — ${nice}`;
    return tag;
  }

  return { ioMap, addrToTag, addrToNice, nameForVar };
}

function renderControls(state, maps) {
  // All inputs (I*) become big buttons (toggle)
  const inputs = Object.keys(state.inputs || {}).sort((a, b) => a.localeCompare(b));
  elControls.innerHTML = "";
  for (const i of inputs) {
    const on = !!state.inputs[i];
    const label = maps.nameForVar(i);
    const safety = isSafetyText(label) || isSafetyText(maps.addrToTag?.[i]);
    const tile = document.createElement("div");
    tile.className = `tile ${safety ? "safety" : ""}`;
    tile.innerHTML = `
      <div class="tileTop">
        <div>
          <div class="name">${esc(label)}</div>
          <div class="meta metaRow">
            <span class="tag">${esc(i)}</span>
            ${safety ? `<span class="badge dot safety">SAFETY</span>` : `<span class="badge dot control">CONTROL</span>`}
            <span>Input</span>
          </div>
        </div>
        <div class="lamp ${on ? "on" : "off"}" title="${on ? "ON" : "OFF"}"></div>
      </div>
      <button class="btnBig ${on ? "" : "secondary"}">${on ? "Turn OFF" : "Turn ON"}</button>
    `;
    tile.querySelector("button").onclick = () => setInput(i, !on);
    elControls.appendChild(tile);
  }
}

function renderDevices(state, maps) {
  const outputs = Object.keys(state.outputs || {}).sort((a, b) => a.localeCompare(b));
  elDevices.innerHTML = "";
  for (const q of outputs) {
    const on = !!state.outputs[q];
    const label = maps.nameForVar(q);
    const safety = isSafetyText(label) || isSafetyText(maps.addrToTag?.[q]);
    const tile = document.createElement("div");
    tile.className = `tile ${safety ? "safety" : ""}`;
    tile.innerHTML = `
      <div class="tileTop">
        <div>
          <div class="name">${esc(label)}</div>
          <div class="meta metaRow">
            <span class="tag">${esc(q)}</span>
            ${safety ? `<span class="badge dot safety">SAFETY</span>` : `<span class="badge dot control">CONTROL</span>`}
            <span>Output</span>
          </div>
        </div>
        <div class="lamp ${on ? "on" : "off"}" title="${on ? "ON" : "OFF"}"></div>
      </div>
      <div class="meta">Status: <strong>${on ? "ON" : "OFF"}</strong></div>
    `;
    elDevices.appendChild(tile);
  }
}

function renderLogic(state, ir, maps) {
  const rungs = [];
  for (const net of ir?.networks || []) for (const rung of net?.rungs || []) rungs.push(rung);

  elLogic.innerHTML = "";
  if (!rungs.length) {
    elLogic.innerHTML = `<div class="logicItem">No program loaded yet. Upload one from P&amp;ID Import or Editor.</div>`;
    return;
  }

  rungs.forEach((r, idx) => {
    const powered = evalExpr(r.cond, state);
    const condTxt = exprToPlain(r.cond, maps.nameForVar);
    const targets = actionTargets(r.actions).map(t => maps.nameForVar(t));
    const item = document.createElement("div");
    item.className = "logicItem";
    item.innerHTML = `
      <div class="when">${powered ? `<span class="pill active">ACTIVE</span>` : ""}When: ${esc(condTxt)}</div>
      <div class="then">Then: ${targets.length ? targets.map(t => `<span class="pill">${esc(t)}</span>`).join(" ") : "<em>(no outputs)</em>"}</div>
    `;
    elLogic.appendChild(item);
  });
}

let cachedIR = null;
let cachedProject = null;

async function loop() {
  try {
    const [s, p, proj] = await Promise.all([apiState(), apiProgram(), apiLastProject()]);
    elScan.textContent = `— scan ${s.scanMs}ms`;
    cachedIR = p?.ir || cachedIR || {};
    cachedProject = proj?.project || cachedProject;

    const maps = buildLabelMaps(cachedProject, cachedIR);

    if (cachedProject?.createdAt) {
      elProjectInfo.innerHTML = `Loaded labels from last Project Bundle import (${esc(cachedProject.createdAt)}).`;
    } else {
      elProjectInfo.innerHTML = `No Project Bundle labels found yet. Use P&amp;ID Import → Project Bundle for best labels.`;
    }

    renderControls(s, maps);
    renderDevices(s, maps);
    renderLogic(s, cachedIR, maps);
  } catch (e) {
    elProjectInfo.innerHTML = `<span style="color:#b00;">Error: ${esc(String(e?.message || e))}</span>`;
  } finally {
    setTimeout(loop, 400);
  }
}

loop();

