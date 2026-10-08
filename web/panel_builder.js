const elRail = document.getElementById("rail");
const elMsgs = document.getElementById("msgs");
const elScan = document.getElementById("scanInfo");
const elExplain = document.getElementById("explainText");
const elTestInputs = document.getElementById("testInputs");
const elTestOutputs = document.getElementById("testOutputs");
const elReason = document.getElementById("reasonPanel");
const elPlaceHint = document.getElementById("placeHint");
const elPlaceAsk = document.getElementById("placeAsk");
const elWiringSvg = document.getElementById("panelWiringSvg");
const elWiringSvgModal = document.getElementById("panelWiringSvgModal");
const elHwSvg = document.getElementById("panelHwSvg");
const elWiringColumns = document.getElementById("wiringColumns");
const elWiringModal = document.getElementById("wiringDiagramModal");

// Unified mode - always simple language with OT terms
function getCurrentMode() {
  return "beginner"; // Always unified mode
}

// Always in unified mode (simple language + OT terms)
function isBeginnerMode() {
  return true; // Always unified mode
}

const LS = {
  panelSeed: "panel_builder.seed",
};

const API = {
  state: () => fetch("/api/state").then(r => r.json()),
  program: () => fetch("/api/program").then(r => r.json()),
  panelValidate: (panel) => fetch("/api/panel/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ panel })
  }).then(r => r.json()),
  panelCompile: (panel) => fetch("/api/panel/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ panel })
  }).then(r => r.json()),
  uploadIR: (ir) => fetch("/api/program", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir })
  }).then(r => r.json()),
  truthTable: (ir, inputVars, outputVars) => fetch("/api/truth-table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir, inputVars, outputVars })
  }).then(r => r.json())
};

// --- Panel model (tag-based, no bit addressing in UI) ---
let panel = {
  name: "Panel",
  tags: {
    "Start Button": { kind: "DI", label: "Start Button", group: "control" },
    "Stop Button": { kind: "DI", label: "Stop Button", group: "control" },
    "E-Stop OK": { kind: "DI", label: "E‑Stop", group: "safety" },
    "Overload OK": { kind: "DI", label: "Overload", group: "safety" },
    "Motor M1": { kind: "DO", label: "Motor", group: "control" }
  },
  rungs: [
    {
      branches: [[
        { tag: "E-Stop OK", type: "NC" },
        { tag: "Overload OK", type: "NC" },
        { tag: "Stop Button", type: "NC" },
        { tag: "Start Button", type: "NO" }
      ]],
      coil: { tag: "Motor M1", action: "COIL" }
    }
  ]
};

let seedLoadedFromWizard = null; // { name?:string, wizardId?:string }

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function defaultGroupForTag(tag) {
  const t = String(tag || "").toLowerCase();
  if (t.includes("e-stop") || t.includes("estop") || t.includes("overload")) return "safety";
  return "control";
}

function normalizeImportedPanel(p) {
  if (!p || typeof p !== "object") return null;
  if (!p.tags || typeof p.tags !== "object") p.tags = {};
  if (!Array.isArray(p.rungs)) p.rungs = [];

  for (const [tag, meta] of Object.entries(p.tags)) {
    if (!meta || typeof meta !== "object") p.tags[tag] = { kind: "DI", label: String(tag), group: defaultGroupForTag(tag) };
    else {
      if (!meta.kind) meta.kind = "DI";
      if (!meta.label) meta.label = String(tag);
      if (!meta.group) meta.group = defaultGroupForTag(tag);
    }
  }

  // Ensure a stable structure for rungs (support either `contacts` or `branches`)
  for (const r of p.rungs) {
    if (!r || typeof r !== "object") continue;
    if (!r.coil) r.coil = { tag: "Motor M1", action: "COIL" };
    if (!r.coil.action) r.coil.action = "COIL";
    if (!r.coil.tag) r.coil.tag = "Motor M1";
  }
  return p;
}

function tryLoadPanelSeed() {
  const raw = (() => { try { return localStorage.getItem(LS.panelSeed); } catch { return null; } })();
  if (!raw) return;
  const payload = safeJsonParse(raw);
  if (!payload || payload.kind !== "panel" || !payload.panel) return;

  // Clone so the builder can mutate freely
  const cloned = safeJsonParse(JSON.stringify(payload.panel));
  const normalized = normalizeImportedPanel(cloned);
  if (!normalized) return;

  panel = normalized;
  seedLoadedFromWizard = { name: payload.name, wizardId: payload.wizardId };
  activeRung = 0;
  activeBranch = 0;
}

let lastCompiled = null; // last compiled IR
let lastIoMap = {}; // tag -> I/Q
let lastTbAlloc = new Map(); // tag -> { slots:number[], kind:"sensor"|"contact", safety:boolean }
let tbFlashTimer = null;

let activeRung = 0;
let activeBranch = 0;
let lastSnap = null;

// Apply any seed from Control Templates before first render
tryLoadPanelSeed();

// Convert IR to panel format for visualization
function convertIRToPanel(ir, ioMap) {
  if (!ir || !ir.networks) return null;
  
  const panelTags = {};
  const panelRungs = [];
  
  // Create tags from ioMap
  for (const [tag, address] of Object.entries(ioMap || {})) {
    const addr = String(address);
    const kind = addr.startsWith("I") ? "DI" : (addr.startsWith("Q") ? "DO" : "DI");
    const tagUpper = String(tag).toUpperCase();
    const group = (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
                   tagUpper.includes("EMERGENCY") || tagUpper.includes("SAFETY") ||
                   tagUpper.includes("OVERLOAD")) ? "safety" : "control";
    
    panelTags[tag] = {
      kind,
      label: tag,
      group
    };
  }
  
  // Convert rungs from IR to panel format
  let rungIndex = 0;
  for (const net of ir.networks || []) {
    for (const rung of net.rungs || []) {
      // Find output actions (COIL, SET)
      const outputActions = (rung.actions || []).filter(a => 
        (a.type === "COIL" || a.type === "SET") && String(a.target || "").match(/^[QM]\d+$/)
      );
      
      if (outputActions.length === 0) continue;
      
      // For each output, create a rung
      for (const action of outputActions) {
        const outputTag = Object.entries(ioMap || {}).find(([_, addr]) => addr === action.target)?.[0] || action.target;
        
        // Convert condition expression to contacts
        const contacts = extractContactsFromExpr(rung.cond, ioMap);
        
        panelRungs.push({
          branches: [contacts],
          coil: {
            tag: outputTag,
            action: action.type === "SET" ? "SET" : "COIL"
          }
        });
      }
    }
  }
  
  // If no rungs created, at least show the devices
  if (panelRungs.length === 0 && Object.keys(panelTags).length > 0) {
    // Create a placeholder rung for the first output
    const firstOutput = Object.entries(panelTags).find(([_, meta]) => meta.kind === "DO");
    if (firstOutput) {
      panelRungs.push({
        branches: [[]],
        coil: {
          tag: firstOutput[0],
          action: "COIL"
        }
      });
    }
  }
  
  return {
    name: ir.metadata?.name || "Imported from P&ID",
    tags: panelTags,
    rungs: panelRungs,
    metadata: ir.metadata || {}
  };
}

// Extract contacts from boolean expression (simplified - handles basic AND/OR/NOT/VAR)
function extractContactsFromExpr(expr, ioMap) {
  if (!expr) return [];
  
  const contacts = [];
  
  function walk(e, negate = false) {
    if (!e || typeof e === "boolean") {
      // Boolean constant - skip (can't represent as contact)
      return;
    }
    
    if (e.var) {
      // Variable reference - find tag from ioMap
      const tag = Object.entries(ioMap || {}).find(([_, addr]) => addr === e.var)?.[0] || e.var;
      const type = negate ? "NC" : "NO";
      contacts.push({ tag, type });
    } else if (e.op === "NOT") {
      walk(e.x, !negate);
    } else if (e.op === "AND") {
      // AND: both must be true (series - add both contacts)
      walk(e.a, negate);
      walk(e.b, negate);
    } else if (e.op === "OR") {
      // OR: either can be true (parallel) - simplified: take first branch only
      // In full implementation, this would create multiple branch arrays
      walk(e.a, negate);
      // Note: For full OR support, we'd need to create separate branches
      // but for visualization, showing first branch is acceptable
    }
  }
  
  walk(expr);
  
  // If no contacts extracted, add a placeholder
  if (contacts.length === 0) {
    // Try to find any input from ioMap as a placeholder
    const firstInput = Object.entries(ioMap || {}).find(([_, addr]) => String(addr).startsWith("I"));
    if (firstInput) {
      contacts.push({ tag: firstInput[0], type: "NO" });
    }
  }
  
  return contacts;
}

// Load imported data from P&ID Import
let importedDataLoaded = false;
function tryLoadImportedData() {
  try {
    const importedIR = localStorage.getItem("project.importedIR");
    const importedIOMap = localStorage.getItem("project.importedIOMap");
    if (importedIR) {
      const ir = safeJsonParse(importedIR);
      const ioMap = safeJsonParse(importedIOMap || "{}");
      if (ir) {
        // Convert IR to panel format for visualization
        const convertedPanel = convertIRToPanel(ir, ioMap || ir.ioMap || {});
        
        if (convertedPanel && Object.keys(convertedPanel.tags).length > 0) {
          // Load the converted panel
          panel = normalizeImportedPanel(convertedPanel);
          activeRung = 0;
          activeBranch = 0;
          
          // Store IR for upload button to use
          window.importedIR = ir;
          window.importedIOMap = ioMap || ir.ioMap || {};
          
          importedDataLoaded = true;
          
          // Mark as imported from P&ID
          panel.metadata = panel.metadata || {};
          panel.metadata.importedFromPID = true;
          
          msg("ok", `✅ P&ID import loaded: ${Object.keys(panel.tags).length} devices, ${panel.rungs.length} rungs visible. Review the logic below and click 'Build + Upload' when ready.`);
          
          // Render the panel
          render();
          
          // Show a banner indicating this is from P&ID import
          showImportBanner();
        } else {
          // Fallback: just store IR for upload
          window.importedIR = ir;
          window.importedIOMap = ioMap || ir.ioMap || {};
          msg("ok", "Imported P&ID data loaded. Click 'Build + Upload' to use it.");
        }
        
        // Clear the imported data so it doesn't reload on next visit
        localStorage.removeItem("project.importedIR");
        localStorage.removeItem("project.importedIOMap");
      }
    }
  } catch (e) {
    console.error("Failed to load imported data:", e);
    msg("err", `Failed to load imported data: ${e.message}`);
  }
}
tryLoadImportedData();

function msg(type, text) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  elMsgs.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}
function clearMsgs() { elMsgs.innerHTML = ""; }

function showImportBanner() {
  // Check if banner already exists
  if (document.getElementById("pidImportBanner")) return;
  
  const banner = document.createElement("div");
  banner.id = "pidImportBanner";
  banner.style.cssText = `
    position: sticky;
    top: 80px;
    z-index: 10;
    background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 14px;
    box-shadow: 0 4px 12px rgba(14,165,233,.3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `;
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 20px;">📋</span>
      <div>
        <strong style="font-size: 14px;">Viewing P&ID Import</strong>
        <div class="small" style="color: rgba(255,255,255,.9); font-size: 12px;">
          This panel was generated from your P&ID import. Review the devices and logic below.
        </div>
      </div>
    </div>
    <button onclick="this.parentElement.remove()" style="
      background: rgba(255,255,255,.2);
      border: 1px solid rgba(255,255,255,.3);
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
    ">✕</button>
  `;
  
  const main = document.querySelector("main.wrap");
  if (main) {
    main.insertBefore(banner, main.firstChild);
  }
}

function setExplain(html) {
  if (!elExplain) return;
  elExplain.innerHTML = html;
}

function isSafetyTag(tag) {
  const g = panel.tags?.[tag]?.group;
  return g === "safety" || String(tag).toLowerCase().includes("e-stop") || String(tag).toLowerCase().includes("estop");
}

function terminalsForPart(partKind, cType) {
  // Keep the labels familiar, not PLC-ish.
  if (partKind === "coil") return ["A1", "A2"];
  // Contacts: use the most common IEC numbering
  if (cType === "NC") return ["21", "22"];
  return ["13", "14"]; // NO
}

function addComponentToActive(type) {
  const rung = panel.rungs[activeRung] || panel.rungs[panel.rungs.length - 1];
  rung.branches = rung.branches || [rung.contacts || []];
  const branch = rung.branches[activeBranch] || rung.branches[0];
  const addTag = (tag, label, kind) => {
    if (!panel.tags[tag]) panel.tags[tag] = { kind, label, group: /e-?stop|overload/i.test(tag) ? "safety" : "control" };
  };
  let addedTag = null;

  // Contact devices (placed into the wiring path)
  if (type === "pb_start_NO") { addedTag = "Start Button"; addTag(addedTag, "Start Button", "DI"); branch.push({ tag: addedTag, type: "NO" }); }
  if (type === "pb_start_NC") { addedTag = "Start Button"; addTag(addedTag, "Start Button", "DI"); branch.push({ tag: addedTag, type: "NC" }); }

  if (type === "pb_stop_NO") { addedTag = "Stop Button"; addTag(addedTag, "Stop Button", "DI"); branch.push({ tag: addedTag, type: "NO" }); }
  if (type === "pb_stop_NC") { addedTag = "Stop Button"; addTag(addedTag, "Stop Button", "DI"); branch.push({ tag: addedTag, type: "NC" }); }

  if (type === "pb_estop_NO") { addedTag = "E-Stop OK"; addTag(addedTag, "E‑Stop", "DI"); panel.tags[addedTag].group = "safety"; branch.push({ tag: addedTag, type: "NO" }); }
  if (type === "pb_estop_NC") { addedTag = "E-Stop OK"; addTag(addedTag, "E‑Stop", "DI"); panel.tags[addedTag].group = "safety"; branch.push({ tag: addedTag, type: "NC" }); }

  if (type === "overload_NO") { addedTag = "Overload OK"; addTag(addedTag, "Overload", "DI"); panel.tags[addedTag].group = "safety"; branch.push({ tag: addedTag, type: "NO" }); }
  if (type === "overload_NC") { addedTag = "Overload OK"; addTag(addedTag, "Overload", "DI"); panel.tags[addedTag].group = "safety"; branch.push({ tag: addedTag, type: "NC" }); }

  if (type === "sensor_pnp_NO" || type === "sensor_npn_NO") {
    const n = Object.keys(panel.tags).filter(k => k.startsWith("Sensor ")).length + 1;
    const tag = `Sensor ${n}`;
    addedTag = tag;
    addTag(tag, type.includes("pnp") ? "Sensor (PNP)" : "Sensor (NPN)", "DI");
    branch.push({ tag, type: "NO" });
  }
  if (type === "sensor_pnp_NC" || type === "sensor_npn_NC") {
    const n = Object.keys(panel.tags).filter(k => k.startsWith("Sensor ")).length + 1;
    const tag = `Sensor ${n}`;
    addedTag = tag;
    addTag(tag, type.includes("pnp") ? "Sensor (PNP)" : "Sensor (NPN)", "DI");
    branch.push({ tag, type: "NC" });
  }

  // Timer contact placeholder (still compiles as a DI for MVP)
  if (type === "timer_NO" || type === "timer_NC") {
    const n = Object.keys(panel.tags).filter(k => k.startsWith("Timer ")).length + 1;
    const tag = `Timer ${n}`;
    addedTag = tag;
    addTag(tag, "Timer", "DI");
    branch.push({ tag, type: type.endsWith("_NC") ? "NC" : "NO" });
  }

  render();
  if (addedTag) flashTerminalForTag(addedTag);
}

function rungToEnglish(rung) {
  const branches = rung.branches || [rung.contacts || []];
  const branchText = branches.map((contacts) => {
    const parts = contacts.map(c => {
      const label = panel.tags[c.tag]?.label || c.tag;
      if (c.type === "NC") return `${label} is OK`;
      return `${label} is ON`;
    });
    return parts.length ? parts.join(" AND ") : "(empty branch)";
  });
  const coilLabel = panel.tags[rung.coil.tag]?.label || rung.coil.tag;
  if (branchText.length === 1) {
    return `Power can reach ${coilLabel} if ${branchText[0]}.`;
  }
  return `Power can reach ${coilLabel} if (${branchText.join(") OR (")}).`;
}

function render() {
  elRail.innerHTML = "";
  
  // Add multi-column class if there are more than 20 rungs
  if (panel.rungs.length > 20) {
    elRail.classList.add("multiColumn");
  } else {
    elRail.classList.remove("multiColumn");
  }
  
  panel.rungs.forEach((r, idx) => {
    const el = document.createElement("div");
    el.className = "rung";

    const head = document.createElement("div");
    head.className = "rungHeader";
    head.innerHTML = `
      <div class="rungTitle">Rule ${idx + 1} ${idx === activeRung ? `<span class="pill sel">👈 SELECTED</span>` : ""}</div>
      <div class="small"><span class="pill live">⚡ Live</span> All things in a row = all must work · Things side-by-side = either one works</div>
    `;
    head.onclick = () => { 
      activeRung = idx; 
      activeBranch = 0; 
      render(); 
      // Highlight terminal blocks for all tags in this rung
      highlightTerminalsForRung(r);
    };
    el.appendChild(head);

    const branches = r.branches || [r.contacts || []];
    const branchWrap = document.createElement("div");
    branchWrap.className = "branches";

    branches.forEach((contacts, bi) => {
      const row = document.createElement("div");
      row.className = "branchRow";
      const leftBus = document.createElement("div");
      leftBus.className = `bus ${idx === activeRung && bi === activeBranch ? "on" : ""}`;
      const rightBus = document.createElement("div");
      rightBus.className = "bus";
      const chain = document.createElement("div");
      chain.className = "branch";
      chain.onclick = (ev) => { 
        ev.stopPropagation(); 
        activeRung = idx; 
        activeBranch = bi; 
        render(); 
        // Highlight terminal blocks for all tags in this branch
        highlightTerminalsForBranch(contacts, r.coil?.tag);
      };

      (contacts || []).forEach((c, cidx) => {
        const safety = isSafetyTag(c.tag);
        const [t1, t2] = terminalsForPart("contact", c.type);
        const node = document.createElement("div");
        node.className = `node off ${safety ? "safety" : ""}`;
        node.innerHTML = `
          <div class="t tterm">
            <span class="termPair"><span class="term off"></span><span class="termLbl">${escapeHtml(t1)}</span></span>
            <span>${c.type} ${escapeHtml(c.tag)}</span>
            <span class="termPair"><span class="termLbl">${escapeHtml(t2)}</span></span>
          </div>
          <div class="l">${escapeHtml(panel.tags[c.tag]?.label || "")}</div>
        `;
        node.title = "Click to remove";
        node.onclick = (ev) => { ev.stopPropagation(); contacts.splice(cidx, 1); render(); };
        node.addEventListener("mouseenter", () => highlightTerminalForTag(c.tag));
        node.addEventListener("mouseleave", () => clearTerminalHighlight());
        chain.appendChild(node);

        const wire = document.createElement("div");
        wire.className = `wire ${safety ? "safety" : ""}`;
        chain.appendChild(wire);
      });

      // Coil shown only on first branch row (common load)
      if (bi === 0) {
        const [t1, t2] = terminalsForPart("coil");
        const coil = document.createElement("div");
        coil.className = "node coil off";
        coil.innerHTML = `
          <div class="t tterm">
            <span class="termPair"><span class="term off"></span><span class="termLbl">${escapeHtml(t1)}</span></span>
            <span>COIL ${escapeHtml(r.coil.tag)}</span>
            <span class="termPair"><span class="termLbl">${escapeHtml(t2)}</span></span>
          </div>
          <div class="l">${escapeHtml(panel.tags[r.coil.tag]?.label || "")}</div>
        `;
        chain.appendChild(coil);
      }

      row.appendChild(leftBus);
      row.appendChild(chain);
      row.appendChild(rightBus);
      branchWrap.appendChild(row);
    });

    el.appendChild(branchWrap);
    elRail.appendChild(el);
  });

  // Plain-English helper for selected rung
  const rung = panel.rungs[activeRung] || panel.rungs[0];
  if (rung) {
    setExplain(`<strong>${escapeHtml(rungToEnglish(rung))}</strong><br><span class="small">Tip: NC means “must be OK/closed”. NO means “must be ON/pressed”.</span>`);
  } else {
    const mode = isBeginnerMode();
    setExplain(mode ? "Add a rule to start!" : "Add a rung to start.");
  }

  // Refresh reason panel immediately (best effort without live state)
  renderReasonPanel(lastSnap);
  renderWiringOverview(lastSnap);
  renderTerminalBlocks(lastSnap);
  
  // Highlight terminals for the active rung (reuse rung from above)
  if (rung) {
    highlightTerminalsForRung(rung);
  }
  
  // Update safety panel
  renderSafetyPanel();
}

// Highlight terminal blocks for all tags in a rung
function highlightTerminalsForRung(rung) {
  clearTerminalHighlight();
  if (!rung) return;
  
  const tags = new Set();
  // Collect all contact tags
  const branches = rung.branches || [rung.contacts || []];
  branches.forEach(contacts => {
    (contacts || []).forEach(c => {
      if (c.tag) tags.add(c.tag);
    });
  });
  // Add coil tag
  if (rung.coil?.tag) tags.add(rung.coil.tag);
  
  // Highlight all terminal blocks for these tags
  tags.forEach(tag => {
    highlightTerminalForTag(tag);
  });
}

// Highlight terminal blocks for all tags in a branch
function highlightTerminalsForBranch(contacts, coilTag) {
  clearTerminalHighlight();
  
  const tags = new Set();
  (contacts || []).forEach(c => {
    if (c.tag) tags.add(c.tag);
  });
  if (coilTag) tags.add(coilTag);
  
  // Highlight all terminal blocks for these tags
  tags.forEach(tag => {
    highlightTerminalForTag(tag);
  });
}

// Highlight the rung that uses a specific tag
function highlightRungForTag(tag) {
  if (!tag) return;
  
  // Find the rung that contains this tag
  for (let idx = 0; idx < panel.rungs.length; idx++) {
    const rung = panel.rungs[idx];
    const branches = rung.branches || [rung.contacts || []];
    
    let found = false;
    // Check contacts
    for (const contacts of branches) {
      if ((contacts || []).some(c => c.tag === tag)) {
        found = true;
        break;
      }
    }
    // Check coil
    if (!found && rung.coil?.tag === tag) {
      found = true;
    }
    
    if (found) {
      activeRung = idx;
      activeBranch = 0;
      render();
      break;
    }
  }
}

function pad2(n) { return String(n).padStart(2, "0"); }

function getUsedContactTagsInOrder() {
  // Unique contact tags from panel rungs, in a stable/electrician-friendly order:
  // safety first, then stop/start, then sensors, then timers, then everything else.
  const used = new Set();
  for (const r of panel.rungs || []) {
    const branches = r.branches || [r.contacts || []];
    for (const b of branches) for (const c of (b || [])) used.add(String(c.tag));
  }
  const tags = Array.from(used);
  const score = (t) => {
    const tl = t.toLowerCase();
    if (isSafetyTag(t)) return 0;
    if (tl.includes("stop")) return 1;
    if (tl.includes("start")) return 2;
    if (/^sensor\s+\d+$/i.test(t)) return 3;
    if (/^timer\s+\d+$/i.test(t)) return 4;
    return 9;
  };
  const nOf = (t) => Number((t.match(/\d+/) || ["0"])[0]);
  return tags.sort((a, b) => {
    const sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    const na = nOf(a), nb = nOf(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

function isSensorTag(tag) {
  return /^Sensor\s+\d+$/i.test(tag) || (panel.tags?.[tag]?.label || "").toLowerCase().includes("sensor");
}

let warnedTbOverflow = false;

// Ensure terminal slots exist in SVG (dynamically create if needed)
function ensureTerminalSlots(count) {
  if (!elHwSvg) return;
  
  const tbSlots = document.getElementById("tbSlots");
  if (!tbSlots) return;
  
  const slotsPerRow = 15; // Changed from 10 to 15 for better space utilization
  const rowsNeeded = Math.ceil(count / slotsPerRow);
  const existingRows = Array.from(tbSlots.querySelectorAll("g"));
  const existingCount = existingRows.length * slotsPerRow;
  
  // Remove excess rows if we have too many (keep at least 2 rows)
  while (existingRows.length > Math.max(2, rowsNeeded)) {
    tbSlots.removeChild(existingRows[existingRows.length - 1]);
    existingRows.pop();
  }
  
  // Add rows if needed
  for (let row = existingRows.length; row < rowsNeeded; row++) {
    const rowGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const startNum = row * slotsPerRow + 1;
    
    // Professional spacing: 30px terminal width + 2px gap = 32px per terminal
    const terminalSpacing = 32;
    
    for (let col = 0; col < slotsPerRow; col++) {
      const num = startNum + col;
      const id = pad2(num);
      const x = col * terminalSpacing;
      const y = row * 34;
      
      // Create rect
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.id = `tb${id}Rect`;
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", "30");
      rect.setAttribute("height", "26");
      rect.setAttribute("rx", "10");
      rect.setAttribute("fill", "url(#gMetal)");
      rect.setAttribute("stroke", "rgba(15,23,42,.12)");
      rowGroup.appendChild(rect);
      
      // Create number text
      const numText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      numText.id = `tb${id}Num`;
      numText.setAttribute("x", String(x + 4));
      numText.setAttribute("y", String(y + 10));
      numText.setAttribute("font-size", "8");
      numText.setAttribute("font-weight", "900");
      numText.setAttribute("fill", "rgba(15,23,42,.55)");
      numText.textContent = String(num);
      rowGroup.appendChild(numText);
      
      // Create label text
      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.id = `tb${id}Txt`;
      txt.setAttribute("x", String(x + 15));
      txt.setAttribute("y", String(y + 18));
      txt.setAttribute("font-size", "9");
      txt.setAttribute("font-weight", "950");
      txt.setAttribute("fill", "#0f172a");
      txt.setAttribute("text-anchor", "middle");
      rowGroup.appendChild(txt);
      
      // Create screw dot for each terminal
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(x + 15));
      dot.setAttribute("cy", String(y + 13));
      dot.setAttribute("r", "2");
      dot.setAttribute("fill", "rgba(15,23,42,.20)");
      rowGroup.appendChild(dot);
    }
    
    tbSlots.appendChild(rowGroup);
  }
  
  // Update terminal blocks container - dynamically resize width and height
  const tbContainer = elHwSvg.querySelector('g[transform*="translate(320,72)"]');
  if (tbContainer) {
    const baseHeight = 140;
    const rowHeight = 34;
    const newHeight = Math.max(baseHeight, 64 + rowsNeeded * rowHeight + 10);
    
    // Calculate width: 15 terminals per row with professional spacing
    // Each terminal: 30px wide, 32px spacing (2px gap)
    // Terminal area: 15 * 32px = 480px
    // Padding: 16px left + 16px right = 32px
    // Total: 32 + 480 = 512px
    const terminalSpacing = 32;
    const padding = 32; // 16px on each side
    const terminalAreaWidth = slotsPerRow * terminalSpacing; // 15 * 32 = 480px
    const newWidth = padding + terminalAreaWidth; // 32 + 480 = 512px
    
    const rect = tbContainer.querySelector("rect");
    if (rect) {
      rect.setAttribute("width", String(newWidth));
      rect.setAttribute("height", String(newHeight));
    }
    
    // Update SVG viewBox and backplate to accommodate wider terminal blocks
    const currentViewBox = elHwSvg.getAttribute("viewBox");
    if (currentViewBox) {
      const parts = currentViewBox.split(" ").map(Number);
      const minHeight = 240;
      const neededHeight = Math.max(minHeight, 72 + newHeight + 20);
      
      // Calculate needed width: 
      // Power Supply: 38px offset + 260px width = 298px end
      // Terminal Blocks: 320px offset + newWidth
      // Add 20px margin on right side
      const neededWidth = Math.max(980, 320 + newWidth + 20);
      
      if (neededHeight > parts[3] || neededWidth > parts[2]) {
        elHwSvg.setAttribute("viewBox", `0 0 ${neededWidth} ${neededHeight}`);
        
        // Update backplate width to match
        const backplate = elHwSvg.getElementById("backplateRect");
        if (backplate) {
          backplate.setAttribute("width", String(neededWidth - 20)); // 10px margin on each side
        }
      }
    }
  }
}

function renderTerminalBlocks(snap) {
  // Paint TB snap points with landings, and glow “IN” when energized.
  if (!elHwSvg) return;

  // Reset all TB slots (dynamically find all slots)
  const allSlots = elHwSvg.querySelectorAll("[id^='tb'][id$='Rect']");
  for (const rect of allSlots) {
    const id = rect.id.replace("Rect", "");
    rect.setAttribute("fill", "url(#gMetal)");
    rect.setAttribute("stroke", "rgba(15,23,42,.12)");
    rect.setAttribute("stroke-width", "1");
    rect.setAttribute("filter", "");
    
    const txt = document.getElementById(id.replace("Rect", "Txt"));
    if (txt) txt.textContent = "";
    
    const num = document.getElementById(id.replace("Rect", "Num"));
    if (num) {
      const numVal = id.replace("tb", "");
      num.textContent = String(parseInt(numVal, 10));
    }
  }
  const popup = document.getElementById("tbPopup");
  if (popup) popup.style.display = "none";

  const usedTags = getUsedContactTagsInOrder();
  if (!usedTags.length) {
    lastTbAlloc = new Map();
    return;
  }

  // Allocate terminals:
  // - Sensors: 3 terminals (+ / − / IN)
  // - Other DI contacts: 2 terminals (COM / IN)
  let cursor = 1;
  const alloc = new Map();
  const need = (tag) => (isSensorTag(tag) ? 3 : 2);
  
  // Calculate total terminals needed
  let totalTerminals = 0;
  for (const tag of usedTags) {
    totalTerminals += need(tag);
  }
  
  // Allocate all terminals (no limit)
  for (const tag of usedTags) {
    const n = need(tag);
    const slots = Array.from({ length: n }, (_, i) => cursor + i);
    cursor += n;
    alloc.set(tag, { slots, kind: isSensorTag(tag) ? "sensor" : "contact", safety: isSafetyTag(tag) });
  }
  
  // Dynamically create terminal slots if needed
  ensureTerminalSlots(totalTerminals);
  
  // Update status text
  const statusText = document.getElementById("tbStatusText");
  if (statusText) {
    statusText.textContent = totalTerminals > 0 ? `${totalTerminals} terminals` : "Empty (snap points)";
  }
  
  const paint = (n, fillColor, label) => {
    const id = pad2(n);
    const rect = document.getElementById(`tb${id}Rect`);
    const txt = document.getElementById(`tb${id}Txt`);
    const num = document.getElementById(`tb${id}Num`);
    if (rect) {
      rect.setAttribute("fill", fillColor);
      rect.setAttribute("stroke", "rgba(15,23,42,.22)");
    }
    if (txt) txt.textContent = label || "";
    if (num) num.textContent = String(n);
  };

  // Fill labels
  for (const [tag, a] of alloc.entries()) {
    const label = panel.tags?.[tag]?.label || tag;
    const num = Number((tag.match(/\d+/) || ["0"])[0]) || null;
    if (a.kind === "sensor") {
      const chip = `S${num || ""}`.trim();
      paint(a.slots[0], `rgba(239,68,68,.22)`, `${chip}+`);
      paint(a.slots[1], `rgba(59,130,246,.22)`, `${chip}−`);
      paint(a.slots[2], `rgba(15,23,42,.10)`, `${chip}IN`);
    } else {
      const baseFill = a.safety ? `rgba(250,204,21,.22)` : `rgba(15,23,42,.06)`;
      paint(a.slots[0], baseFill, `COM`);
      paint(a.slots[1], baseFill, `IN`);
    }

    // Add hover hint and click handler on each rect
    for (const n of a.slots) {
      const id = pad2(n);
      const rect = document.getElementById(`tb${id}Rect`);
      if (rect) {
        rect.setAttribute("data-tag", tag);
        // Add click handler to highlight this terminal block
        rect.style.cursor = "pointer";
        rect.addEventListener("click", (ev) => {
          ev.stopPropagation();
          clearTerminalHighlight();
          highlightTerminalForTag(tag);
          // Also find and highlight the rung that uses this tag
          highlightRungForTag(tag);
        });
      }
    }
  }

  lastTbAlloc = alloc;
  renderTerminalBlocksLive(snap);
}

function renderTerminalBlocksLive(snap) {
  // Glow “IN” terminals for devices based on live input state.
  if (!snap || !lastCompiled) return;
  for (const [tag, a] of lastTbAlloc.entries()) {
    const addr = lastIoMap?.[tag];
    if (!addr) continue;
    const on = !!snap.inputs?.[addr];
    const inSlot = a.kind === "sensor" ? a.slots[2] : a.slots[1];
    const id = pad2(inSlot);
    const rect = document.getElementById(`tb${id}Rect`);
    if (!rect) continue;
    rect.setAttribute("filter", on ? `url(#${a.safety ? "tbGlowSafety" : "tbGlow"})` : "");
  }
}

function flashTerminalForTag(tag) {
  highlightTerminalForTag(tag);
  if (tbFlashTimer) clearTimeout(tbFlashTimer);
  tbFlashTimer = setTimeout(() => clearTerminalHighlight(), 1800);
}

function highlightTerminalForTag(tag) {
  const a = lastTbAlloc.get(tag);
  if (!a) return;

  // Emphasize stroke
  for (const n of a.slots) {
    const id = pad2(n);
    const rect = document.getElementById(`tb${id}Rect`);
    if (rect) {
      rect.setAttribute("stroke", a.safety ? "rgba(250,204,21,.90)" : "rgba(31,58,95,.70)");
      rect.setAttribute("stroke-width", "2");
    }
  }

  // Popup in the TB group
  const popup = document.getElementById("tbPopup");
  const title = document.getElementById("tbPopupTitle");
  const sub = document.getElementById("tbPopupSub");
  const bg = document.getElementById("tbPopupBg");
  if (!popup || !title || !sub || !bg) return;

  const slotsText = a.slots.map(n => `TB${n}`).join(", ");
  const lbl = panel.tags?.[tag]?.label || tag;
  title.textContent = slotsText;
  sub.textContent = lbl;

  const first = a.slots[0];
      const terminalSpacing = 32;
      const slotsPerRow = 15;
      const x = ((first - 1) % slotsPerRow) * terminalSpacing;
      const y = Math.floor((first - 1) / slotsPerRow) * 34;
  const w = Math.max(170, Math.min(280, 90 + sub.textContent.length * 7));
  bg.setAttribute("width", String(w));
  popup.setAttribute("transform", `translate(${x},${y})`);
  popup.style.display = "block";
}

function clearTerminalHighlight() {
  // Reset all terminal blocks (dynamically find all slots)
  const allSlots = elHwSvg?.querySelectorAll("[id^='tb'][id$='Rect']") || [];
  for (const rect of allSlots) {
    rect.setAttribute("stroke", "rgba(15,23,42,.12)");
    rect.setAttribute("stroke-width", "1");
  }
  const popup = document.getElementById("tbPopup");
  if (popup) popup.style.display = "none";
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function computeLocalPower(rung, snap) {
  // Evaluate branches: OR of (AND of contacts)
  const branches = rung.branches || [rung.contacts || []];
  const branchPowers = branches.map((contacts) => {
    let ok = true;
    for (const c of contacts) {
      const addr = lastIoMap[c.tag]; // tag -> I#
      const v = addr ? !!snap.inputs?.[addr] : false;
      const closed = c.type === "NC" ? !v : v;
      ok = ok && closed;
    }
    return ok;
  });
  return branchPowers.some(Boolean);
}

async function compilePanel() {
  clearMsgs();
  const v = await API.panelValidate(panel);
  if (!v.ok) { msg("err", v.error || "Validation failed"); return null; }
  if (!v.validation.ok) { v.validation.errors.forEach(e => msg("err", e)); return null; }

  const c = await API.panelCompile(panel);
  if (!c.ok) { msg("err", c.error || "Compile failed"); return null; }
  lastCompiled = c.ir;
  lastIoMap = c.ir.ioMap || {};
  if (c.warnings?.length) c.warnings.forEach(w => msg("ok", w));
  msg("ok", "Generated PLC logic successfully.");
  renderTestPanel(); // build toggles using ioMap
  return c.ir;
}

function renderTestPanel() {
  if (!elTestInputs || !elTestOutputs) return;
  elTestInputs.innerHTML = "";
  elTestOutputs.innerHTML = "";
  const ioMap = lastCompiled?.ioMap || {};
  const inputs = Object.entries(ioMap).filter(([, addr]) => String(addr).startsWith("I"));
  const outputs = Object.entries(ioMap).filter(([, addr]) => String(addr).startsWith("Q"));

  // Keep it simple: show tag name + address
  for (const [tag, addr] of inputs) {
    const b = document.createElement("button");
    b.className = "tbtn off";
    b.dataset.addr = addr;
    b.innerHTML = `<div><strong>${escapeHtml(tag)}</strong></div><div class="small">${escapeHtml(addr)} (tap)</div>`;
    b.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
        // Get current state
        const s = await API.state();
        const cur = !!s.inputs?.[addr];
        const newValue = !cur;
        
        // Optimistically update button state
        b.classList.toggle("on", newValue);
        b.classList.toggle("off", !newValue);
        
        // Send API request
        const response = await fetch(`/api/input/${addr}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: newValue })
        });
        
        if (!response.ok) {
          // Revert on error
          b.classList.toggle("on", !newValue);
          b.classList.toggle("off", newValue);
          const err = await response.json().catch(() => ({ error: "Failed to toggle input" }));
          msg("err", err.error || "Failed to toggle input");
        } else {
          // Success - state will update via liveLoop
          // Force immediate state refresh
          const updatedState = await API.state();
          lastSnap = updatedState;
          renderWiringOverview(updatedState);
          renderReasonPanel(updatedState);
        }
      } catch (error) {
        console.error("Test switch error:", error);
        msg("err", "Failed to toggle input: " + (error.message || String(error)));
        // Revert button state on error
        const s = await API.state().catch(() => null);
        if (s) {
          const actualState = !!s.inputs?.[addr];
          b.classList.toggle("on", actualState);
          b.classList.toggle("off", !actualState);
        }
      }
    };
    elTestInputs.appendChild(b);
  }
  for (const [tag, addr] of outputs) {
    const d = document.createElement("div");
    d.className = "tbtn off";
    d.dataset.addr = addr;
    d.innerHTML = `<div><strong>${escapeHtml(tag)}</strong></div><div class="small">${escapeHtml(addr)} (output)</div>`;
    elTestOutputs.appendChild(d);
  }
}

async function showTruthTable() {
  if (!lastCompiled) await compilePanel();
  if (!lastCompiled) return;
  const ioMap = lastCompiled.ioMap || {};
  // Pick first 4 DI tags for table; and first DO
  const inputs = Object.entries(ioMap).filter(([tag, addr]) => String(addr).startsWith("I")).slice(0, 4).map(([, addr]) => addr);
  const outputs = Object.entries(ioMap).filter(([, addr]) => String(addr).startsWith("Q")).slice(0, 1).map(([, addr]) => addr);
  const t = await API.truthTable(lastCompiled, inputs, outputs);
  if (!t.ok) return msg("err", t.error || "Truth table failed");
  const rows = t.table.rows;
  msg("ok", `Truth table generated (${rows.length} rows). See console.`);
  console.log("Truth table:", t.table);
}

async function liveLoop() {
  try {
    const s = await API.state();
    lastSnap = s;
    if (elScan) elScan.textContent = `scan ${s.scanMs}ms`;

    // Highlight wiring/power flow based on compiled ioMap + current inputs
    const railRungs = Array.from(elRail.querySelectorAll(".rung"));
    railRungs.forEach((rEl, idx) => {
      const rung = panel.rungs[idx];
      const branches = rung.branches || [rung.contacts || []];
      const branchRows = Array.from(rEl.querySelectorAll(".branchRow"));
      const overallPower = lastCompiled && Object.keys(lastIoMap).length ? computeLocalPower(rung, s) : false;

      branches.forEach((contacts, bi) => {
        const row = branchRows[bi];
        if (!row) return;
        const nodes = Array.from(row.querySelectorAll(".node"));
        const wires = Array.from(row.querySelectorAll(".wire"));

        // branch power
        let branchPower = true;
        for (const c of contacts) {
          const addr = lastIoMap[c.tag];
          const v = addr ? !!s.inputs?.[addr] : false;
          const closed = c.type === "NC" ? !v : v;
          branchPower = branchPower && closed;
        }

        contacts.forEach((c, ci) => {
          const addr = lastIoMap[c.tag];
          const v = addr ? !!s.inputs?.[addr] : false;
          const closed = c.type === "NC" ? !v : v;
          const n = nodes[ci];
          if (n) {
            n.classList.toggle("on", closed);
            n.classList.toggle("off", !closed);
            const term = n.querySelector(".term");
            if (term) {
              term.classList.toggle("on", closed);
              term.classList.toggle("off", !closed);
            }
          }
          const w = wires[ci];
          if (w) {
            w.classList.add("wireAnim");
            w.classList.toggle("on", branchPower);
            // power flow animation handled by CSS on `.wireAnim.on`
          }
        });

        // coil only on first row
        if (bi === 0) {
          const coilNode = nodes[nodes.length - 1];
          if (coilNode) {
            const coilAddr = lastIoMap[rung.coil.tag];
            const on = coilAddr ? !!s.outputs?.[coilAddr] : false;
            coilNode.classList.toggle("on", on);
            coilNode.classList.toggle("off", !on);
            const term = coilNode.querySelector(".term");
            if (term) {
              term.classList.toggle("on", on);
              term.classList.toggle("off", !on);
            }
          }
        }
      });
    });

    // Update test panel states
    if (lastCompiled) {
      elTestInputs?.querySelectorAll(".tbtn").forEach((b) => {
        const addr = b.dataset.addr;
        if (!addr) return;
        const on = !!s.inputs?.[addr];
        b.classList.toggle("on", on);
        b.classList.toggle("off", !on);
      });
      elTestOutputs?.querySelectorAll(".tbtn").forEach((d) => {
        const addr = d.dataset.addr;
        if (!addr) return;
        const on = !!s.outputs?.[addr];
        d.classList.toggle("on", on);
        d.classList.toggle("off", !on);
      });
    }

    // Reason panel (always visible) - update with latest state
    renderReasonPanel(s);
    
    // Ensure wiring diagram and terminal blocks are updated
    renderWiringOverview(s);
    renderTerminalBlocksLive(s);
    
    // Visual highlighting: match Reason Panel blockers
    if (lastCompiled && s) {
      const coilTag = panel?.rungs?.[0]?.coil?.tag || "Motor M1";
      const rung = panel?.rungs?.[0];
      const branches = rung?.branches || [rung?.contacts || []];
      const blockers = [];
      for (const contacts of branches) {
        for (const c of contacts) {
          if (!contactSatisfied(c, s)) {
            blockers.push(c.tag);
          }
        }
      }
      
      // Highlight blocked contacts in wiring diagram
      railRungs.forEach((rEl, idx) => {
        const rung = panel.rungs[idx];
        const branches = rung.branches || [rung.contacts || []];
        const branchRows = Array.from(rEl.querySelectorAll(".branchRow"));
        branches.forEach((contacts, bi) => {
          const row = branchRows[bi];
          if (!row) return;
          const nodes = Array.from(row.querySelectorAll(".node"));
          contacts.forEach((c, ci) => {
            const n = nodes[ci];
            if (n && blockers.includes(c.tag)) {
              n.classList.add("highlight");
              n.style.boxShadow = "0 0 8px rgba(239,68,68,.6), 0 0 16px rgba(239,68,68,.3)";
            } else if (n) {
              n.classList.remove("highlight");
              n.style.boxShadow = "";
            }
          });
        });
      });
    }
    
    renderWiringOverview(s);
    renderTerminalBlocksLive(s);
  } catch (e) {
    // ignore
  } finally {
    setTimeout(liveLoop, 250);
  }
}

function renderWiringOverview(snap) {
  if (!elWiringSvg) return;

  const rung = panel.rungs?.[activeRung] || panel.rungs?.[0];
  const branches = rung?.branches || [rung?.contacts || []];
  const contacts = branches?.[activeBranch] || branches?.[0] || [];
  const coilTag = rung?.coil?.tag || "Motor M1";
  const coilAddr = lastIoMap?.[coilTag];
  const coilOn = coilAddr && snap ? !!snap.outputs?.[coilAddr] : false;

  // Build a simple series-path model for the selected branch (electrician style)
  const nodes = contacts.map((c) => {
    const label = panel.tags?.[c.tag]?.label || c.tag;
    const safety = isSafetyTag(c.tag);
    const closed = snap && lastCompiled ? contactSatisfied(c, snap) : null; // null = unknown
    return { ...c, label, safety, closed };
  });

  // Determine "power flow" step-by-step: power starts at + and stops at first open.
  let flowing = true;
  for (const n of nodes) {
    n.powerIn = flowing;
    if (n.closed === null) {
      // Unknown -> show as not-animated
      n.powerOut = false;
      flowing = false;
    } else {
      n.powerOut = n.powerIn && !!n.closed;
      flowing = n.powerOut;
    }
  }

  const pad = 12;
  const y = 100;
  const boxW = 180;
  const boxH = 60;
  const gap = 20;

  const startX = 140;
  const maxNodes = Math.min(nodes.length, 6); // More readable with larger size
  const shown = nodes.slice(0, maxNodes);
  const trunc = nodes.length > maxNodes;

  // Calculate actual width needed based on number of devices
  const coilW = 180;
  const supplyX = 40;
  const retMargin = 40;
  
  // Layout device boxes
  const boxXs = shown.map((_, i) => startX + i * (boxW + gap));
  const coilX = startX + shown.length * (boxW + gap) + 10;
  const coilEndX = coilX + coilW;
  const actualWidth = Math.max(1000, coilEndX + retMargin); // Minimum 1000, but grow with content
  
  // Calculate height - more compact
  const h = 200;
  const w = actualWidth;

  // Terminals
  const supply = { x: supplyX, y: y, label: "+", color: "var(--powerL)" };
  const ret = { x: w - retMargin, y: y, label: "−", color: "var(--powerN)" };

  // Wire segments: + -> first box -> ... -> coil -> return
  const segs = [];
  const segOn = (idx) => {
    if (!snap || !lastCompiled) return false;
    if (idx === 0) return shown.length ? (shown[0].powerIn) : true;
    if (idx >= 1 && idx <= shown.length) return shown[idx - 1].powerOut;
    return coilOn;
  };

  // Segment 0: supply to first node (or coil)
  const firstAnchorX = shown.length ? boxXs[0] : coilX;
  segs.push({ x1: supply.x, y1: supply.y, x2: firstAnchorX, y2: y, on: segOn(0), safety: false });

  // Between nodes
  for (let i = 0; i < shown.length; i++) {
    const left = boxXs[i] + boxW;
    const right = (i === shown.length - 1) ? coilX : boxXs[i + 1];
    segs.push({ x1: left, y1: y, x2: right, y2: y, on: segOn(i + 1), safety: shown[i].safety });
  }

  // Coil to return
  segs.push({ x1: coilX + 150, y1: y, x2: ret.x, y2: y, on: coilOn, safety: false });

  const hint = (!snap || !lastCompiled)
    ? "Build PLC Logic to light up the wiring."
    : (trunc ? `Showing first ${maxNodes} devices` : "Live wiring overview");

  const boxesSvg = shown.map((n, i) => {
    const x = boxXs[i];
    const safeCls = n.safety ? "safety" : "";
    const closedTxt = (n.closed === null) ? "?" : (n.closed ? "CLOSED" : "OPEN");
    const typeTxt = `${n.type}`;
    const [t1, t2] = terminalsForPart("contact", n.type);
    const tOn = n.powerIn && n.closed === true;
    const tooltip = `${n.label} (${n.type}): ${n.closed === true ? "ON - Power can flow" : n.closed === false ? "OFF - Blocking power" : "Unknown state"}`;
    return `
      <g data-device-idx="${i}" data-device-tag="${escapeHtml(n.tag)}" style="cursor: pointer;" title="${escapeHtml(tooltip)}">
        <rect class="wNode ${safeCls}" x="${x}" y="${y - boxH/2}" width="${boxW}" height="${boxH}" rx="12"></rect>
        <text class="wLbl" x="${x + 12}" y="${y - 5}" font-size="14">${escapeHtml(n.label)}</text>
        <text class="wSub" x="${x + 12}" y="${y + 12}" font-size="11">${escapeHtml(typeTxt)} · ${escapeHtml(closedTxt)}</text>

        <circle class="wTerm ${tOn ? "on" : ""}" cx="${x + 12}" cy="${y}" r="8"></circle>
        <circle class="wTerm ${tOn ? "on" : ""}" cx="${x + boxW - 12}" cy="${y}" r="8"></circle>
        <text class="wSub" x="${x + 2}" y="${y - 8}" font-size="10">${escapeHtml(t1)}</text>
        <text class="wSub" x="${x + boxW - 18}" y="${y - 8}" font-size="10">${escapeHtml(t2)}</text>
      </g>
    `;
  }).join("");

  const coilSvg = (() => {
    const x = coilX;
    const [a1, a2] = terminalsForPart("coil");
    const tooltip = `${panel.tags?.[coilTag]?.label || coilTag} (COIL): ${coilOn ? "ON - Motor is running!" : "OFF - Motor is stopped"}`;
    return `
      <g data-device-type="coil" data-device-tag="${escapeHtml(coilTag)}" style="cursor: pointer;" title="${escapeHtml(tooltip)}">
        <rect class="wNode" x="${x}" y="${y - boxH/2}" width="150" height="${boxH}" rx="12"></rect>
        <text class="wLbl" x="${x + 12}" y="${y - 5}" font-size="14">${escapeHtml(panel.tags?.[coilTag]?.label || coilTag)}</text>
        <text class="wSub" x="${x + 12}" y="${y + 12}" font-size="11">COIL · ${coilOn ? "ENERGIZED" : "DE‑ENERGIZED"}</text>
        <circle class="wTerm ${coilOn ? "on" : ""}" cx="${x + 12}" cy="${y}" r="8"></circle>
        <circle class="wTerm ${coilOn ? "on" : ""}" cx="${x + 138}" cy="${y}" r="8"></circle>
        <text class="wSub" x="${x + 3}" y="${y - 10}" font-size="10">${escapeHtml(a1)}</text>
        <text class="wSub" x="${x + 128}" y="${y - 10}" font-size="10">${escapeHtml(a2)}</text>
      </g>
    `;
  })();

  // Generate wires with animated particles for energized paths
  const wiresSvg = segs.map((s, idx) => {
    const cls = `wWire ${s.safety ? "safety" : ""} ${s.on ? "on wWireAnim" : ""}`;
    const pathId = `wire-${idx}`;
    const pathLength = Math.sqrt(Math.pow(s.x2 - s.x1, 2) + Math.pow(s.y2 - s.y1, 2));
    const numParticles = s.on ? Math.max(3, Math.floor(pathLength / 100)) : 0;
    
    // Create animated particles that flow along the wire
    const particles = s.on ? Array.from({ length: numParticles }, (_, i) => {
      const progress = i / (numParticles + 1); // Distribute particles along path
      const px = s.x1 + (s.x2 - s.x1) * progress;
      const py = s.y1 + (s.y2 - s.y1) * progress;
      const delay = (i / numParticles) * 1.5;
      return `<circle class="powerParticle ${s.safety ? "safety" : ""}" cx="${px}" cy="${py}" r="7" style="animation-delay: ${delay}s;"></circle>`;
    }).join("") : "";
    
    return `
      <g data-wire-idx="${idx}" data-wire-on="${s.on}" style="cursor: pointer;" title="${s.on ? "Click to trace power flow" : "Wire (no power)"}">
        <path id="${pathId}" class="${cls}" d="M ${s.x1} ${s.y1} L ${s.x2} ${s.y2}"></path>
        ${particles}
      </g>
    `;
  }).join("");

  elWiringSvg.innerHTML = `
    <rect x="${pad}" y="${pad}" width="${w - pad*2}" height="${h - pad*2}" rx="16" fill="rgba(255,255,255,.0)"></rect>
    <text x="${pad}" y="36" class="wSub" font-size="16">${escapeHtml(hint)}</text>

    <!-- supply / return -->
    <g>
      <circle cx="${supply.x}" cy="${supply.y}" r="18" fill="rgba(239,68,68,.14)" stroke="rgba(239,68,68,.55)" stroke-width="2"></circle>
      <text x="${supply.x - 5}" y="${supply.y + 6}" font-size="16" font-weight="950" fill="${supply.color}">${supply.label}</text>
      <circle cx="${ret.x}" cy="${ret.y}" r="18" fill="rgba(59,130,246,.14)" stroke="rgba(59,130,246,.55)" stroke-width="2"></circle>
      <text x="${ret.x - 5}" y="${ret.y + 6}" font-size="16" font-weight="950" fill="${ret.color}">${ret.label}</text>
    </g>

    ${wiresSvg}
    ${boxesSvg}
    ${coilSvg}

    ${trunc ? `<text x="${w - 180}" y="24" class="wSub" font-size="12">… +${nodes.length - maxNodes} more</text>` : ""}
  `;
  
  // Update SVG viewBox to match actual content width
  elWiringSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  
  // Update container height based on content (compact sizing)
  const container = elWiringSvg.closest(".wiringDiagramContainer");
  if (container) {
    // Calculate height based on number of devices (more compact)
    const baseHeight = 200;
    const deviceHeight = shown.length * 15; // Add some space per device
    const calculatedHeight = Math.min(baseHeight + deviceHeight, 300); // Cap at 300px for compact view
    container.style.height = `${calculatedHeight}px`;
    container.style.maxHeight = `${calculatedHeight}px`;
  }
  
  // Update modal if it's open
  updateWiringModal();
  
  // Re-setup drag if modal is open (in case content was re-rendered)
  if (elWiringModal && elWiringModal.style.display !== "none") {
    setupModalDrag();
  }
  
  // Setup click-to-trace handlers
  setupClickToTrace();
}

function contactSatisfied(c, snap) {
  const addr = lastIoMap[c.tag];
  const v = addr ? !!snap?.inputs?.[addr] : false;
  // In this UI language:
  // - NO is closed when pressed/ON (v=true)
  // - NC is closed when OK/closed (v=false)
  return c.type === "NC" ? !v : v;
}

function renderReasonPanel(snap) {
  if (!elReason) return;

  const coilTag = panel?.rungs?.[0]?.coil?.tag || "Motor M1";
  const outAddr = lastIoMap?.[coilTag];
  const outOn = outAddr && snap ? !!snap.outputs?.[outAddr] : false;

  const rung = panel?.rungs?.[0];
  const branches = rung?.branches || [rung?.contacts || []];

  const blockers = [];
  if (snap && lastCompiled) {
    // Find first branch that is "closest" and list blockers on that branch (simple + readable).
    // Also surface safety blockers first.
    for (const contacts of branches) {
      for (const c of contacts) {
        if (!contactSatisfied(c, snap)) {
          const label = panel.tags?.[c.tag]?.label || c.tag;
          const safety = isSafetyTag(c.tag);
          // Translate to electrician language
          const why = c.type === "NC"
            ? `${label} is active (it must be OK/closed)`
            : `${label} is not pressed/ON`;
          blockers.push({ safety, text: why });
        }
      }
    }
  }

  blockers.sort((a, b) => (b.safety ? 1 : 0) - (a.safety ? 1 : 0));

  const title = outOn
    ? `<span class="whyOn">✅ ${escapeHtml(coilTag)} is ENERGIZED</span>`
    : `<span class="whyOff">❌ ${escapeHtml(coilTag)} is DE‑ENERGIZED</span>`;

  let list = "";
  if (!snap || !lastCompiled) {
    // Always show helpful content, never blank
    list = `<div class="hintBox small">
      <strong>Status:</strong> Waiting for program to be built and uploaded.
      <br><br>
      <strong>Next steps:</strong>
      <ol style="margin: 8px 0 0 18px; padding: 0;">
        <li>Click <strong>Build PLC Logic</strong> to compile your panel</li>
        <li>Click <strong>Build + Upload</strong> to send it to the runtime</li>
        <li>The Reason Panel will then show the causal chain</li>
      </ol>
    </div>`;
  } else if (blockers.length) {
    // Show causal chain with full path
    const causalChain = blockers.map(b => {
      const prefix = b.safety ? "🔒 SAFETY: " : "";
      return `<li>${prefix}${escapeHtml(b.text)}</li>`;
    }).join("");
    list = `<div class="small" style="margin-top:8px; margin-bottom:8px;"><strong>Causal chain:</strong></div>
      <ol class="whyList">${causalChain}</ol>
      <div class="small" style="margin-top:8px; color: #475569;">
        Because ${blockers[0].text.toLowerCase()}, ${escapeHtml(coilTag)} cannot energize.
      </div>`;
  } else {
    // All conditions satisfied - show energized state
    if (outOn) {
      list = `<div class="small" style="margin-top:8px;color:#166534;">
        <strong>✅ Power path is complete!</strong>
        <br>All conditions are satisfied and ${escapeHtml(coilTag)} is energized.
      </div>`;
    } else {
      list = `<div class="small" style="margin-top:8px;color:#166534;">
        <strong>✅ Power path is OK.</strong>
        <br>All conditions are satisfied. If ${escapeHtml(coilTag)} is still OFF, check:
        <ul style="margin: 8px 0 0 18px;">
          <li>Output wiring connections</li>
          <li>Program upload status</li>
          <li>PLC runtime state</li>
        </ul>
      </div>`;
    }
  }

  elReason.innerHTML = `
    <div class="reasonCard">
      <div class="reasonTitle">
        <strong>Output status</strong>
        <span class="small">${outAddr ? escapeHtml(outAddr) : ""}</span>
      </div>
      <div style="margin-top:8px;">${title}</div>
      ${list}
    </div>
  `;
}

// --- Drag/drop placement (no modals) ---
let pendingDevice = null;

function showPlacementQuestion(deviceId) {
  if (!elPlaceAsk || !elPlaceHint) return;
  pendingDevice = deviceId;
  const pretty = {
    pb_start: "Start Button",
    pb_stop: "Stop Button",
    pb_estop: "E‑Stop",
    overload: "Overload",
    sensor_pnp: "Sensor (PNP)",
    sensor_npn: "Sensor (NPN)",
    timer: "Timer",
    contactor: "Contactor",
    motor: "Motor"
  }[deviceId] || deviceId;

  elPlaceHint.innerHTML = `Dropped: <strong>${escapeHtml(pretty)}</strong>`;

  // For outputs (contactor/motor), we don't ask NO/NC; we place/use the coil tag.
  if (deviceId === "motor" || deviceId === "contactor") {
    elPlaceAsk.innerHTML = `
      <div class="hintBox small" style="font-size: 14px; line-height: 1.6; padding: 12px; background: rgba(37,99,235,.08); border-radius: 8px;">
        ✅ <strong>Motor added!</strong> This is what turns ON or OFF. Now drag buttons (like Start or Stop) into the wiring area above to control it!
      </div>
    `;
    return;
  }

  const mode = isBeginnerMode();
  const question = mode 
    ? "<strong>One question:</strong> When you press this button, does it turn ON or turn OFF?"
    : "<strong>One question:</strong> how is it wired?";
  const btnNO = mode ? "▶️ Press to Turn ON" : "Normally Open";
  const btnNC = mode ? "⏹️ Press to Turn OFF" : "Normally Closed";
  const tip = mode
    ? '💡 Tip: Stop buttons and Emergency Stop usually use "Press to Turn OFF"'
    : "Use <strong>NC</strong> for Stop / E‑Stop / Overload in most panels.";
  
  elPlaceAsk.innerHTML = `
    <div class="small" style="font-size: 14px; line-height: 1.6;">${question}</div>
    <div class="rowBtns" style="margin-top:12px;">
      <button class="btn" id="btnNO" type="button" style="font-size: 15px; padding: 12px;">${btnNO}</button>
      <button class="btn secondary" id="btnNC" type="button" style="font-size: 15px; padding: 12px;">${btnNC}</button>
    </div>
    <div class="small" style="margin-top:12px; font-size: 13px; color: var(--muted);">
      ${tip}
    </div>
  `;

  elPlaceAsk.querySelector("#btnNO")?.addEventListener("click", () => placePending("NO"));
  elPlaceAsk.querySelector("#btnNC")?.addEventListener("click", () => placePending("NC"));
}

function placePending(norm) {
  if (!pendingDevice) return;
  const id = pendingDevice;
  pendingDevice = null;

  const map = (dev, n) => {
    if (dev === "pb_start") return n === "NC" ? "pb_start_NC" : "pb_start_NO";
    if (dev === "pb_stop") return n === "NC" ? "pb_stop_NC" : "pb_stop_NO";
    if (dev === "pb_estop") return n === "NC" ? "pb_estop_NC" : "pb_estop_NO";
    if (dev === "overload") return n === "NC" ? "overload_NC" : "overload_NO";
    if (dev === "sensor_pnp") return n === "NC" ? "sensor_pnp_NC" : "sensor_pnp_NO";
    if (dev === "sensor_npn") return n === "NC" ? "sensor_npn_NC" : "sensor_npn_NO";
    if (dev === "timer") return n === "NC" ? "timer_NC" : "timer_NO";
    return null;
  };

  const t = map(id, norm);
  if (t) addComponentToActive(t);

  if (elPlaceHint) elPlaceHint.innerHTML = `Placed as <strong>${escapeHtml(norm)}</strong>. Drop another device any time.`;
  if (elPlaceAsk) elPlaceAsk.innerHTML = "";
}

// Setup drag and drop - use event delegation to handle dynamically updated buttons
let dragDropSetup = false;
function setupDragAndDrop() {
  if (dragDropSetup) return; // Only set up once
  dragDropSetup = true;
  
  // Use event delegation on the palette container so it works even when buttons are updated
  const palette = document.querySelector(".palette");
  if (palette) {
    palette.addEventListener("dragstart", (ev) => {
      const btn = ev.target.closest(".pbtn");
      if (!btn) return;
      const id = btn.dataset.device;
      if (!id) return;
      ev.dataTransfer?.setData("text/plain", id);
      ev.dataTransfer.effectAllowed = "copy";
    });
  }

  // Drop zone: the control wiring rail (where rungs are displayed)
  const dropZones = [elRail].filter(Boolean);
  dropZones.forEach(zone => {
    zone.addEventListener("dragover", (ev) => { 
      ev.preventDefault(); 
      ev.dataTransfer.dropEffect = "copy";
    });
    zone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer?.getData("text/plain");
      if (!id) return;
      showPlacementQuestion(id);
    });
  });
  
  // Also allow dropping on the panel backdrop (hardware area)
  const panelBackdrop = document.getElementById("panelBackdrop");
  if (panelBackdrop) {
    panelBackdrop.addEventListener("dragover", (ev) => { 
      ev.preventDefault(); 
      ev.dataTransfer.dropEffect = "copy";
    });
    panelBackdrop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer?.getData("text/plain");
      if (!id) return;
      showPlacementQuestion(id);
    });
  }
  
  // In Beginner mode, allow dropping directly on wiring diagram
  const wiringDiagramContainer = document.querySelector(".wiringDiagramContainer");
  if (wiringDiagramContainer) {
    wiringDiagramContainer.addEventListener("dragover", (ev) => {
      if (isBeginnerMode()) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        wiringDiagramContainer.classList.add("dragOver");
      }
    });
    
    wiringDiagramContainer.addEventListener("dragleave", (ev) => {
      if (isBeginnerMode()) {
        // Only remove if we're actually leaving the container
        const rect = wiringDiagramContainer.getBoundingClientRect();
        if (ev.clientX < rect.left || ev.clientX > rect.right || 
            ev.clientY < rect.top || ev.clientY > rect.bottom) {
          wiringDiagramContainer.classList.remove("dragOver");
        }
      }
    });
    
    wiringDiagramContainer.addEventListener("drop", (ev) => {
      if (isBeginnerMode()) {
        ev.preventDefault();
        wiringDiagramContainer.classList.remove("dragOver");
        const id = ev.dataTransfer?.getData("text/plain");
        if (!id) return;
        // In beginner mode, directly add to the active rung
        showPlacementQuestion(id);
      }
    });
  }
}

// Setup drag and drop on page load (after DOM is ready)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupDragAndDrop);
} else {
  setupDragAndDrop();
}
document.getElementById("btnAddRung").onclick = () => {
  panel.rungs.push({ branches: [[]], coil: { tag: "Motor M1", action: "COIL" } });
  activeRung = panel.rungs.length - 1;
  activeBranch = 0;
  render();
};
document.getElementById("btnAddBranch").onclick = () => {
  const rung = panel.rungs[activeRung] || panel.rungs[panel.rungs.length - 1];
  rung.branches = rung.branches || [rung.contacts || []];
  rung.branches.push([]);
  activeBranch = rung.branches.length - 1;
  render();
};
document.getElementById("btnCompile").onclick = compilePanel;
document.getElementById("btnUpload").onclick = async () => {
  // Use imported IR if available, otherwise compile
  let ir = window.importedIR;
  if (!ir) {
    ir = await compilePanel();
    if (!ir) return;
  } else {
    // Clear imported IR after use
    window.importedIR = null;
  }
  const r = await API.uploadIR(ir);
  if (!r.ok) {
    msg("err", r.error || "Upload failed");
    return;
  }
  
  msg("ok", "Uploaded to runtime. Refreshing state...");
  
  // Refresh state after upload to update Reason Panel and wiring diagram
  try {
    const updatedState = await API.state();
    lastSnap = updatedState;
    renderWiringOverview(updatedState);
    renderReasonPanel(updatedState);
    renderTerminalBlocks(updatedState);
  } catch (e) {
    console.error("Failed to refresh state after upload:", e);
  }
};
document.getElementById("btnTruth").onclick = showTruthTable;

// First Motor template - removed per user request (replaced with goal panel)
// document.getElementById("btnFirstMotor")?.addEventListener("click", async () => {
//   try {
//     const r = await fetch("/api/template/first-motor");
//     const data = await r.json();
//     if (!data.ok || !data.ir) {
//       msg("err", "Failed to load First Motor template");
//       return;
//     }
//     
//     // Load the template IR and devices
//     const ir = data.ir;
//     panel = {
//       name: "First Motor",
//       tags: {},
//       rungs: [],
//       metadata: ir.metadata || {}
//     };
//     
//     // Convert IR to panel format (simplified - just upload the IR directly)
//     window.importedIR = ir;
//     localStorage.setItem("project.goal", ir.metadata?.goal || "Control a motor with Start/Stop pushbuttons and E-Stop safety");
//     
//     // Upload directly
//     const uploadR = await API.uploadIR(ir);
//     if (!uploadR.ok) {
//       msg("err", uploadR.error || "Upload failed");
//       return;
//     }
//     
//     msg("ok", "First Motor template loaded and uploaded. Open Monitor to test.");
//     render();
//     updateGoalDisplay();
//   } catch (e) {
//     msg("err", `Error: ${e.message}`);
//   }
// });

// Goal display removed - no longer needed

// Safety panel handlers
function renderSafetyPanel() {
  const elEStops = document.getElementById("safetyPanelEStops");
  const elInterlocks = document.getElementById("safetyPanelInterlocks");
  if (!elEStops || !elInterlocks) return;
  
  const eStops = Object.entries(panel.tags || {}).filter(([tag, info]) => 
    info.group === "safety" && (tag.toLowerCase().includes("e-stop") || tag.toLowerCase().includes("estop"))
  );
  const interlocks = Object.entries(panel.tags || {}).filter(([tag, info]) => 
    info.group === "safety" && !tag.toLowerCase().includes("e-stop") && !tag.toLowerCase().includes("estop")
  );
  
  elEStops.innerHTML = eStops.length > 0 
    ? `<div class="small" style="color: var(--safety);">E-Stops: ${eStops.map(([t]) => t).join(", ")}</div>`
    : `<div class="small" style="color: var(--muted);">No E-Stops configured</div>`;
  
  elInterlocks.innerHTML = interlocks.length > 0
    ? `<div class="small" style="color: var(--safety);">Interlocks: ${interlocks.map(([t]) => t).join(", ")}</div>`
    : `<div class="small" style="color: var(--muted);">No interlocks configured</div>`;
}

document.getElementById("btnPanelAddEStop")?.addEventListener("click", () => {
  addComponentToActive("pb_estop_NC");
  render();
  renderSafetyPanel();
});

document.getElementById("btnPanelAddOverload")?.addEventListener("click", () => {
  addComponentToActive("overload_NC");
  render();
  renderSafetyPanel();
});

// Update UI for unified mode (simple language + OT terms)
function updateUIForMode() {
  // Unified mode: merge beginner and advanced, prefer beginner text but show all features
  const elements = document.querySelectorAll("[data-beginner][data-advanced]");
  
  elements.forEach(el => {
    const beginnerText = el.getAttribute("data-beginner");
    const advancedText = el.getAttribute("data-advanced");
    
    // Use beginner text if available, otherwise advanced text
    // Merge: prefer simple language but keep OT terms
    const mergedText = beginnerText || advancedText;
    
    if (mergedText) {
      if (el.tagName === "BUTTON" || el.tagName === "INPUT") {
        el.textContent = mergedText;
      } else {
        el.innerHTML = mergedText;
      }
    }
    
    // Show all elements in unified mode (no hiding)
    el.style.display = "";
  });
  
  // Update explainText
  const explainText = document.getElementById("explainText");
  if (explainText) {
    if (!explainText.hasAttribute("data-beginner")) {
      explainText.setAttribute("data-beginner", 'Click "Generate Logic" to see what your circuit does in plain English!');
    }
    explainText.innerHTML = explainText.getAttribute("data-beginner") || 'Click "Generate Logic" to see what your circuit does!';
    explainText.style.fontSize = "13px";
    explainText.style.lineHeight = "1.6";
  }
  
  // Update rung titles
  render();
  
  // Update tooltips
  setupTooltips();
  
  // Re-setup troubleshoot and animate buttons
  setupTroubleshootButton();
  setupAnimateButton();
}

// Listen for mode changes
const modeObserver = new MutationObserver(() => {
  updateUIForMode();
});
modeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-mode"] });

// Initial mode update
updateUIForMode();

// Click-to-trace power flow
let traceMode = false;
let tracedPath = null;

function setupClickToTrace() {
  if (!elWiringSvg) return;
  
  // Remove old listeners
  const oldListeners = elWiringSvg.querySelectorAll("[data-trace-listener]");
  oldListeners.forEach(el => {
    el.removeEventListener("click", el._traceHandler);
    el.removeAttribute("data-trace-listener");
  });
  
  // Add click handlers to devices and wires
  const devices = elWiringSvg.querySelectorAll("[data-device-idx], [data-device-type]");
  devices.forEach(device => {
    if (!device.hasAttribute("data-trace-listener")) {
      device.setAttribute("data-trace-listener", "true");
      device._traceHandler = (e) => {
        tracePowerFlow(device);
        // Also highlight terminals for this device
        highlightTerminalsForDevice(device, e);
      };
      device.addEventListener("click", device._traceHandler);
    }
  });
  
  const wires = elWiringSvg.querySelectorAll("[data-wire-idx]");
  wires.forEach(wire => {
    if (!wire.hasAttribute("data-trace-listener")) {
      wire.setAttribute("data-trace-listener", "true");
      wire._traceHandler = () => tracePowerFlow(wire);
      wire.addEventListener("click", wire._traceHandler);
    }
  });
}

// Highlight terminals when clicking on a device in the wiring diagram
function highlightTerminalsForDevice(device, event) {
  // Extract tag from device
  const tag = device.getAttribute("data-device-tag");
  if (!tag) return;
  
  // Clear any previous terminal highlights
  clearTerminalHighlight();
  
  // Check if this tag has terminals allocated (inputs only, outputs/coils don't have terminal blocks)
  const hasTerminals = lastTbAlloc && lastTbAlloc.has(tag);
  
  if (hasTerminals) {
    // Highlight terminals for this tag (inputs)
    highlightTerminalForTag(tag);
    
    // Clear highlight after a delay
    if (tbFlashTimer) clearTimeout(tbFlashTimer);
    tbFlashTimer = setTimeout(() => {
      clearTerminalHighlight();
    }, 3000);
  } else {
    // For outputs/coils, they don't have terminal blocks (outputs go directly to the output module)
    // Just highlight the rung, no terminal highlighting needed
  }
  
  // Always highlight the rung that uses this tag
  highlightRungForTag(tag);
  
  // Add visual feedback to the clicked device
  const rect = device.querySelector("rect");
  if (rect) {
    rect.classList.add("deviceHighlight");
    setTimeout(() => {
      rect.classList.remove("deviceHighlight");
    }, 1500);
  }
}

function tracePowerFlow(element) {
  // Clear previous trace
  clearTrace();
  
  const rung = panel.rungs?.[activeRung] || panel.rungs?.[0];
  const branches = rung?.branches || [rung?.contacts || []];
  const contacts = branches?.[activeBranch] || branches?.[0] || [];
  const coilTag = rung?.coil?.tag || "Motor M1";
  
  // Determine what was clicked
  const deviceIdx = element.getAttribute("data-device-idx");
  const deviceType = element.getAttribute("data-device-type");
  const wireIdx = element.getAttribute("data-wire-idx");
  
  tracedPath = {
    devices: [],
    wires: [],
    coil: deviceType === "coil"
  };
  
  // Trace from power supply to clicked element
  if (deviceIdx !== null) {
    const idx = parseInt(deviceIdx);
    // Highlight all devices and wires up to this point
    for (let i = 0; i <= idx; i++) {
      tracedPath.devices.push(i);
      if (i > 0) tracedPath.wires.push(i - 1);
    }
  } else if (deviceType === "coil") {
    // Highlight entire path to coil
    for (let i = 0; i < contacts.length; i++) {
      tracedPath.devices.push(i);
      tracedPath.wires.push(i);
    }
    tracedPath.coil = true;
  } else if (wireIdx !== null) {
    const idx = parseInt(wireIdx);
    // Highlight up to this wire
    tracedPath.wires.push(idx);
    if (idx < contacts.length) {
      for (let i = 0; i <= idx; i++) {
        tracedPath.devices.push(i);
      }
    }
  }
  
  // Apply trace highlighting
  applyTraceHighlight();
}

function clearTrace() {
  if (!elWiringSvg) return;
  elWiringSvg.querySelectorAll(".wireTrace, .nodeTrace, .coilTrace").forEach(el => {
    el.classList.remove("wireTrace", "nodeTrace", "coilTrace");
  });
  tracedPath = null;
}

function applyTraceHighlight() {
  if (!tracedPath || !elWiringSvg) return;
  
  // Highlight devices
  tracedPath.devices.forEach(idx => {
    const device = elWiringSvg.querySelector(`[data-device-idx="${idx}"]`);
    if (device) {
      const rect = device.querySelector("rect");
      const circles = device.querySelectorAll("circle");
      if (rect) rect.classList.add("nodeTrace");
      circles.forEach(c => c.classList.add("nodeTrace"));
    }
  });
  
  // Highlight wires
  tracedPath.wires.forEach(idx => {
    const wire = elWiringSvg.querySelector(`[data-wire-idx="${idx}"]`);
    if (wire) {
      const path = wire.querySelector("path");
      if (path) path.classList.add("wireTrace");
    }
  });
  
  // Highlight coil
  if (tracedPath.coil) {
    const coil = elWiringSvg.querySelector("[data-device-type='coil']");
    if (coil) {
      const rect = coil.querySelector("rect");
      const circles = coil.querySelectorAll("circle");
      if (rect) rect.classList.add("coilTrace");
      circles.forEach(c => c.classList.add("coilTrace"));
    }
  }
}

// Export wiring diagram
document.getElementById("btnExportDiagram")?.addEventListener("click", () => {
  if (!elWiringSvg) return;
  
  const svg = elWiringSvg.cloneNode(true);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  
  // Get SVG as string
  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  
  // Create download link
  const downloadLink = document.createElement("a");
  downloadLink.href = svgUrl;
  downloadLink.download = `wiring_diagram_${Date.now()}.svg`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(svgUrl);
  
  msg("ok", "Wiring diagram exported!");
});

// Troubleshoot button - moved to setupTroubleshootButton() function

// Power flow animation mode
let animationMode = false;
let animationStep = 0;
let animationInterval = null;

// Setup animate button with proper event handling
function setupAnimateButton() {
  const btn = document.getElementById("btnAnimateFlow");
  if (!btn) return;
  
  // Remove old listeners
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  
  newBtn.addEventListener("click", () => {
    if (!lastCompiled) {
      msg("warn", "Generate Logic first to see the animation!");
      return;
    }
    
    animationMode = !animationMode;
    
    if (animationMode) {
      newBtn.textContent = "⏸️ Pause";
      newBtn.classList.add("active");
      newBtn.style.background = "var(--energized)";
      newBtn.style.color = "#fff";
      startPowerFlowAnimation();
    } else {
      newBtn.textContent = "▶️ Animate";
      newBtn.classList.remove("active");
      newBtn.style.background = "";
      newBtn.style.color = "";
      stopPowerFlowAnimation();
    }
  });
}

// Setup troubleshoot button with proper event handling
// View toggle functionality
function setupViewToggle() {
  const toggles = document.querySelectorAll(".viewToggle");
  const savedView = localStorage.getItem("wiringView") || "both";
  
  // Set initial view after a short delay to ensure DOM is ready
  setTimeout(() => {
    setWiringView(savedView);
  }, 100);
  
  toggles.forEach(toggle => {
    toggle.addEventListener("click", () => {
      const view = toggle.getAttribute("data-view");
      setWiringView(view);
      localStorage.setItem("wiringView", view);
    });
  });
}

function setWiringView(view) {
  if (!elWiringColumns) return;
  
  // Remove all view classes
  elWiringColumns.classList.remove("view-both", "view-rules", "view-wiring");
  // Add the selected view class
  elWiringColumns.classList.add(`view-${view}`);
  
  // Update button states
  document.querySelectorAll(".viewToggle").forEach(btn => {
    if (btn.getAttribute("data-view") === view) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// Pop-out modal functionality
function setupPopOutModal() {
  const btnPopOut = document.getElementById("btnPopOutDiagram");
  const btnClose = document.getElementById("btnCloseModal");
  
  if (btnPopOut) {
    btnPopOut.addEventListener("click", openWiringModal);
    // Keyboard shortcut: P for pop-out
    document.addEventListener("keydown", (e) => {
      if (e.key === "p" && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        openWiringModal();
      }
    });
  }
  
  if (btnClose) {
    btnClose.addEventListener("click", closeWiringModal);
  }
  
  // Close on background click
  if (elWiringModal) {
    elWiringModal.addEventListener("click", (e) => {
      if (e.target === elWiringModal) {
        closeWiringModal();
      }
    });
  }
  
  // Close on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && elWiringModal && elWiringModal.style.display !== "none") {
      closeWiringModal();
    }
  });
  
  // Setup modal buttons (troubleshoot, export, animate)
  const btnTroubleshootModal = document.getElementById("btnTroubleshootModal");
  const btnExportModal = document.getElementById("btnExportDiagramModal");
  const btnAnimateModal = document.getElementById("btnAnimateFlowModal");
  
  if (btnTroubleshootModal) {
    btnTroubleshootModal.addEventListener("click", () => {
      const btn = document.getElementById("btnTroubleshoot");
      if (btn) btn.click();
    });
  }
  
  if (btnExportModal) {
    btnExportModal.addEventListener("click", () => {
      const btn = document.getElementById("btnExportDiagram");
      if (btn) btn.click();
    });
  }
  
  if (btnAnimateModal) {
    btnAnimateModal.addEventListener("click", () => {
      const btn = document.getElementById("btnAnimateFlow");
      if (btn) btn.click();
    });
  }
}

function openWiringModal() {
  if (!elWiringModal || !elWiringSvg || !elWiringSvgModal) return;
  
  // Copy the SVG content to the modal
  const svgContent = elWiringSvg.innerHTML;
  const viewBox = elWiringSvg.getAttribute("viewBox");
  
  elWiringSvgModal.innerHTML = svgContent;
  if (viewBox) {
    elWiringSvgModal.setAttribute("viewBox", viewBox);
  }
  
  // Show modal
  elWiringModal.style.display = "flex";
  document.body.style.overflow = "hidden"; // Prevent background scrolling
  
  // Initialize drag functionality
  setupModalDrag();
}

function closeWiringModal() {
  if (!elWiringModal) return;
  elWiringModal.style.display = "none";
  document.body.style.overflow = ""; // Restore scrolling
}

// Make modal draggable and movable to other screens
function setupModalDrag() {
  const modalContent = document.getElementById("wiringModalContent");
  const modalHeader = document.getElementById("wiringModalHeader");
  if (!modalContent || !modalHeader) return;
  
  let isDragging = false;
  let isResizing = false;
  let startX, startY, startLeft, startTop, startWidth, startHeight;
  
  // Load saved position
  const savedPos = localStorage.getItem("wiringModalPosition");
  if (savedPos) {
    try {
      const pos = JSON.parse(savedPos);
      modalContent.style.left = pos.left + "px";
      modalContent.style.top = pos.top + "px";
      if (pos.width) modalContent.style.width = pos.width + "px";
      if (pos.height) modalContent.style.height = pos.height + "px";
    } catch (e) {
      // Ignore parse errors
    }
  } else {
    // Center on first open
    const rect = modalContent.getBoundingClientRect();
    modalContent.style.left = (window.innerWidth / 2 - rect.width / 2) + "px";
    modalContent.style.top = (window.innerHeight / 2 - rect.height / 2) + "px";
  }
  
  // Drag functionality on header
  modalHeader.addEventListener("mousedown", (e) => {
    if (e.target.id === "btnCloseModal") return; // Don't drag when clicking close button
    isDragging = true;
    modalContent.classList.add("dragging");
    startX = e.clientX;
    startY = e.clientY;
    const rect = modalContent.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });
  
  // Resize functionality (bottom-right corner)
  const createResizeHandle = () => {
    let resizeHandle = modalContent.querySelector(".resize-handle");
    if (!resizeHandle) {
      resizeHandle = document.createElement("div");
      resizeHandle.className = "resize-handle";
      resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        right: 0;
        width: 20px;
        height: 20px;
        cursor: nwse-resize;
        background: linear-gradient(-45deg, transparent 40%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.2) 50%, transparent 50%, transparent 60%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.2) 70%, transparent 70%);
        z-index: 10;
      `;
      modalContent.appendChild(resizeHandle);
      
      resizeHandle.addEventListener("mousedown", (e) => {
        isResizing = true;
        modalContent.classList.add("resizing");
        startX = e.clientX;
        startY = e.clientY;
        const rect = modalContent.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        e.preventDefault();
        e.stopPropagation();
      });
    }
    return resizeHandle;
  };
  
  createResizeHandle();
  
  // Mouse move handler
  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const newLeft = startLeft + deltaX;
      const newTop = startTop + deltaY;
      
      // Allow negative positions for multi-monitor setups
      modalContent.style.left = newLeft + "px";
      modalContent.style.top = newTop + "px";
    } else if (isResizing) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const newWidth = Math.max(400, startWidth + deltaX);
      const newHeight = Math.max(300, startHeight + deltaY);
      modalContent.style.width = newWidth + "px";
      modalContent.style.height = newHeight + "px";
    }
  });
  
  // Mouse up handler
  document.addEventListener("mouseup", () => {
    if (isDragging || isResizing) {
      isDragging = false;
      isResizing = false;
      modalContent.classList.remove("dragging", "resizing");
      
      // Save position
      const rect = modalContent.getBoundingClientRect();
      const pos = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      localStorage.setItem("wiringModalPosition", JSON.stringify(pos));
    }
  });
}

// Update modal when wiring diagram changes
function updateWiringModal() {
  if (!elWiringModal || !elWiringSvg || !elWiringSvgModal) return;
  if (elWiringModal.style.display === "none") return; // Only update if modal is open
  
  // Copy updated SVG content
  const svgContent = elWiringSvg.innerHTML;
  const viewBox = elWiringSvg.getAttribute("viewBox");
  
  elWiringSvgModal.innerHTML = svgContent;
  if (viewBox) {
    elWiringSvgModal.setAttribute("viewBox", viewBox);
  }
}

function setupTroubleshootButton() {
  const btn = document.getElementById("btnTroubleshoot");
  if (!btn) return;
  
  // Remove old listeners
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  
  newBtn.addEventListener("click", () => {
    if (!lastCompiled || !lastSnap) {
      msg("warn", "✨ Generate Logic first, then test it to see what's wrong!");
      return;
    }
    
    const rung = panel.rungs?.[activeRung] || panel.rungs?.[0];
    if (!rung) {
      msg("warn", "Add some buttons and a motor first!");
      return;
    }
    
    const branches = rung?.branches || [rung?.contacts || []];
    const contacts = branches?.[activeBranch] || branches?.[0] || [];
    const coilTag = rung?.coil?.tag || "Motor M1";
    const coilAddr = lastIoMap?.[coilTag];
    const coilOn = coilAddr ? !!lastSnap.outputs?.[coilAddr] : false;
    
    // Find blocking contacts
    const blockers = [];
    let powerFlowing = true;
    contacts.forEach((c, idx) => {
      const satisfied = contactSatisfied(c, lastSnap);
      if (!satisfied && powerFlowing) {
        blockers.push({ contact: c, idx, tag: c.tag });
        powerFlowing = false; // Power stops at first blocker
      }
    });
    
    // Highlight blocking devices in wiring diagram
    clearTrace();
    if (elWiringSvg) {
      blockers.forEach(blocker => {
        const device = elWiringSvg.querySelector(`[data-device-idx="${blocker.idx}"]`);
        if (device) {
          const rect = device.querySelector("rect");
          const circles = device.querySelectorAll("circle");
          if (rect) {
            rect.classList.add("troubleshootHighlight");
            setTimeout(() => rect.classList.remove("troubleshootHighlight"), 4000);
          }
          circles.forEach(c => {
            c.classList.add("troubleshootHighlight");
            setTimeout(() => c.classList.remove("troubleshootHighlight"), 4000);
          });
        }
      });
      
      // Highlight blocking wires
      if (blockers.length > 0 && blockers[0].idx < contacts.length) {
        const wireIdx = blockers[0].idx;
        const wire = elWiringSvg.querySelector(`[data-wire-idx="${wireIdx}"]`);
        if (wire) {
          wire.classList.add("troubleshootHighlight");
          setTimeout(() => wire.classList.remove("troubleshootHighlight"), 4000);
        }
      }
    }
    
    // Also highlight in rung view
    const rungEl = elRail?.querySelectorAll(".rung")?.[activeRung];
    if (rungEl) {
      const branchRow = rungEl.querySelectorAll(".branchRow")?.[activeBranch];
      if (branchRow) {
        const nodes = Array.from(branchRow.querySelectorAll(".node"));
        blockers.forEach(blocker => {
          if (nodes[blocker.idx]) {
            nodes[blocker.idx].classList.add("troubleshootHighlight");
            setTimeout(() => nodes[blocker.idx].classList.remove("troubleshootHighlight"), 4000);
          }
        });
      }
    }
    
    if (blockers.length > 0) {
      const blockerNames = blockers.map(b => {
        const label = panel.tags?.[b.tag]?.label || b.tag;
        return label;
      }).join(", ");
      msg("warn", `🔍 Found ${blockers.length} thing${blockers.length > 1 ? "s" : ""} blocking power: ${blockerNames}. Highlighted in red!`);
    } else if (!coilOn) {
      msg("info", "🔍 Everything looks good, but the motor is still OFF. Did you click 'Generate Logic + Test'?");
    } else {
      msg("ok", "✅ Everything is working! Your motor is ON! 🎉");
    }
  });
}

// Initial setup
setupTroubleshootButton();
setupAnimateButton();
setupViewToggle();
setupPopOutModal();

function startPowerFlowAnimation() {
  if (animationInterval) return;
  
  const rung = panel.rungs?.[activeRung] || panel.rungs?.[0];
  const branches = rung?.branches || [rung?.contacts || []];
  const contacts = branches?.[activeBranch] || branches?.[0] || [];
  
  if (contacts.length === 0) {
    msg("warn", "Add some devices to your circuit to see the animation!");
    return;
  }
  
  animationStep = 0;
  const totalSteps = contacts.length + 2; // +1 for supply wire, +1 for coil
  
  msg("info", "▶️ Animation started! Watch power flow step-by-step through your circuit.");
  
  animationInterval = setInterval(() => {
    clearTrace();
    
    tracedPath = {
      devices: [],
      wires: [],
      coil: animationStep >= contacts.length + 1
    };
    
    // Step 0: Just supply wire
    if (animationStep === 0) {
      tracedPath.wires.push(0);
    } else {
      // Steps 1+: Devices and wires
      for (let i = 0; i < animationStep && i < contacts.length; i++) {
        tracedPath.devices.push(i);
        if (i > 0) tracedPath.wires.push(i);
      }
      if (animationStep > 0 && animationStep <= contacts.length) {
        tracedPath.wires.push(animationStep);
      }
      // Final step: Coil
      if (animationStep >= contacts.length + 1) {
        tracedPath.coil = true;
        tracedPath.wires.push(contacts.length + 1); // Coil wire
      }
    }
    
    applyTraceHighlight();
    
    animationStep++;
    if (animationStep >= totalSteps) {
      animationStep = 0; // Loop
    }
  }, 1000);
}

function stopPowerFlowAnimation() {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  clearTrace();
}

// Keyboard shortcuts
document.addEventListener("keydown", (ev) => {
  // Don't trigger shortcuts when typing in inputs
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.isContentEditable) return;
  
  // Space: Toggle first test input (if in test mode)
  if (ev.code === "Space" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    const firstInput = document.querySelector("#testInputs .tbtn");
    if (firstInput) firstInput.click();
  }
  
  // R: Add new rung
  if (ev.code === "KeyR" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
    ev.preventDefault();
    const btn = document.getElementById("btnAddRung");
    if (btn) btn.click();
  }
  
  // B: Add branch
  if (ev.code === "KeyB" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
    ev.preventDefault();
    const btn = document.getElementById("btnAddBranch");
    if (btn && btn.offsetParent !== null) { // Only if visible
      btn.click();
    }
  }
  
  // Enter/Ctrl+Enter: Build PLC Logic
  if (ev.code === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    const btn = document.getElementById("btnCompile");
    if (btn) btn.click();
  }
  
  // Escape: Clear trace/troubleshooting/animation
  if (ev.code === "Escape") {
    clearTrace();
    stopPowerFlowAnimation();
    if (animationMode) {
      animationMode = false;
      const btn = document.getElementById("btnAnimateFlow");
      if (btn) {
        btn.textContent = "▶️ Animate";
        btn.classList.remove("active");
        btn.style.background = "";
        btn.style.color = "";
      }
    }
    // Clear troubleshooting highlights
    if (elWiringSvg) {
      elWiringSvg.querySelectorAll(".troubleshootHighlight").forEach(el => {
        el.classList.remove("troubleshootHighlight");
      });
    }
  }
  
  // T: Toggle troubleshoot
  if (ev.code === "KeyT" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
    ev.preventDefault();
    const btn = document.getElementById("btnTroubleshoot");
    if (btn) btn.click();
  }
  
  // A: Toggle animation
  if (ev.code === "KeyA" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
    ev.preventDefault();
    const btn = document.getElementById("btnAnimateFlow");
    if (btn) btn.click();
  }
  
  // E: Export diagram
  if (ev.code === "KeyE" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
    ev.preventDefault();
    const btn = document.getElementById("btnExportDiagram");
    if (btn) btn.click();
  }
});

// Interactive tooltips for device buttons
function setupTooltips() {
  const mode = isBeginnerMode();
  const tooltips = {
    "pb_start": mode ? "▶️ Start Button: Press this to turn the motor ON" : "Start Button (NO): Press to energize output",
    "pb_stop": mode ? "⏹️ Stop Button: Press this to turn the motor OFF" : "Stop Button (NC): Press to de-energize output",
    "pb_estop": mode ? "🛑 Emergency Stop: Press this to stop everything immediately (safety)" : "E-Stop (NC): Emergency stop safety device",
    "motor": mode ? "🔌 Motor: This is what turns ON or OFF. Drag buttons to control it!" : "Motor: Output device controlled by logic",
    "overload": mode ? "⚠️ Overload Protection: Stops motor if it gets too hot (safety)" : "Overload (NC): Thermal overload protection",
    "sensor_pnp": mode ? "📡 Sensor: Detects when something is present" : "Sensor (PNP): Proximity sensor input",
    "timer": mode ? "⏱️ Timer: Waits for a certain amount of time before doing something" : "Timer: Time delay function"
  };
  
  document.querySelectorAll(".pbtn").forEach(btn => {
    const deviceId = btn.dataset.device;
    if (deviceId && tooltips[deviceId]) {
      btn.setAttribute("title", tooltips[deviceId]);
    }
  });
  
  // Add tooltips to action buttons
  const btnCompile = document.getElementById("btnCompile");
  if (btnCompile) {
    btnCompile.setAttribute("title", mode ? "✨ Make your circuit work! This builds the logic." : "Build PLC Logic: Compile panel to ladder IR");
  }
  
  const btnUpload = document.getElementById("btnUpload");
  if (btnUpload) {
    btnUpload.setAttribute("title", mode ? "🚀 Build and test your circuit right away!" : "Build + Upload: Compile and upload to runtime");
  }
  
  const btnAddRung = document.getElementById("btnAddRung");
  if (btnAddRung) {
    btnAddRung.setAttribute("title", mode ? "➕ Add another rule to control something else" : "Add Rung: Create a new logic rung");
  }
}

// Only render if not already rendered by tryLoadImportedData
if (!importedDataLoaded) {
  render();
}
updateGoalDisplay();
renderSafetyPanel();
setupTooltips();
if (seedLoadedFromWizard) {
  const label = seedLoadedFromWizard.name || seedLoadedFromWizard.wizardId || "wizard";
  msg("ok", `Loaded panel from Control Templates (${label}).`);
}
liveLoop();

