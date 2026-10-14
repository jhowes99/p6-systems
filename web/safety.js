// Safety Configuration Page Logic
(function() {
  const elEStopList = document.getElementById("estopList");
  const elEStopEmpty = document.getElementById("estopEmpty");
  const elInterlockList = document.getElementById("interlockList");
  const elInterlockEmpty = document.getElementById("interlockEmpty");
  const elSafetyChainView = document.getElementById("safetyChainView");
  const elSafetyChainLogic = document.getElementById("safetyChainLogic");
  const elSafetyChecklist = document.getElementById("safetyChecklist");
  const elSafetySummary = document.getElementById("safetySummary");
  
  const btnSafetyWizard = document.getElementById("btnSafetyWizard");
  const btnAddEStop = document.getElementById("btnAddEStop");
  const btnAddOverload = document.getElementById("btnAddOverload");
  const btnAddInterlock = document.getElementById("btnAddInterlock");
  const btnSelectEStop = document.getElementById("btnSelectEStop");
  const btnAddInterlockCondition = document.getElementById("btnAddInterlockCondition");
  
  const chkEStopAutoReset = document.getElementById("chkEStopAutoReset");
  const chkEStopAllOutputs = document.getElementById("chkEStopAllOutputs");
  
  // Safety configuration state
  let safetyConfig = {
    eStops: [],
    interlocks: [],
    autoReset: true,
    disableAllOutputs: true
  };
  
  // Load safety config from localStorage or API
  function loadSafetyConfig() {
    try {
      const saved = localStorage.getItem("safety.config");
      if (saved) {
        safetyConfig = { ...safetyConfig, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn("Failed to load safety config:", e);
    }
    loadFromProgram();
  }
  
  // Load safety devices from current program
  async function loadFromProgram() {
    try {
      const res = await fetch("/api/program");
      const data = await res.json();
      if (data.ok && data.ir) {
        const ioMap = data.ir.ioMap || {};
        const eStops = [];
        const interlocks = [];
        
        // Find E-Stops
        for (const [tag, addr] of Object.entries(ioMap)) {
          const tagUpper = String(tag).toUpperCase();
          if (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
              tagUpper.includes("EMERGENCY")) {
            eStops.push({ tag, address: addr, type: "E-Stop" });
          }
        }
        
        // Find safety interlocks (overloads, safety sensors, etc.)
        for (const [tag, addr] of Object.entries(ioMap)) {
          const tagUpper = String(tag).toUpperCase();
          if (tagUpper.includes("OVERLOAD") || tagUpper.includes("SAFETY") ||
              tagUpper.includes("GUARD") || tagUpper.includes("INTERLOCK")) {
            if (!eStops.find(e => e.tag === tag)) {
              interlocks.push({ tag, address: addr, type: "Interlock" });
            }
          }
        }
        
        safetyConfig.eStops = eStops;
        safetyConfig.interlocks = interlocks;
        render();
      }
    } catch (e) {
      console.warn("Failed to load program:", e);
    }
  }
  
  // Save safety config
  function saveSafetyConfig() {
    try {
      localStorage.setItem("safety.config", JSON.stringify(safetyConfig));
      // Also save to backend
      fetch("/api/safety/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(safetyConfig)
      }).catch(e => console.warn("Failed to save to backend:", e));
    } catch (e) {
      console.warn("Failed to save safety config:", e);
    }
  }
  
  // Tab switching
  document.querySelectorAll(".safetyTab").forEach(tab => {
    tab.addEventListener("click", () => {
      const tabId = tab.dataset.tab;
      document.querySelectorAll(".safetyTab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".safetyTabContent").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.add("active");
      if (tabId === "chain") renderSafetyChain();
      if (tabId === "review") renderReview();
    });
  });
  
  // Render E-Stop list
  function renderEStops() {
    if (safetyConfig.eStops.length === 0) {
      elEStopList.style.display = "none";
      elEStopEmpty.style.display = "block";
      return;
    }
    elEStopList.style.display = "flex";
    elEStopEmpty.style.display = "none";
    elEStopList.innerHTML = safetyConfig.eStops.map((estop, idx) => `
      <div class="deviceItem safety">
        <div class="deviceInfo">
          <div class="deviceName">${escapeHtml(estop.tag)}</div>
          <div class="deviceMeta">
            <span>Address: ${escapeHtml(estop.address)}</span>
            <span class="badge safety">E-STOP</span>
          </div>
        </div>
        <div class="deviceActions">
          <button class="btn secondary" onclick="safetyPage.removeEStop(${idx})">Remove</button>
        </div>
      </div>
    `).join("");
  }
  
  // Render Interlocks
  function renderInterlocks() {
    if (safetyConfig.interlocks.length === 0) {
      elInterlockList.style.display = "none";
      elInterlockEmpty.style.display = "block";
      return;
    }
    elInterlockList.style.display = "flex";
    elInterlockEmpty.style.display = "none";
    elInterlockList.innerHTML = safetyConfig.interlocks.map((interlock, idx) => `
      <div class="interlockItem">
        <div class="interlockHeader">
          <div class="interlockTitle">${escapeHtml(interlock.tag)}</div>
          <button class="btn secondary" onclick="safetyPage.removeInterlock(${idx})">Remove</button>
        </div>
        <div class="deviceMeta">
          <span>Address: ${escapeHtml(interlock.address)}</span>
          <span>Type: ${escapeHtml(interlock.type)}</span>
        </div>
        <div class="interlockCondition">
          Condition: ${escapeHtml(interlock.tag)} must be ON (normal) to allow operation
        </div>
      </div>
    `).join("");
  }
  
  // Render Safety Chain
  function renderSafetyChain() {
    const chain = [];
    if (safetyConfig.eStops.length > 0) {
      chain.push(`E-Stop: ${safetyConfig.eStops.map(e => e.tag).join(", ")}`);
    }
    if (safetyConfig.interlocks.length > 0) {
      chain.push(`Interlocks: ${safetyConfig.interlocks.map(i => i.tag).join(", ")}`);
    }
    
    if (chain.length === 0) {
      elSafetyChainView.innerHTML = `<div class="emptyState"><div class="emptyText">No safety chain configured</div></div>`;
      elSafetyChainLogic.innerHTML = `<div class="emptyState"><div class="emptyText">No safety logic defined</div></div>`;
      return;
    }
    
    elSafetyChainView.innerHTML = `
      <div style="margin-bottom: 12px;"><strong>Safety Chain Components:</strong></div>
      ${chain.map(c => `<div>• ${escapeHtml(c)}</div>`).join("")}
    `;
    
    const logic = [];
    if (safetyConfig.eStops.length > 0) {
      logic.push(`All E-Stops must be ON (normal position): ${safetyConfig.eStops.map(e => e.tag).join(" AND ")}`);
    }
    if (safetyConfig.interlocks.length > 0) {
      logic.push(`All Interlocks must be satisfied: ${safetyConfig.interlocks.map(i => i.tag).join(" AND ")}`);
    }
    logic.push(`Safety Chain = ${safetyConfig.eStops.map(e => e.tag).concat(safetyConfig.interlocks.map(i => i.tag)).join(" AND ") || "No safety chain"}`);
    
    elSafetyChainLogic.innerHTML = logic.map(l => `<div>${escapeHtml(l)}</div>`).join("");
  }
  
  // Render Review
  function renderReview() {
    const checklist = [
      { id: "estop", label: "E-Stop configured", complete: safetyConfig.eStops.length > 0 },
      { id: "interlocks", label: "Safety interlocks defined", complete: safetyConfig.interlocks.length > 0 },
      { id: "chain", label: "Safety chain verified", complete: safetyConfig.eStops.length > 0 || safetyConfig.interlocks.length > 0 },
      { id: "behavior", label: "E-Stop behavior configured", complete: true }
    ];
    
    elSafetyChecklist.innerHTML = checklist.map(item => `
      <div class="checklistItem ${item.complete ? "complete" : "incomplete"}">
        <div class="checklistIcon">${item.complete ? "✅" : "❌"}</div>
        <div class="checklistText">${escapeHtml(item.label)}</div>
      </div>
    `).join("");
    
    const summary = [];
    summary.push(`<strong>E-Stops:</strong> ${safetyConfig.eStops.length} configured`);
    summary.push(`<strong>Interlocks:</strong> ${safetyConfig.interlocks.length} configured`);
    summary.push(`<strong>Auto Reset:</strong> ${safetyConfig.autoReset ? "Enabled" : "Disabled"}`);
    summary.push(`<strong>Disable All Outputs:</strong> ${safetyConfig.disableAllOutputs ? "Enabled" : "Disabled"}`);
    
    elSafetySummary.innerHTML = summary.map(s => `<div>${s}</div>`).join("");
  }
  
  // Main render
  function render() {
    renderEStops();
    renderInterlocks();
    chkEStopAutoReset.checked = safetyConfig.autoReset;
    chkEStopAllOutputs.checked = safetyConfig.disableAllOutputs;
  }
  
  // Event handlers
  btnSafetyWizard.addEventListener("click", () => {
    window.location.href = "/wizards.html#safety";
  });
  
  btnAddEStop.addEventListener("click", () => {
    const tag = prompt("Enter E-Stop tag name:", "E-Stop_1");
    if (tag) {
      safetyConfig.eStops.push({ tag, address: "I?", type: "E-Stop" });
      saveSafetyConfig();
      render();
    }
  });
  
  btnAddOverload.addEventListener("click", () => {
    const tag = prompt("Enter Overload tag name:", "Overload_1");
    if (tag) {
      safetyConfig.interlocks.push({ tag, address: "I?", type: "Overload" });
      saveSafetyConfig();
      render();
    }
  });
  
  btnAddInterlock.addEventListener("click", () => {
    const tag = prompt("Enter Interlock tag name:", "Interlock_1");
    if (tag) {
      safetyConfig.interlocks.push({ tag, address: "I?", type: "Interlock" });
      saveSafetyConfig();
      render();
    }
  });
  
  btnSelectEStop.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/program");
      const data = await res.json();
      if (data.ok && data.ir) {
        const ioMap = data.ir.ioMap || {};
        const inputs = Object.entries(ioMap).filter(([tag, addr]) => 
          String(addr).startsWith("I")
        );
        if (inputs.length === 0) {
          alert("No inputs found. Add devices in Panel Builder first.");
          return;
        }
        const choice = prompt(`Available inputs:\n${inputs.map(([t, a]) => `${t} (${a})`).join("\n")}\n\nEnter tag name to add as E-Stop:`);
        if (choice && inputs.find(([t]) => t === choice)) {
          const addr = ioMap[choice];
          if (!safetyConfig.eStops.find(e => e.tag === choice)) {
            safetyConfig.eStops.push({ tag: choice, address: addr, type: "E-Stop" });
            saveSafetyConfig();
            render();
          }
        }
      }
    } catch (e) {
      alert("Failed to load program: " + e.message);
    }
  });
  
  btnAddInterlockCondition.addEventListener("click", () => {
    const tag = prompt("Enter Interlock condition tag name:", "Interlock_1");
    if (tag) {
      safetyConfig.interlocks.push({ tag, address: "I?", type: "Interlock" });
      saveSafetyConfig();
      render();
    }
  });
  
  chkEStopAutoReset.addEventListener("change", (e) => {
    safetyConfig.autoReset = e.target.checked;
    saveSafetyConfig();
  });
  
  chkEStopAllOutputs.addEventListener("change", (e) => {
    safetyConfig.disableAllOutputs = e.target.checked;
    saveSafetyConfig();
  });
  
  // Expose for inline handlers
  window.safetyPage = {
    removeEStop: (idx) => {
      safetyConfig.eStops.splice(idx, 1);
      saveSafetyConfig();
      render();
    },
    removeInterlock: (idx) => {
      safetyConfig.interlocks.splice(idx, 1);
      saveSafetyConfig();
      render();
    }
  };
  
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }
  
  // Initialize
  loadSafetyConfig();
  render();
})();
