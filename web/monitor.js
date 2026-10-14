const elInputs = document.getElementById("inputs");
const elOutputs = document.getElementById("outputs");
const elMem = document.getElementById("mem");
const elStatus = document.getElementById("status");
const scanInfo = document.getElementById("scanInfo");
const plcBadge = document.getElementById("plcBadge");
const scanBeat = document.getElementById("scanBeat");
const inhibInfo = document.getElementById("inhibInfo");
const featureInfo = document.getElementById("featureInfo");
const diagramSvg = document.getElementById("diagramSvg");
const diagramHint = document.getElementById("diagramHint");
const diagramExplain = document.getElementById("diagramExplain");
const elExplainSel = document.getElementById("explainSel");
const elExplainLive = document.getElementById("explainLive");
const elExplainPanel = document.getElementById("explainPanel");
const elFaultVar = document.getElementById("faultVar");
const elFaultMode = document.getElementById("faultMode");
const elFaultValue = document.getElementById("faultValue");
const elFaultErr = document.getElementById("faultErr");
const elFaultList = document.getElementById("faultList");
const btnFaultSet = document.getElementById("btnFaultSet");
const btnFaultClear = document.getElementById("btnFaultClear");
const elInterlocks = document.getElementById("interlocks");
const elInterlockDetail = document.getElementById("interlockDetail");
const elInterlockDetailTitle = document.getElementById("interlockDetailTitle");
const elInterlockSummary = document.getElementById("interlockSummary");
const elInterlockPerms = document.getElementById("interlockPerms");
const elInterlockTrips = document.getElementById("interlockTrips");
const elInterlockSafety = document.getElementById("interlockSafety");
const elInterlockWriters = document.getElementById("interlockWriters");
const btnInterlockDetailClose = document.getElementById("interlockDetailClose");

async function apiProgram() {
  const r = await fetch("/api/program");
  return r.json();
}
async function apiLastProject() {
  const r = await fetch("/api/project/last");
  return r.json();
}

async function apiState() {
  const r = await fetch("/api/state");
  return r.json();
}
async function apiFeatures() {
  const r = await fetch("/api/features");
  return r.json();
}
async function apiExplainOutput(varName) {
  const r = await fetch(`/api/explain/output/${encodeURIComponent(varName)}`);
  return r.json();
}
async function apiFaults() {
  const r = await fetch("/api/faults");
  return r.json();
}
async function apiSetFault({ varName, mode, value }) {
  const r = await fetch("/api/fault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ var: varName, mode, value })
  });
  return r.json();
}
async function apiClearFault(varName) {
  const r = await fetch(`/api/fault/${encodeURIComponent(varName)}`, { method: "DELETE" });
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
async function setAnalog(name, value) {
  const r = await fetch(`/api/analog/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value })
  });
  return r.json();
}

function renderBank(container, bank, clickable, onClick) {
  if (!container) return;
  container.innerHTML = "";
  Object.entries(bank).forEach(([k, v]) => {
    const b = document.createElement("button");
    b.className = `btn ${v ? "on" : "off"}`;
    b.textContent = `${k}: ${v ? "ON" : "OFF"}`;
    if (clickable) b.onclick = () => onClick(k, !v);
    container.appendChild(b);
  });
}

function renderAnalog(state) {
  const elAI = document.getElementById("analogInputs");
  const elAO = document.getElementById("analogOutputs");
  if (!elAI || !elAO) return;
  const ai = state?.analogInputs || {};
  const ao = state?.analogOutputs || {};
  const names = ["A0", "A1", "A2", "A3"];
  elAI.innerHTML = names.map((name) => {
    const val = Number(ai[name]) ?? 0;
    return `<label class="analogLabel"><span>${name}</span><input type="range" min="0" max="100" value="${val}" data-var="${name}" class="analogSlider"> <span class="analogVal">${val}</span></label>`;
  }).join("");
  elAI.querySelectorAll(".analogSlider").forEach((sl) => {
    sl.oninput = () => {
      const v = Number(sl.value);
      sl.nextElementSibling.textContent = v;
      setAnalog(sl.dataset.var, v);
    };
  });
  elAO.innerHTML = names.map((name) => {
    const bName = name.replace("A", "B");
    const val = Number(ao[bName]) ?? 0;
    return `<span class="analogDisplay">${bName}: <strong>${val}</strong></span>`;
  }).join("");
}

let selectedOutput = null;
let lastExplain = null;
let lastFaults = [];
let lastFaultsPollAt = 0;
let lastExplainPollAt = 0;
let lastScanSamples = null;
let beatOn = false;
let lastInterlockUpdate = 0;
let lastInterlockExplain = {};

let writerMap = new Map(); // targetVar -> [{ rungIdx, rung }]

// Load and display goal
function updateGoalDisplay() {
  const elGoal = document.getElementById("goalText");
  if (!elGoal) return;
  const goal = localStorage.getItem("project.goal") || null;
  if (goal) {
    elGoal.textContent = goal;
  } else {
    // Try to get from program metadata
    apiProgram().then(prog => {
      const metaGoal = prog?.ir?.metadata?.goal || null;
      if (metaGoal) {
        elGoal.textContent = metaGoal;
        localStorage.setItem("project.goal", metaGoal);
      } else {
        elGoal.textContent = "No goal set. Import a P&ID to set a goal.";
      }
    }).catch(() => {
      elGoal.textContent = "No goal set. Import a P&ID to set a goal.";
    });
  }
}

function faultsToMap(faults) {
  const m = new Map();
  for (const f of faults || []) if (f?.var) m.set(String(f.var), f);
  return m;
}

function isInhibited(varName, state) {
  // Inhibited = output is OFF, there are writer rungs, and none of their conditions are currently satisfied.
  if (!writerMap.has(varName)) return false;
  if (resolveVarValue(varName, state)) return false;
  const writers = writerMap.get(varName) || [];
  if (!writers.length) return false;
  return !writers.some(w => evalExpr(w.rung.cond, state));
}

function renderOutputs(outputs, faultsMap, state) {
  elOutputs.innerHTML = "";
  if (!outputs || Object.keys(outputs).length === 0) {
    elOutputs.innerHTML = `<div class="small" style="padding: 12px; color: #666;">No outputs found. Upload a program from the Build page to see outputs here.</div>`;
    return;
  }
  let inhibitedCount = 0;
  Object.entries(outputs).forEach(([k, v]) => {
    const b = document.createElement("button");
    const f = faultsMap.get(k);
    const inhib = state ? isInhibited(k, state) : false;
    if (inhib) inhibitedCount++;
    b.className = `btn ${v ? "on" : "off"} ${selectedOutput === k ? "sel" : ""} ${f ? "forced" : ""}`;
    b.textContent =
      `${k}: ${v ? "ON" : "OFF"}` +
      `${f ? ` (${String(f.mode).toUpperCase()})` : ""}` +
      `${inhib ? " (INHIBITED)" : ""}`;
    b.onclick = () => {
      selectedOutput = k;
      lastExplain = null;
      renderExplain(null);
    };
    elOutputs.appendChild(b);
  });
  if (inhibInfo) {
    inhibInfo.textContent = inhibitedCount ? `· inhibited ${inhibitedCount}` : "";
    inhibInfo.className = inhibitedCount ? "pill inhib" : "small";
  }
}

function fmtMs(n) {
  const x = Number(n || 0);
  if (!isFinite(x)) return "0";
  return x >= 10 ? x.toFixed(1) : x.toFixed(2);
}

function renderExplain(explain) {
  if (!selectedOutput) {
    elExplainSel.textContent = "None";
    elExplainLive.textContent = "";
    elExplainPanel.textContent = "Click an output to see “this output is inhibited because…”.";
    return;
  }
  elExplainSel.textContent = selectedOutput;
  if (!explain) {
    elExplainLive.textContent = "loading…";
    return;
  }
  elExplainLive.textContent = "";
  if (!explain.ok) {
    elExplainPanel.textContent = `Error: ${explain.error || "failed to explain output"}`;
    return;
  }

  const lines = [];
  lines.push(`${explain.var} is ${explain.value ? "ON" : "OFF"}`);
  if (explain.safetyChain?.length) {
    const s = explain.safetyChain.map(x => `${x.label}: ${x.value ? "OK" : "TRIP"}`).join(" · ");
    lines.push(`Safety chain: ${s}`);
  }

  if (explain.explanation?.status === "on") {
    const ars = explain.explanation.activeRungs || [];
    if (ars.length) {
      lines.push(`Active rungs: ${ars.map(r => `#${r.rungIndex + 1}`).join(", ")}`);
      ars.slice(0, 6).forEach(r => lines.push(`- Rung ${r.rungIndex + 1}: ${r.conditionText}`));
    } else {
      lines.push("No active rung found writing this output (it may be held by previous state or another action type).");
    }
  } else {
    const rs = explain.explanation?.reasons || [];
    if (!rs.length) {
      lines.push("No writer rungs found, or conditions are satisfied but output is still OFF.");
    } else {
      rs.slice(0, 6).forEach(r => {
        lines.push(`- Rung ${r.rungIndex + 1}: ${r.conditionText}`);
        const bl = r.blockers || [];
        if (bl.length) lines.push(`  Blocking: ${bl.map(b => b.text || b.label || b.var || "blocker").join(" · ")}`);
      });
    }
  }

  elExplainPanel.textContent = lines.join("\n");
}

function renderFaults(faults) {
  elFaultList.innerHTML = "";
  const list = faults || [];
  if (!list.length) {
    elFaultList.innerHTML = `<div class="small">No active faults.</div>`;
    return;
  }
  for (const f of list) {
    const row = document.createElement("div");
    row.className = "faultItem";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span class="pill">${escapeHtml(f.var)}</span>
      <span class="pill ${f.value ? "on" : "off"}">${f.value ? "ON" : "OFF"}</span>
      <span class="pill active">${escapeHtml(String(f.mode || "").toUpperCase())}</span>
    `;
    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.textContent = "Clear";
    btn.onclick = async () => {
      const r = await apiClearFault(f.var);
      if (!r.ok) elFaultErr.textContent = r.error || "Failed to clear fault";
      else elFaultErr.textContent = "";
    };
    row.appendChild(meta);
    row.appendChild(btn);
    elFaultList.appendChild(row);
  }
}

// Collect outputs from IR
function collectOutputs(ir) {
  const outputs = new Map();
  for (const net of ir?.networks || []) {
    for (const rung of net?.rungs || []) {
      for (const a of rung.actions || []) {
        if ((a.type === "COIL" || a.type === "SET" || a.type === "RESET") && String(a.target || "").match(/^[QM]\d+$/)) {
          outputs.set(a.target, {
            var: a.target,
            type: a.type
          });
        }
      }
    }
  }
  return Array.from(outputs.values()).sort((a, b) => a.var.localeCompare(b, undefined, { numeric: true }));
}

// Helper to create chip elements
function chip(text, kind) {
  const s = document.createElement("span");
  s.className = `pill ${kind || ""}`.trim();
  s.textContent = text;
  return s;
}

let selectedInterlockVar = null;
let lastInterlockDetailExplain = null;

// Render detailed interlock explanation
async function renderInterlockDetail(varName, ir) {
  if (!elInterlockDetail || !varName) {
    if (elInterlockDetail) elInterlockDetail.style.display = "none";
    return;
  }
  
  selectedInterlockVar = varName;
  elInterlockDetail.style.display = "block";
  
  // Get tag name
  const addrToTag = {};
  for (const [tag, addr] of Object.entries(ir?.ioMap || {})) {
    addrToTag[addr] = tag;
  }
  const tagName = addrToTag[varName] || varName;
  elInterlockDetailTitle.textContent = `${tagName} (${varName})`;
  
  // Show loading
  elInterlockSummary.textContent = "Loading...";
  elInterlockPerms.innerHTML = "";
  elInterlockTrips.innerHTML = "";
  elInterlockSafety.innerHTML = "";
  elInterlockWriters.innerHTML = "";
  
  try {
    const explain = await apiExplainOutput(varName);
    lastInterlockDetailExplain = explain;
    
    if (!explain.ok) {
      elInterlockSummary.textContent = `Error: ${explain.error || "Failed to explain output"}`;
      return;
    }
    
    const val = !!explain.value;
    elInterlockSummary.textContent = `${varName} is ${val ? "ON" : "OFF"}\n${explain.explanation?.message || ""}`.trim();
    
    // Extract permissives and trips
    const perms = [];
    const trips = [];
    for (const r of (explain.explanation?.reasons || [])) {
      for (const b of (r.blockers || [])) {
        if (b.type === "trip") trips.push(b);
        else perms.push(b);
      }
    }
    
    // Unique items
    const uniq = (arr) => {
      const seen = new Set();
      const out = [];
      for (const x of arr) {
        const k = String(x?.var || x?.label || x?.text || "");
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
      return out;
    };
    
    // Permissives
    elInterlockPerms.innerHTML = "";
    const up = uniq(perms);
    if (!up.length) {
      elInterlockPerms.appendChild(chip(val ? "Satisfied" : "None detected", val ? "on" : "off"));
    } else {
      up.slice(0, 12).forEach(p => elInterlockPerms.appendChild(chip(p.text || p.label || p.var, "off")));
    }
    
    // Trips
    elInterlockTrips.innerHTML = "";
    const ut = uniq(trips);
    if (!ut.length) {
      elInterlockTrips.appendChild(chip(val ? "None" : "None detected", "on"));
    } else {
      ut.slice(0, 12).forEach(t => elInterlockTrips.appendChild(chip(t.text || t.label || t.var, "off")));
    }
    
    // Safety chain
    elInterlockSafety.innerHTML = "";
    const sc = explain.safetyChain || [];
    if (!sc.length) {
      elInterlockSafety.appendChild(chip("No safety tags detected", "off"));
    } else {
      sc.forEach(s => elInterlockSafety.appendChild(chip(`${s.label}: ${s.value ? "OK" : "TRIP"}`, s.value ? "on" : "off")));
    }
    
    // Writer rungs
    elInterlockWriters.innerHTML = "";
    const writers = explain.writers || [];
    if (!writers.length) {
      elInterlockWriters.innerHTML = `<div class="small">No rungs found writing this output.</div>`;
    } else {
      const writerList = writers.slice(0, 8).map(w => {
        return `<div style="padding: 8px; margin-bottom: 6px; border: 1px solid rgba(15,23,42,.1); border-radius: 8px; background: ${w.condPower ? "rgba(22,163,74,.05)" : "rgba(15,23,42,.02)"};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong>Rung ${Number(w.rungIndex) + 1}</strong>
            <span class="pill ${w.condPower ? "on" : "off"}">${w.condPower ? "POWERED" : "no power"}</span>
          </div>
          <div class="small" style="color: #666;">${escapeHtml(w.condText || "")}</div>
        </div>`;
      }).join("");
      elInterlockWriters.innerHTML = writerList;
    }
  } catch (e) {
    elInterlockSummary.textContent = `Error: ${String(e?.message || e)}`;
  }
}

// Render interlocks view (throttled to avoid too many API calls)
async function renderInterlocks(ir, state) {
  if (!elInterlocks) return;
  
  // Throttle explain API calls to every 2 seconds
  const now = Date.now();
  const shouldUpdateExplains = (now - lastInterlockUpdate) > 2000;
  
  elInterlocks.innerHTML = "";
  
  const outputs = collectOutputs(ir || {});
  if (!outputs.length) {
    elInterlocks.innerHTML = `<div class="small">No outputs found. Upload a program to see interlocks.</div>`;
    if (elInterlockDetail) elInterlockDetail.style.display = "none";
    return;
  }
  
  for (const out of outputs) {
    const val = out.var.startsWith("Q") ? !!(state?.outputs?.[out.var]) : !!(state?.mem?.[out.var]);
    
    // Get explanation (cached and throttled)
    let explain = lastInterlockExplain[out.var];
    if (shouldUpdateExplains || !explain) {
      try {
        explain = await apiExplainOutput(out.var);
        lastInterlockExplain[out.var] = explain;
      } catch (e) {
        explain = { ok: false, error: String(e) };
      }
    }
    
    const card = document.createElement("div");
    card.className = `interlockCard ${val ? "on" : "off"} ${selectedInterlockVar === out.var ? "selected" : ""}`;
    card.style.cursor = "pointer";
    
    // Extract blockers/permissives from explanation
    const blockers = [];
    if (explain?.ok && explain.explanation?.reasons) {
      for (const r of explain.explanation.reasons) {
        for (const b of r.blockers || []) {
          blockers.push({
            text: b.text || b.label || b.var,
            satisfied: false
          });
        }
      }
    }
    
    // Get tag name from ioMap
    const addrToTag = {};
    for (const [tag, addr] of Object.entries(ir?.ioMap || {})) {
      addrToTag[addr] = tag;
    }
    const tagName = addrToTag[out.var] || out.var;
    
    card.innerHTML = `
      <div class="interlockHeader">
        <div class="interlockTitle">${escapeHtml(tagName)}</div>
        <div class="interlockStatus ${val ? "on" : "off"}">${val ? "ON" : "OFF"}</div>
      </div>
      <div class="small" style="color: var(--muted); margin-top: 4px;">${escapeHtml(out.var)}</div>
      ${blockers.length ? `
        <div class="interlockPerms">
          ${blockers.slice(0, 3).map(b => `
            <div class="permItem ${b.satisfied ? "satisfied" : "blocking"}">
              <span class="permDot"></span>
              ${escapeHtml(b.text)}
            </div>
          `).join("")}
          ${blockers.length > 3 ? `<div class="small" style="margin-top:4px;">+${blockers.length - 3} more (click for details)</div>` : ""}
        </div>
      ` : val ? `<div class="small" style="color:#166534; margin-top:8px;">✅ All conditions satisfied</div>` : `<div class="small" style="color:#9a3412; margin-top:8px;">Blocked by conditions (click for details)</div>`}
    `;
    
    // Add click handler to show details
    card.onclick = () => {
      renderInterlockDetail(out.var, ir);
      // Update selected state
      document.querySelectorAll(".interlockCard").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    };
    
    elInterlocks.appendChild(card);
  }
  
  if (shouldUpdateExplains) {
    lastInterlockUpdate = now;
  }
}

// ---------------- Diagram (simple Ladder IR graph) ----------------
let diagramModel = null;
let lastProgramSig = "";
let lastProject = null;
let nameForVar = (v) => v;

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function buildNameForVar(project, ir) {
  const addrToTag = {};
  const addrToNice = {};

  const ioMap = ir?.ioMap || {};
  for (const [signal, addr] of Object.entries(ioMap)) addrToTag[addr] = signal;

  for (const e of project?.ioEntries || []) {
    const tag = String(e.tag || "").toUpperCase();
    let addr = null;
    for (const [a, sig] of Object.entries(addrToTag)) {
      if (String(sig).toUpperCase() === tag) { addr = a; break; }
    }
    if (!addr) continue;
    const nice = e.service || e.instrumentType || e.location || e.tag;
    addrToNice[addr] = nice;
  }

  return (v) => {
    const tag = addrToTag[v] || v;
    const nice = addrToNice[v];
    if (nice && nice !== tag) return `${tag} — ${nice}`;
    return tag;
  };
}

function resolveVarValue(varName, state) {
  const bank = varName?.[0];
  if (bank === "I") return !!state.inputs?.[varName];
  if (bank === "Q") return !!state.outputs?.[varName];
  if (bank === "M") return !!state.mem?.[varName];
  return false;
}

function collectVars(expr, outSet) {
  if (!expr) return;
  if (typeof expr === "boolean") return;
  if (expr.var) { outSet.add(expr.var); return; }
  if (expr.op === "NOT") return collectVars(expr.x, outSet);
  if (expr.op === "AND" || expr.op === "OR") { collectVars(expr.a, outSet); collectVars(expr.b, outSet); return; }
  // Ignore unsupported nodes
}

function evalExpr(expr, state) {
  if (!expr) return false;
  if (typeof expr === "boolean") return !!expr;
  if (expr.var) return resolveVarValue(expr.var, state);
  if (expr.op === "NOT") return !evalExpr(expr.x, state);
  if (expr.op === "AND") return evalExpr(expr.a, state) && evalExpr(expr.b, state);
  if (expr.op === "OR") return evalExpr(expr.a, state) || evalExpr(expr.b, state);
  return false;
}

function actionTargets(actions) {
  const targets = [];
  for (const a of actions || []) {
    if (a.type === "COIL" || a.type === "SET" || a.type === "RESET") targets.push(a.target);
    else if (a.type === "TON" && a.doneTarget) targets.push(a.doneTarget);
  }
  return targets;
}

function clearSvg() {
  while (diagramSvg.firstChild) diagramSvg.removeChild(diagramSvg.firstChild);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function buildDiagram(ir) {
  const rungs = [];
  for (const net of ir?.networks || []) for (const rung of net?.rungs || []) rungs.push(rung);

  if (!rungs.length) {
    diagramModel = null;
    diagramHint.textContent = "No program rungs found. Upload a program from the Build page to see the diagram.";
    clearSvg();
    diagramExplain.innerHTML = "";
    // Also clear the last signature so we keep checking for updates
    lastProgramSig = null;
    return;
  }

  // Vars used in conditions and targets
  const condVars = new Set();
  const outVars = new Set();
  for (const rung of rungs) {
    collectVars(rung.cond, condVars);
    for (const t of actionTargets(rung.actions)) outVars.add(t);
  }

  const inputs = Array.from(condVars).filter(v => v.startsWith("I")).sort();
  const memAsInputs = Array.from(condVars).filter(v => v.startsWith("M")).sort();
  const outputs = Array.from(outVars).filter(v => v.startsWith("Q")).sort();
  const memTargets = Array.from(outVars).filter(v => v.startsWith("M")).sort();

  const left = [...inputs, ...memAsInputs];
  const right = [...outputs, ...memTargets];

  // Layout
  const rowH = 28;
  const padY = 16;
  const nodeW = 120;
  const nodeH = 20;
  const xLeft = 20;
  const xRung = 340;
  const xRight = 660;

  const leftCount = Math.max(left.length, 1);
  const rungCount = rungs.length;
  const rightCount = Math.max(right.length, 1);
  const rows = Math.max(leftCount, rungCount, rightCount);
  const height = padY * 2 + rows * rowH;
  diagramSvg.setAttribute("viewBox", `0 0 940 ${Math.max(260, height)}`);
  diagramSvg.style.height = `${Math.max(260, height)}px`;

  const nodePos = new Map(); // id -> {x,y,w,h, kind}

  function yForIdx(i) { return padY + i * rowH; }

  // Titles
  diagramSvg.appendChild(svgEl("text", { x: xLeft, y: 12, class: "d-label" })).textContent = "Inputs / Status";
  diagramSvg.appendChild(svgEl("text", { x: xRung, y: 12, class: "d-label" })).textContent = "Logic";
  diagramSvg.appendChild(svgEl("text", { x: xRight, y: 12, class: "d-label" })).textContent = "Outputs";

  // Left nodes
  left.forEach((name, i) => {
    const y = yForIdx(i);
    nodePos.set(`var:${name}`, { x: xLeft, y, w: nodeW, h: nodeH, kind: "var" });
  });

  // Rung nodes
  rungs.forEach((r, i) => {
    const y = yForIdx(i);
    nodePos.set(`rung:${i}`, { x: xRung, y, w: 140, h: nodeH, kind: "rung" });
  });

  // Right nodes
  right.forEach((name, i) => {
    const y = yForIdx(i);
    nodePos.set(`var:${name}`, { x: xRight, y, w: nodeW, h: nodeH, kind: "var" });
  });

  // Edges
  const edges = []; // {id, from, to, kind, varName?, rungIdx?, target?}
  rungs.forEach((r, i) => {
    const vset = new Set();
    collectVars(r.cond, vset);
    for (const v of Array.from(vset)) {
      if (!nodePos.has(`var:${v}`)) continue; // ignore vars not laid out
      edges.push({ id: `e:${v}->r${i}`, from: `var:${v}`, to: `rung:${i}`, kind: "cond", varName: v, rungIdx: i });
    }
    for (const t of actionTargets(r.actions)) {
      if (!nodePos.has(`var:${t}`)) continue;
      edges.push({ id: `e:r${i}->${t}`, from: `rung:${i}`, to: `var:${t}`, kind: "act", rungIdx: i, target: t });
    }
  });

  clearSvg();

  // SVG defs: arrowheads + subtle shadow
  const defs = svgEl("defs");
  const marker = svgEl("marker", { id: "arrow", markerWidth: 10, markerHeight: 10, refX: 10, refY: 5, orient: "auto" });
  marker.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#94a3b8" }));
  defs.appendChild(marker);
  const shadow = svgEl("filter", { id: "shadow", x: "-10%", y: "-10%", width: "120%", height: "120%" });
  shadow.appendChild(svgEl("feDropShadow", { dx: "0", dy: "1.2", stdDeviation: "1.2", "flood-color": "#000", "flood-opacity": "0.12" }));
  defs.appendChild(shadow);
  diagramSvg.appendChild(defs);

  // Draw edges under nodes
  for (const e of edges) {
    const a = nodePos.get(e.from);
    const b = nodePos.get(e.to);
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const path = svgEl("path", {
      d: `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`,
      class: `d-edge ${e.kind}`,
      "data-edge-id": e.id
    });
    path.setAttribute("marker-end", "url(#arrow)");
    diagramSvg.appendChild(path);
  }

  // Draw nodes
  for (const [id, p] of nodePos.entries()) {
    const g = svgEl("g", { "data-node-id": id });
    const rectClass = id.startsWith("rung:") ? "d-node rung" : "d-node off";
    const rect = svgEl("rect", { x: p.x, y: p.y, width: p.w, height: p.h, rx: 10, ry: 10, class: rectClass, filter: "url(#shadow)" });
    const label = svgEl("text", { x: p.x + 8, y: p.y + 14, class: "d-label" });
    if (id.startsWith("rung:")) label.textContent = `Rung ${Number(id.split(":")[1]) + 1}`;
    else label.textContent = nameForVar(id.split(":")[1]);
    g.appendChild(rect);
    g.appendChild(label);
    diagramSvg.appendChild(g);
  }

  diagramHint.textContent = "Green = ON. Blue = powered rung. Lines darken when active.";

  diagramModel = { ir, rungs, nodePos, edges };

  // Build writer map for output inhibition badges
  writerMap = new Map();
  rungs.forEach((r, i) => {
    for (const t of actionTargets(r.actions)) {
      if (!t) continue;
      const list = writerMap.get(t) || [];
      list.push({ rungIdx: i, rung: r });
      writerMap.set(t, list);
    }
  });
}

function exprToPlain(expr) {
  if (!expr) return "FALSE";
  if (typeof expr === "boolean") return expr ? "TRUE" : "FALSE";
  if (expr.var) return nameForVar(expr.var);
  if (expr.op === "NOT") return `NOT (${exprToPlain(expr.x)})`;
  if (expr.op === "AND") return `(${exprToPlain(expr.a)}) AND (${exprToPlain(expr.b)})`;
  if (expr.op === "OR") return `(${exprToPlain(expr.a)}) OR (${exprToPlain(expr.b)})`;
  return "FALSE";
}

function actionTargets(actions) {
  const targets = [];
  for (const a of actions || []) {
    if (a.type === "COIL" || a.type === "SET" || a.type === "RESET") targets.push(a.target);
    else if (a.type === "TON" && a.doneTarget) targets.push(a.doneTarget);
  }
  return targets;
}

function gatherBlockers(expr, state) {
  // Simple human blockers (best effort):
  // - For AND: union blockers
  // - For OR: only show blockers if the OR is false
  if (!expr) return { ok: false, blockers: [] };
  if (typeof expr === "boolean") return { ok: !!expr, blockers: expr ? [] : ["Condition is FALSE"] };
  if (expr.var) {
    const v = resolveVarValue(expr.var, state);
    return v ? { ok: true, blockers: [] } : { ok: false, blockers: [`${nameForVar(expr.var)} is OFF`] };
  }
  if (expr.op === "NOT") {
    const inner = gatherBlockers(expr.x, state);
    const ok = !inner.ok;
    if (ok) return { ok: true, blockers: [] };
    // inner.ok is true -> NOT makes it false, so blocker is "needs OFF"
    if (expr.x?.var) return { ok: false, blockers: [`${nameForVar(expr.x.var)} is ON (needs OFF)`] };
    return { ok: false, blockers: ["A NOT condition is blocking (needs OFF)"] };
  }
  if (expr.op === "AND") {
    const a = gatherBlockers(expr.a, state);
    const b = gatherBlockers(expr.b, state);
    return { ok: a.ok && b.ok, blockers: [...a.blockers, ...b.blockers] };
  }
  if (expr.op === "OR") {
    const a = gatherBlockers(expr.a, state);
    const b = gatherBlockers(expr.b, state);
    const ok = a.ok || b.ok;
    return { ok, blockers: ok ? [] : [...a.blockers, ...b.blockers] };
  }
  return { ok: false, blockers: ["Unsupported condition"] };
}

function updateDiagramExplain(state) {
  if (!diagramModel) { diagramExplain.innerHTML = ""; return; }
  const rungs = diagramModel.rungs;
  const rows = [];
  rungs.forEach((r, idx) => {
    const powered = evalExpr(r.cond, state);
    const condTxt = exprToPlain(r.cond);
    const tgts = actionTargets(r.actions).map(t => nameForVar(t)).join(", ") || "(no outputs)";
    const trace = gatherBlockers(r.cond, state);
    const blockers = trace.blockers;

    rows.push(`
      <div class="exRow ${powered ? "active" : ""}">
        <div class="exTitle">
          <strong>Rung ${idx + 1}: ${powered ? "ACTIVE" : "inactive"}</strong>
          <span class="pill ${powered ? "active" : ""}">${powered ? "Power flowing" : "No power"}</span>
        </div>
        <div class="exBody"><span class="good">WHEN</span> ${escapeHtml(condTxt)} <span class="good">THEN</span> ${escapeHtml(tgts)}</div>
        <div class="exBlockers">
          ${powered
            ? `<span class="good">Why:</span> Condition is satisfied right now.`
            : `<span class="bad">Blocking:</span> ${blockers.length ? blockers.map(b => escapeHtml(b)).join(" · ") : "Condition not satisfied."}`
          }
        </div>
      </div>
    `);
  });
  diagramExplain.innerHTML = rows.join("");
}

function updateDiagram(state) {
  if (!diagramModel) return;

  // Vars
  for (const [id, p] of diagramModel.nodePos.entries()) {
    if (!id.startsWith("var:")) continue;
    const name = id.split(":")[1];
    const on = resolveVarValue(name, state);
    const g = diagramSvg.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    const rect = g?.querySelector("rect");
    if (!rect) continue;
    rect.classList.remove("on", "off");
    rect.classList.add(on ? "on" : "off");
  }

  // Rungs + edges
  const rungPower = diagramModel.rungs.map(r => evalExpr(r.cond, state));
  for (let i = 0; i < rungPower.length; i++) {
    const id = `rung:${i}`;
    const g = diagramSvg.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    const rect = g?.querySelector("rect");
    if (rect) {
      rect.classList.toggle("active", !!rungPower[i]);
    }
  }

  // Edge highlighting
  for (const e of diagramModel.edges) {
    const path = diagramSvg.querySelector(`[data-edge-id="${CSS.escape(e.id)}"]`);
    if (!path) continue;
    let active = false;
    if (e.kind === "cond") active = resolveVarValue(e.varName, state);
    if (e.kind === "act") active = !!rungPower[e.rungIdx];
    path.classList.toggle("active", active);
  }
}

async function loop() {
  try {
    // Load last project labels (IO list) once for nicer names
    if (!lastProject) {
      const lp = await apiLastProject();
      lastProject = lp?.project || null;
    }

    // Refresh program occasionally and rebuild diagram when it changes
    let currentProgram = null;
    // Check for program updates (throttled to every ~2 seconds, but always check if no signature yet)
    const shouldCheckProgram = !lastProgramSig || (Date.now() % 2000) < 220;
    if (shouldCheckProgram) {
      try {
        currentProgram = await apiProgram();
        const ir = currentProgram?.ir || {};
        nameForVar = buildNameForVar(lastProject, ir);
        const sig = JSON.stringify(ir);
        if (sig !== lastProgramSig) {
          lastProgramSig = sig;
          buildDiagram(ir);
          // Log when program changes for debugging
          if (ir && ir.networks && ir.networks.length > 0) {
            console.log("Program updated:", ir.networks.length, "networks");
          } else if (!lastProgramSig || lastProgramSig === "{}") {
            console.log("No program loaded yet");
          }
        }
      } catch (e) {
        console.error("Failed to fetch program:", e);
        // Reset signature on error so we retry
        if (!lastProgramSig) lastProgramSig = "";
      }
    }

    const s = await apiState();
    const st = s.scanStats || {};
    // PLC front-panel status
    if (plcBadge) {
      const hasFault = !!s.lastError;
      const run = !!s.running;
      const label = hasFault ? "FAULT" : (run ? "RUN" : "STOP");
      plcBadge.textContent = label;
      plcBadge.classList.remove("run", "stop", "fault");
      plcBadge.classList.add(hasFault ? "fault" : (run ? "run" : "stop"));
      plcBadge.title = hasFault ? "PLC faulted (see Status)" : (run ? "PLC running" : "PLC stopped");
    }

    // Scan heartbeat (toggle when samples increments)
    if (scanBeat && st && typeof st.samples === "number") {
      if (lastScanSamples === null) lastScanSamples = st.samples;
      if (st.samples !== lastScanSamples) {
        lastScanSamples = st.samples;
        beatOn = !beatOn;
        scanBeat.classList.toggle("on", beatOn);
      }
    }

    const phases = st?.phases;
    const phaseTxt = phases?.last
      ? ` · phases in ${fmtMs(phases.last.inputMs)} / logic ${fmtMs(phases.last.logicMs)} / house ${fmtMs(phases.last.housekeepingMs)}ms`
      : "";
    scanInfo.textContent =
      st && typeof st.lastMs === "number"
        ? `— interval ${s.scanMs}ms · last ${fmtMs(st.lastMs)}ms · avg ${fmtMs(st.avgMs)}ms · p95 ${fmtMs(st.p95Ms)}ms · max ${fmtMs(st.maxMs)}ms · overruns ${st.overruns || 0}${phaseTxt}`
        : `— scan ${s.scanMs}ms`;

    const faults = s.faults || [];
    const faultsMap = faultsToMap(faults);
    lastFaults = faults;

    // Unified mode - always show inputs
    const inputsSection = document.getElementById("inputsSection");
    const beginnerHint = document.getElementById("beginnerModeHint");
    const inputsGrid = document.getElementById("inputs");
    
    // Always show inputs in unified mode
    if (inputsSection) inputsSection.style.display = "block";
    if (beginnerHint) beginnerHint.style.display = "none";
    renderBank(elInputs, s.inputs, true, (k, v) => setInput(k, v));
    
    renderOutputs(s.outputs, faultsMap, s);
    renderBank(elMem, s.mem, false, () => {});
    renderAnalog(s);
    updateDiagram(s);
    updateDiagramExplain(s);
    
    // Render interlocks (throttled to avoid too many API calls)
    if (currentProgram?.ir) {
      renderInterlocks(currentProgram.ir, s);
    } else if (lastProgramSig) {
      // Fetch program asynchronously for interlocks if we don't have it
      apiProgram().then(p => {
        if (p?.ir) renderInterlocks(p.ir, s);
      }).catch(() => {});
    }
    elStatus.textContent = JSON.stringify(
      { lastError: s.lastError, timers: s.timers, diag: s.diag },
      null,
      2
    );

    // Fault list panel: use state snapshot (cheap) and occasionally refresh via /api/faults for truth
    renderFaults(lastFaults);
    if ((Date.now() - lastFaultsPollAt) > 1200) {
      lastFaultsPollAt = Date.now();
      apiFaults().then((r) => {
        if (r?.ok) { lastFaults = r.faults || []; renderFaults(lastFaults); }
      }).catch(() => {});
    }

    // Explain panel (only if an output is selected)
    if (selectedOutput && (Date.now() - lastExplainPollAt) > 250) {
      lastExplainPollAt = Date.now();
      apiExplainOutput(selectedOutput).then((r) => {
        lastExplain = r;
        renderExplain(r);
      }).catch((e) => {
        renderExplain({ ok: false, error: String(e?.message || e) });
      });
    } else {
      renderExplain(lastExplain);
    }
  } catch (e) {
    elStatus.textContent = String(e);
  } finally {
    setTimeout(loop, 200);
  }
}

// Listen for mode changes
window.addEventListener("modechange", (e) => {
  // Mode changed, will be reflected in next loop iteration
});

(async () => {
  updateGoalDisplay();
  try {
    const f = await apiFeatures();
    featureInfo.textContent = f.python ? "Python enabled" : "Python available (disabled)";
  } catch {}

  // Interlock detail close button
  if (btnInterlockDetailClose) {
    btnInterlockDetailClose.onclick = () => {
      if (elInterlockDetail) elInterlockDetail.style.display = "none";
      selectedInterlockVar = null;
      document.querySelectorAll(".interlockCard").forEach(c => c.classList.remove("selected"));
    };
  }
  
  // Fault form wiring
  if (btnFaultSet) {
    btnFaultSet.onclick = async () => {
      elFaultErr.textContent = "";
      const varName = String(elFaultVar?.value || "").trim().toUpperCase();
      const mode = String(elFaultMode?.value || "force");
      const value = String(elFaultValue?.value || "0") === "1";
      const r = await apiSetFault({ varName, mode, value });
      if (!r.ok) elFaultErr.textContent = r.error || "Failed to set fault";
      else elFaultErr.textContent = "";
    };
  }
  if (btnFaultClear) {
    btnFaultClear.onclick = async () => {
      elFaultErr.textContent = "";
      const varName = String(elFaultVar?.value || "").trim().toUpperCase();
      if (!varName) { elFaultErr.textContent = "Enter a var to clear (e.g. I0)."; return; }
      const r = await apiClearFault(varName);
      if (!r.ok) elFaultErr.textContent = r.error || "Failed to clear fault";
      else elFaultErr.textContent = "";
    };
  }

  loop();
})();
