const elOutList = document.getElementById("outList");
const elScanInfo = document.getElementById("scanInfo");
const elSelTitle = document.getElementById("selTitle");
const elSelMeta = document.getElementById("selMeta");
const elSummary = document.getElementById("summary");
const elPerms = document.getElementById("perms");
const elTrips = document.getElementById("trips");
const elSafety = document.getElementById("safety");
const elReasonTree = document.getElementById("reasonTree");
const elWriters = document.getElementById("writers");

let selectedVar = null;
let lastState = null;
let lastProgram = null;
let lastExplain = null;

async function apiState() {
  const r = await fetch("/api/state");
  return r.json();
}
async function apiProgram() {
  const r = await fetch("/api/program");
  return r.json();
}
async function apiExplain(varName) {
  const r = await fetch(`/api/explain/output/${encodeURIComponent(varName)}`);
  return r.json();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function fmtMs(n) {
  const x = Number(n || 0);
  if (!isFinite(x)) return "0";
  return x >= 10 ? x.toFixed(1) : x.toFixed(2);
}

function collectOutputVars(ir) {
  const out = new Set();
  for (const net of ir?.networks || []) {
    for (const rung of net?.rungs || []) {
      for (const a of rung.actions || []) {
        if ((a.type === "COIL" || a.type === "SET" || a.type === "RESET") && String(a.target || "").match(/^[QM]\d+$/)) out.add(a.target);
      }
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function chip(text, kind) {
  const s = document.createElement("span");
  s.className = `chip ${kind || ""}`.trim();
  s.textContent = text;
  return s;
}

function renderTreeNode(container, node, depth) {
  if (!node) return;
  const div = document.createElement("div");
  div.className = "treeNode " + (node.value ? "true" : "false");
  div.style.paddingLeft = (depth * 12 + 4) + "px";
  div.textContent = (node.type || "?") + ": " + (node.text || "");
  container.appendChild(div);
  (node.children || []).forEach((c) => renderTreeNode(container, c, depth + 1));
}

function renderOutputsList() {
  if (!elOutList) return;
  elOutList.innerHTML = "";

  const vars = collectOutputVars(lastProgram?.ir || {});
  if (!vars.length) {
    elOutList.innerHTML = `<div class="small">No outputs found in the current program. Upload logic to see interlocks.</div>`;
    return;
  }

  const faults = (lastState?.faults || []).reduce((m, f) => (m.set(f.var, f), m), new Map());

  for (const v of vars) {
    const btn = document.createElement("button");
    btn.className = `outBtn ${selectedVar === v ? "sel" : ""}`;

    const val = v.startsWith("Q") ? !!lastState?.outputs?.[v] : !!lastState?.mem?.[v];
    const fault = faults.get(v);

    const left = document.createElement("div");
    left.innerHTML = `<div class="tag">${escapeHtml(v)}</div><div class="small">${escapeHtml(fault ? `forced (${fault.mode})` : "logic-controlled")}</div>`;

    const st = document.createElement("span");
    st.className = `state ${val ? "on" : "off"} ${fault ? "fault" : ""}`.trim();
    st.textContent = val ? "ON" : "OFF";

    btn.appendChild(left);
    btn.appendChild(st);
    btn.onclick = () => { selectedVar = v; lastExplain = null; renderExplain(); };
    elOutList.appendChild(btn);
  }
}

function renderExplain() {
  if (!selectedVar) {
    elSelTitle.textContent = "Select an output";
    elSelMeta.textContent = "";
    elSummary.textContent = "Click an output on the left.";
    elPerms.innerHTML = "";
    elTrips.innerHTML = "";
    elSafety.innerHTML = "";
    elReasonTree.innerHTML = "";
    elWriters.innerHTML = "";
    return;
  }

  elSelTitle.textContent = selectedVar;
  elSelMeta.textContent = lastExplain ? "" : "loading…";

  if (!lastExplain) return;
  if (!lastExplain.ok) {
    elSummary.textContent = `Error: ${lastExplain.error || "failed to explain output"}`;
    elPerms.innerHTML = "";
    elTrips.innerHTML = "";
    elSafety.innerHTML = "";
    elReasonTree.innerHTML = "";
    elWriters.innerHTML = "";
    return;
  }

  const val = !!lastExplain.value;
  elSummary.textContent = `${lastExplain.var} is ${val ? "ON" : "OFF"}\n${lastExplain.explanation?.message || ""}`.trim();

  // Permissives / trips from blockers (aggregate across reasons)
  const perms = [];
  const trips = [];
  for (const r of (lastExplain.explanation?.reasons || [])) {
    for (const b of (r.blockers || [])) {
      if (b.type === "trip") trips.push(b);
      else perms.push(b);
    }
  }

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

  elPerms.innerHTML = "";
  const up = uniq(perms);
  if (!up.length) elPerms.appendChild(chip(val ? "Satisfied" : "None detected", val ? "good" : "warn"));
  else up.slice(0, 24).forEach(p => elPerms.appendChild(chip(p.text || p.label || p.var, "bad")));

  elTrips.innerHTML = "";
  const ut = uniq(trips);
  if (!ut.length) elTrips.appendChild(chip(val ? "None" : "None detected", "good"));
  else ut.slice(0, 24).forEach(t => elTrips.appendChild(chip(t.text || t.label || t.var, "bad")));

  // Safety chain
  elSafety.innerHTML = "";
  const sc = lastExplain.safetyChain || [];
  if (!sc.length) elSafety.appendChild(chip("No safety tags detected in ioMap", "warn"));
  else sc.forEach(s => elSafety.appendChild(chip(`${s.label}: ${s.value ? "OK" : "TRIP"}`, s.value ? "good" : "bad")));

  // Reason tree (collapsible, false=red, true=green)
  elReasonTree.innerHTML = "";
  const primaryRungs = lastExplain.primaryRungs || [];
  const rootCause = lastExplain.rootCause;
  if (rootCause) {
    const rc = document.createElement("div");
    rc.className = "rootCause";
    rc.textContent = "Root cause: " + rootCause;
    elReasonTree.appendChild(rc);
  }
  primaryRungs.forEach((pr, i) => {
    const details = document.createElement("details");
    details.className = "treeDetails";
    details.innerHTML = `<summary>Rung ${Number(pr.rungIndex) + 1} — ${pr.power ? "powered" : "no power"}</summary>`;
    const treeDiv = document.createElement("div");
    treeDiv.className = "treeChildren";
    if (pr.tree) renderTreeNode(treeDiv, pr.tree, 0);
    details.appendChild(treeDiv);
    elReasonTree.appendChild(details);
  });

  // Writers
  elWriters.innerHTML = "";
  const writers = lastExplain.writers || [];
  if (!writers.length) {
    elWriters.innerHTML = `<div class="small">No rungs found writing this output.</div>`;
    return;
  }
  for (const w of writers.slice(0, 24)) {
    const row = document.createElement("div");
    row.className = "wRow";
    row.innerHTML = `
      <div class="top">
        <div><strong>Rung ${Number(w.rungIndex) + 1}</strong> <span class="small">(${escapeHtml((w.actionTypes || []).join(", ") || "write")})</span></div>
        <span class="state ${w.condPower ? "on" : "off"}">${w.condPower ? "POWERED" : "no power"}</span>
      </div>
      <div class="cond">${escapeHtml(w.condText || "")}</div>
    `;
    elWriters.appendChild(row);
  }
}

async function updateEmptyState() {
  const emptyEl = document.getElementById("emptyStateInterlocks");
  const contentEl = document.getElementById("interlocksContent");
  if (!emptyEl || !contentEl) return;
  try {
    const r = await fetch("/api/project/last", { credentials: "include" });
    const data = await r.json();
    const hasProject = data && data.ok && data.project;
    emptyEl.style.display = hasProject ? "none" : "block";
    contentEl.style.display = hasProject ? "block" : "none";
  } catch {
    contentEl.style.display = "block";
    emptyEl.style.display = "none";
  }
}

async function loop() {
  try {
    if (!lastProgram || (Date.now() % 2000) < 250) {
      lastProgram = await apiProgram();
    }
    lastState = await apiState();

    const st = lastState.scanStats || {};
    const phases = st?.phases?.last;
    if (elScanInfo) {
      elScanInfo.textContent =
        st && typeof st.lastMs === "number"
          ? `scan last ${fmtMs(st.lastMs)}ms · avg ${fmtMs(st.avgMs)}ms · p95 ${fmtMs(st.p95Ms)}ms${phases ? ` · phases in ${fmtMs(phases.inputMs)} / logic ${fmtMs(phases.logicMs)} / house ${fmtMs(phases.housekeepingMs)}ms` : ""}`
          : "";
    }

    renderOutputsList();

    if (selectedVar) {
      lastExplain = await apiExplain(selectedVar);
    }
    renderExplain();
  } catch (e) {
    if (elScanInfo) elScanInfo.textContent = `Error: ${String(e?.message || e)}`;
  } finally {
    setTimeout(loop, 350);
  }
}

updateEmptyState();
loop();

