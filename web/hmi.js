const elScanInfo = document.getElementById("scanInfo");
const elInterlockView = document.getElementById("interlockView");
const elSystemOverview = document.getElementById("systemOverview");
const elFaceplateList = document.getElementById("faceplateList");
const elFaceplateEditor = document.getElementById("faceplateEditor");
const elFaceplateCanvas = document.getElementById("faceplateCanvas");
const elFaceplateName = document.getElementById("faceplateName");
const hmiTabs = document.querySelectorAll(".hmiTab");
const tabContents = document.querySelectorAll(".tabContent");

let lastState = null;
let lastProgram = null;
let faceplates = JSON.parse(localStorage.getItem("hmi.faceplates") || "[]");
let editingFaceplate = null;

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

async function renderInterlockView() {
  if (!elInterlockView) return;
  elInterlockView.innerHTML = "";

  const outputs = collectOutputs(lastProgram?.ir || {});
  if (!outputs.length) {
    elInterlockView.innerHTML = `<div class="small">No outputs found. Upload a program to see interlocks.</div>`;
    return;
  }

  for (const out of outputs) {
    const val = out.var.startsWith("Q") ? !!lastState?.outputs?.[out.var] : !!lastState?.mem?.[out.var];
    const explain = await apiExplain(out.var);
    
    const card = document.createElement("div");
    card.className = `interlockCard ${val ? "on" : "off"}`;
    
    const perms = [];
    if (explain?.ok && explain.explanation?.reasons) {
      for (const r of explain.explanation.reasons) {
        for (const b of r.blockers || []) {
          perms.push({
            text: b.text || b.label || b.var,
            satisfied: false
          });
        }
      }
    }

    const addrToTag = {};
    const ir = lastProgram?.ir || {};
    for (const [tag, addr] of Object.entries(ir.ioMap || {})) {
      addrToTag[addr] = tag;
    }
    const tagName = addrToTag[out.var] || out.var;

    card.innerHTML = `
      <div class="interlockHeader">
        <div class="interlockTitle">${escapeHtml(tagName)}</div>
        <div class="interlockStatus ${val ? "on" : "off"}">${val ? "ON" : "OFF"}</div>
      </div>
      <div class="small" style="color: var(--muted); margin-top: 4px;">${escapeHtml(out.var)}</div>
      ${perms.length ? `
        <div class="interlockPerms">
          ${perms.slice(0, 3).map(p => `
            <div class="permItem ${p.satisfied ? "satisfied" : "blocking"}">
              <span class="permDot"></span>
              ${escapeHtml(p.text)}
            </div>
          `).join("")}
          ${perms.length > 3 ? `<div class="small" style="margin-top:4px;">+${perms.length - 3} more</div>` : ""}
        </div>
      ` : val ? `<div class="small" style="color:#166534; margin-top:8px;">✅ All conditions satisfied</div>` : `<div class="small" style="color:#9a3412; margin-top:8px;">Blocked by conditions above</div>`}
    `;
    elInterlockView.appendChild(card);
  }
}

function renderSystemOverview() {
  if (!elSystemOverview) return;
  elSystemOverview.innerHTML = "";

  const ir = lastProgram?.ir || {};
  const ioMap = ir.ioMap || {};
  const state = lastState || {};

  if (!Object.keys(ioMap).length) {
    elSystemOverview.innerHTML = `<div class="small">No devices found. Upload a program to see system overview.</div>`;
    return;
  }

  // Group by device type
  const devices = {};
  for (const [tag, addr] of Object.entries(ioMap)) {
    const isInput = String(addr).startsWith("I");
    const isOutput = String(addr).startsWith("Q");
    const type = isInput ? "Input" : (isOutput ? "Output" : "Memory");
    if (!devices[type]) devices[type] = [];
    const value = isInput ? !!state.inputs?.[addr] : (isOutput ? !!state.outputs?.[addr] : !!state.mem?.[addr]);
    devices[type].push({ tag, addr, value });
  }

  for (const [type, items] of Object.entries(devices)) {
    const card = document.createElement("div");
    card.className = "deviceCard";
    card.innerHTML = `
      <h3>${escapeHtml(type)}s (${items.length})</h3>
      <div class="deviceStatus">
        ${items.slice(0, 6).map(item => `
          <span class="statusBadge ${item.value ? "on" : "off"}">
            ${escapeHtml(item.tag)}: ${item.value ? "ON" : "OFF"}
          </span>
        `).join("")}
        ${items.length > 6 ? `<span class="small">+${items.length - 6} more</span>` : ""}
      </div>
    `;
    elSystemOverview.appendChild(card);
  }
}

// Generic faceplate templates
const FACEPLATE_TEMPLATES = {
  motor: {
    name: "Motor Control",
    elements: [
      { type: "label", x: 20, y: 20, text: "Motor Control", style: "font-size: 18px; font-weight: 900;" },
      { type: "label", x: 20, y: 50, text: "Status:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 45, text: "RUNNING", style: "background: var(--energized); color: #fff; padding: 4px 12px; border-radius: 6px;" },
      { type: "button", x: 20, y: 80, text: "START", style: "background: var(--ok); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 800;" },
      { type: "button", x: 120, y: 80, text: "STOP", style: "background: var(--danger); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 800;" },
      { type: "label", x: 20, y: 130, text: "Current:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 125, text: "12.5 A", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 160, text: "Power:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 155, text: "5.2 kW", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 190, text: "Runtime:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 185, text: "2h 34m", style: "font-size: 14px;" }
    ]
  },
  valve: {
    name: "Valve Control",
    elements: [
      { type: "label", x: 20, y: 20, text: "Valve Control", style: "font-size: 18px; font-weight: 900;" },
      { type: "label", x: 20, y: 50, text: "Position:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 45, text: "OPEN", style: "background: var(--ok); color: #fff; padding: 4px 12px; border-radius: 6px;" },
      { type: "button", x: 20, y: 80, text: "OPEN", style: "background: var(--ok); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 800;" },
      { type: "button", x: 120, y: 80, text: "CLOSE", style: "background: var(--danger); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 800;" },
      { type: "label", x: 20, y: 130, text: "Flow Rate:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 125, text: "45.2 GPM", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 160, text: "Limit Open:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 100, y: 155, text: "✓", style: "color: var(--ok); font-size: 20px;" },
      { type: "label", x: 20, y: 190, text: "Limit Close:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 100, y: 185, text: "✗", style: "color: var(--muted); font-size: 20px;" }
    ]
  },
  tank: {
    name: "Tank Level",
    elements: [
      { type: "label", x: 20, y: 20, text: "Tank Level", style: "font-size: 18px; font-weight: 900;" },
      { type: "indicator", x: 20, y: 50, text: "Level: 65%", style: "font-size: 24px; font-weight: 900; color: var(--deep);" },
      { type: "label", x: 20, y: 90, text: "High Level:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 85, text: "OK", style: "color: var(--ok); font-weight: 800;" },
      { type: "label", x: 20, y: 120, text: "Low Level:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 115, text: "OK", style: "color: var(--ok); font-weight: 800;" },
      { type: "label", x: 20, y: 150, text: "Pump Control:", style: "font-size: 12px; color: var(--muted);" },
      { type: "button", x: 20, y: 175, text: "START PUMP", style: "background: var(--ok); color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 800;" },
      { type: "button", x: 130, y: 175, text: "STOP", style: "background: var(--danger); color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 800;" },
      { type: "label", x: 20, y: 220, text: "Flow Out:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 215, text: "12.5 GPM", style: "font-size: 14px; font-weight: 800;" }
    ]
  },
  temperature: {
    name: "Temperature Control",
    elements: [
      { type: "label", x: 20, y: 20, text: "Temperature", style: "font-size: 18px; font-weight: 900;" },
      { type: "indicator", x: 20, y: 50, text: "185°F", style: "font-size: 32px; font-weight: 900; color: var(--danger);" },
      { type: "label", x: 20, y: 100, text: "Setpoint:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 95, text: "180°F", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 130, text: "High Alarm:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 100, y: 125, text: "OK", style: "color: var(--ok); font-weight: 800;" },
      { type: "label", x: 20, y: 160, text: "Low Alarm:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 100, y: 155, text: "OK", style: "color: var(--ok); font-weight: 800;" },
      { type: "button", x: 20, y: 190, text: "HEATER ON", style: "background: var(--danger); color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 800;" },
      { type: "button", x: 130, y: 190, text: "HEATER OFF", style: "background: var(--muted); color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 800;" }
    ]
  },
  pump: {
    name: "Pump Control",
    elements: [
      { type: "label", x: 20, y: 20, text: "Pump Control", style: "font-size: 18px; font-weight: 900;" },
      { type: "label", x: 20, y: 50, text: "Status:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 70, y: 45, text: "RUNNING", style: "background: var(--energized); color: #fff; padding: 4px 12px; border-radius: 6px;" },
      { type: "button", x: 20, y: 80, text: "START", style: "background: var(--ok); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 800;" },
      { type: "button", x: 120, y: 80, text: "STOP", style: "background: var(--danger); color: #fff; padding: 8px 20px; border-radius: 8px; font-weight: 800;" },
      { type: "label", x: 20, y: 130, text: "Flow Rate:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 125, text: "125 GPM", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 160, text: "Pressure:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 155, text: "45 PSI", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 190, text: "Runtime:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 90, y: 185, text: "8h 12m", style: "font-size: 14px;" }
    ]
  },
  pressure: {
    name: "Pressure Monitor",
    elements: [
      { type: "label", x: 20, y: 20, text: "Pressure Monitor", style: "font-size: 18px; font-weight: 900;" },
      { type: "indicator", x: 20, y: 50, text: "45.2 PSI", style: "font-size: 32px; font-weight: 900; color: var(--deep);" },
      { type: "label", x: 20, y: 100, text: "Setpoint:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 80, y: 95, text: "50 PSI", style: "font-size: 16px; font-weight: 800;" },
      { type: "label", x: 20, y: 130, text: "High Alarm:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 100, y: 125, text: "OK", style: "color: var(--ok); font-weight: 800;" },
      { type: "label", x: 20, y: 160, text: "Low Alarm:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 100, y: 155, text: "OK", style: "color: var(--ok); font-weight: 800;" },
      { type: "label", x: 20, y: 190, text: "Trend:", style: "font-size: 12px; color: var(--muted);" },
      { type: "indicator", x: 70, y: 185, text: "↑ Rising", style: "color: var(--ok); font-weight: 800;" }
    ]
  }
};

function renderFaceplates() {
  if (!elFaceplateList) return;
  elFaceplateList.innerHTML = "";

  // Add template section
  const templateSection = document.createElement("div");
  templateSection.className = "faceplateTemplates";
  templateSection.innerHTML = `
    <div style="font-weight: 900; font-size: 13px; margin-bottom: 10px; color: var(--text);">📋 Generic Templates</div>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-bottom: 20px;">
      ${Object.entries(FACEPLATE_TEMPLATES).map(([key, template]) => `
        <button class="btn secondary templateBtn" data-template="${key}" style="font-size: 11px; padding: 10px; text-align: center;">
          <div style="font-weight: 800; margin-bottom: 4px;">${escapeHtml(template.name)}</div>
          <div class="small" style="font-size: 10px; color: var(--muted);">${template.elements.length} elements</div>
        </button>
      `).join("")}
    </div>
    <div style="font-weight: 900; font-size: 13px; margin-bottom: 10px; margin-top: 20px; color: var(--text);">Your Faceplates</div>
  `;
  elFaceplateList.appendChild(templateSection);

  // Add template button handlers
  templateSection.querySelectorAll(".templateBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.template;
      const template = FACEPLATE_TEMPLATES[key];
      if (template) {
        editingFaceplate = faceplates.length;
        faceplates.push({
          name: template.name,
          elements: JSON.parse(JSON.stringify(template.elements)) // Deep copy
        });
        editFaceplate(editingFaceplate);
      }
    });
  });

  if (!faceplates.length) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "small";
    emptyMsg.textContent = 'No faceplates yet. Click a template above or "New Faceplate" to create one.';
    elFaceplateList.appendChild(emptyMsg);
    return;
  }

  faceplates.forEach((fp, idx) => {
    const item = document.createElement("div");
    item.className = "faceplateItem";
    item.innerHTML = `
      <h3>${escapeHtml(fp.name || "Unnamed")}</h3>
      <div class="small">${fp.elements?.length || 0} elements</div>
    `;
    item.onclick = () => editFaceplate(idx);
    elFaceplateList.appendChild(item);
  });
}

function editFaceplate(idx) {
  editingFaceplate = idx;
  const fp = faceplates[idx] || { name: "", elements: [] };
  elFaceplateName.value = fp.name;
  elFaceplateEditor.style.display = "block";
  renderFaceplateCanvas(fp);
}

function renderFaceplateCanvas(fp) {
  if (!elFaceplateCanvas) return;
  
  const elements = fp.elements || [];
  if (!elements.length) {
    elFaceplateCanvas.innerHTML = `
      <div style="text-align:center; padding: 60px 20px; color: var(--muted);">
        <div style="font-size: 48px; margin-bottom: 12px;">📐</div>
        <div class="small" style="margin-bottom: 8px;"><strong>Faceplate Canvas</strong></div>
        <div class="small">Add elements from the system overview or create custom controls.</div>
        <div style="margin-top: 20px;">
          <button class="btn secondary" onclick="addElementToFaceplate('label')">Add Label</button>
          <button class="btn secondary" onclick="addElementToFaceplate('indicator')">Add Indicator</button>
          <button class="btn secondary" onclick="addElementToFaceplate('button')">Add Button</button>
        </div>
      </div>
    `;
    return;
  }

  elFaceplateCanvas.innerHTML = elements.map((el, idx) => {
    const baseStyle = `position: absolute; left: ${el.x || 0}px; top: ${el.y || 0}px;`;
    const customStyle = el.style || "";
    const content = el.type === "button" 
      ? `<button class="faceplateBtn" style="${customStyle}" data-editable="true">${escapeHtml(el.text || el.type)}</button>`
      : el.type === "indicator"
      ? `<div class="faceplateIndicator" style="${customStyle}" data-editable="true">${escapeHtml(el.text || el.type)}</div>`
      : `<div class="faceplateLabel" style="${customStyle}" data-editable="true">${escapeHtml(el.text || el.type)}</div>`;
    return `<div class="faceplateElement" data-index="${idx}" style="${baseStyle}" draggable="true">${content}</div>`;
  }).join("");
  
  // Setup drag and drop
  setupFaceplateDragAndDrop();
  
  // Setup inline editing
  setupFaceplateEditing();
}

let draggedElement = null;
let dragOffset = { x: 0, y: 0 };

function setupFaceplateDragAndDrop() {
  if (!elFaceplateCanvas) return;
  
  const elements = elFaceplateCanvas.querySelectorAll(".faceplateElement");
  
  elements.forEach(el => {
    // Use event delegation - just set draggable and handle events
    el.setAttribute("draggable", "true");
    
    el.ondragstart = (e) => {
      draggedElement = el;
      const rect = el.getBoundingClientRect();
      const canvasRect = elFaceplateCanvas.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      e.dataTransfer.effectAllowed = "move";
      el.style.opacity = "0.5";
      el.classList.add("dragging");
    };
    
    el.ondragend = (e) => {
      if (draggedElement) {
        draggedElement.style.opacity = "1";
        draggedElement.classList.remove("dragging");
        draggedElement = null;
      }
    };
  });
  
  // Canvas drag handlers - use direct assignment to avoid duplicate listeners
  elFaceplateCanvas.ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    if (draggedElement) {
      const canvasRect = elFaceplateCanvas.getBoundingClientRect();
      const newX = e.clientX - canvasRect.left - dragOffset.x;
      const newY = e.clientY - canvasRect.top - dragOffset.y;
      
      // Constrain to canvas bounds
      const constrainedX = Math.max(0, Math.min(newX, canvasRect.width - 50));
      const constrainedY = Math.max(0, Math.min(newY, canvasRect.height - 30));
      
      draggedElement.style.left = `${constrainedX}px`;
      draggedElement.style.top = `${constrainedY}px`;
    }
  };
  
  elFaceplateCanvas.ondrop = (e) => {
    e.preventDefault();
    if (draggedElement && editingFaceplate !== null) {
      const canvasRect = elFaceplateCanvas.getBoundingClientRect();
      const newX = e.clientX - canvasRect.left - dragOffset.x;
      const newY = e.clientY - canvasRect.top - dragOffset.y;
      
      const idx = parseInt(draggedElement.dataset.index);
      const fp = faceplates[editingFaceplate];
      if (fp && fp.elements && fp.elements[idx]) {
        fp.elements[idx].x = Math.max(0, newX);
        fp.elements[idx].y = Math.max(0, newY);
        
        // Save to localStorage
        localStorage.setItem("hmi.faceplates", JSON.stringify(faceplates));
      }
      draggedElement = null;
    }
  };
}

let editingElement = null;

function setupFaceplateEditing() {
  if (!elFaceplateCanvas) return;
  
  const elements = elFaceplateCanvas.querySelectorAll("[data-editable]");
  
  elements.forEach(el => {
    // Use direct assignment to avoid duplicate listeners
    el.ondblclick = (e) => {
      e.stopPropagation();
      startEditingElement(el);
    };
  });
}

function startEditingElement(element) {
  if (editingElement) {
    finishEditingElement();
  }
  
  editingElement = element;
  const originalText = element.textContent || element.innerText;
  const isButton = element.tagName === "BUTTON";
  
  // Create input field
  const input = document.createElement("input");
  input.type = "text";
  input.value = originalText;
  input.className = "faceplateEditInput";
  input.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    border: 2px solid var(--deep);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: inherit;
    font-weight: inherit;
    font-family: inherit;
    background: #fff;
    z-index: 1000;
  `;
  
  // Replace element content with input
  element.style.position = "relative";
  element.innerHTML = "";
  element.appendChild(input);
  input.focus();
  input.select();
  
  // Save on Enter or blur
  const saveEdit = () => {
    const newText = input.value.trim() || originalText;
    const idx = parseInt(element.closest(".faceplateElement")?.dataset.index);
    
    if (editingFaceplate !== null && idx !== undefined) {
      const fp = faceplates[editingFaceplate];
      if (fp && fp.elements && fp.elements[idx]) {
        fp.elements[idx].text = newText;
        localStorage.setItem("hmi.faceplates", JSON.stringify(faceplates));
      }
    }
    
    // Restore element
    if (isButton) {
      element.innerHTML = escapeHtml(newText);
    } else {
      element.textContent = newText;
    }
    element.style.position = "";
    element.removeChild(input);
    editingElement = null;
  };
  
  input.addEventListener("blur", saveEdit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (isButton) {
        element.innerHTML = escapeHtml(originalText);
      } else {
        element.textContent = originalText;
      }
      element.style.position = "";
      element.removeChild(input);
      editingElement = null;
    }
  });
}

function finishEditingElement() {
  if (editingElement) {
    const input = editingElement.querySelector("input");
    if (input) {
      input.blur();
    }
  }
}

function addElementToFaceplate(type) {
  if (editingFaceplate === null) return;
  const fp = faceplates[editingFaceplate] || { name: "", elements: [] };
  if (!fp.elements) fp.elements = [];
  
  const newEl = {
    type,
    x: Math.random() * 300 + 50,
    y: Math.random() * 200 + 50,
    text: type === "label" ? "Label" : (type === "indicator" ? "Indicator" : "Button")
  };
  fp.elements.push(newEl);
  faceplates[editingFaceplate] = fp;
  renderFaceplateCanvas(fp);
}

window.addElementToFaceplate = addElementToFaceplate;

// Tab switching
hmiTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const tabName = tab.dataset.tab;
    hmiTabs.forEach(t => t.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.add("active");
  });
});

// Faceplate buttons
document.getElementById("btnNewFaceplate")?.addEventListener("click", () => {
  editingFaceplate = faceplates.length;
  faceplates.push({ name: "", elements: [] });
  editFaceplate(editingFaceplate);
});

document.getElementById("btnSaveFaceplate")?.addEventListener("click", () => {
  if (editingFaceplate === null) return;
  
  // Finish any active editing
  finishEditingElement();
  
  // Update positions from current DOM
  const elements = elFaceplateCanvas.querySelectorAll(".faceplateElement");
  const fp = faceplates[editingFaceplate];
  if (fp && fp.elements) {
    elements.forEach(el => {
      const idx = parseInt(el.dataset.index);
      if (fp.elements[idx]) {
        const rect = el.getBoundingClientRect();
        const canvasRect = elFaceplateCanvas.getBoundingClientRect();
        fp.elements[idx].x = rect.left - canvasRect.left;
        fp.elements[idx].y = rect.top - canvasRect.top;
      }
    });
  }
  
  const name = elFaceplateName.value.trim() || "Unnamed Faceplate";
  faceplates[editingFaceplate] = {
    name,
    elements: faceplates[editingFaceplate]?.elements || []
  };
  localStorage.setItem("hmi.faceplates", JSON.stringify(faceplates));
  editingFaceplate = null;
  elFaceplateEditor.style.display = "none";
  renderFaceplates();
});

document.getElementById("btnCancelFaceplate")?.addEventListener("click", () => {
  editingFaceplate = null;
  elFaceplateEditor.style.display = "none";
});

// Export buttons
document.getElementById("btnExportJSON")?.addEventListener("click", () => {
  const config = {
    faceplates,
    program: lastProgram?.ir || null,
    timestamp: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hmi_config.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("btnExportHTML")?.addEventListener("click", () => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>HMI Preview</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .faceplate { border: 1px solid #ddd; border-radius: 12px; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>HMI Preview</h1>
  ${faceplates.map(fp => `<div class="faceplate"><h2>${escapeHtml(fp.name)}</h2></div>`).join("")}
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hmi_preview.html";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("btnExportSVG")?.addEventListener("click", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#f8fafc"/>
    <text x="400" y="50" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="#0f172a">HMI Export</text>
    ${faceplates.map((fp, idx) => `
      <rect x="${20 + (idx % 3) * 260}" y="${100 + Math.floor(idx / 3) * 200}" width="240" height="160" fill="#fff" stroke="#ddd" stroke-width="2" rx="8"/>
      <text x="${140 + (idx % 3) * 260}" y="${130 + Math.floor(idx / 3) * 200}" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#0f172a">${escapeHtml(fp.name || "Unnamed")}</text>
    `).join("")}
  </svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hmi_export.svg";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("btnExportSVG")?.addEventListener("click", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#f8fafc"/>
    <text x="400" y="50" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="#0f172a">HMI Export</text>
    ${faceplates.map((fp, idx) => `
      <rect x="${20 + (idx % 3) * 260}" y="${100 + Math.floor(idx / 3) * 200}" width="240" height="160" fill="#fff" stroke="#ddd" stroke-width="2" rx="8"/>
      <text x="${140 + (idx % 3) * 260}" y="${130 + Math.floor(idx / 3) * 200}" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#0f172a">${escapeHtml(fp.name || "Unnamed")}</text>
    `).join("")}
  </svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hmi_export.svg";
  a.click();
  URL.revokeObjectURL(a.href);
});

// Main loop
async function loop() {
  try {
    const [state, program] = await Promise.all([apiState(), apiProgram()]);
    lastState = state;
    lastProgram = program;

    if (elScanInfo) {
      const st = state.scanStats || {};
      elScanInfo.textContent = st && typeof st.lastMs === "number"
        ? `scan ${state.scanMs}ms · last ${fmtMs(st.lastMs)}ms`
        : `scan ${state.scanMs}ms`;
    }

    renderInterlockView();
    if (document.getElementById("tabOverview")?.classList.contains("active")) {
      renderSystemOverview();
    }
  } catch (e) {
    console.error("HMI loop error:", e);
  } finally {
    setTimeout(loop, 1000);
  }
}

renderFaceplates();
loop();
