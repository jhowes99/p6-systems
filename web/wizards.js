const elPreview = document.getElementById("preview");
const elStatus = document.getElementById("status");

const LS = {
  panelSeed: "panel_builder.seed",
};

const API = {
  panelCompile: (panel) => fetch("/api/panel/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ panel })
  }).then(r => r.json()),
  timelineCompile: (model) => fetch("/api/timeline/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model })
  }).then(r => r.json()),
  uploadIR: (ir) => fetch("/api/program", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir })
  }).then(r => r.json())
};

function show(status, ir, statusHtml) {
  if (statusHtml) elStatus.innerHTML = statusHtml;
  else elStatus.textContent = status;
  elPreview.textContent = ir ? JSON.stringify(ir, null, 2) : "";
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function persistPanelSeedFromWizard(panel, wizardId) {
  try {
    localStorage.setItem(LS.panelSeed, JSON.stringify({
      kind: "panel",
      source: "control_templates",
      wizardId,
      name: panel?.name || wizardId,
      savedAt: Date.now(),
      panel
    }));
  } catch {
    // ignore
  }
}

function startStopPanel() {
  return {
    name: "Start/Stop Motor",
    tags: {
      "Start Button": { kind: "DI", label: "Start PB (NO)" },
      "Stop Button": { kind: "DI", label: "Stop PB (NC)" },
      "E-Stop OK": { kind: "DI", label: "E-Stop (NC)" },
      "Overload OK": { kind: "DI", label: "Overload (NC)" },
      "Motor M1": { kind: "DO", label: "Motor Contactor" }
    },
    rungs: [{
      contacts: [
        { tag: "E-Stop OK", type: "NC" },
        { tag: "Overload OK", type: "NC" },
        { tag: "Stop Button", type: "NC" },
        { tag: "Start Button", type: "NO" }
      ],
      coil: { tag: "Motor M1", action: "COIL" }
    }]
  };
}

function fwdRevPanel() {
  // Implement as plain-language-ish with two rungs and mutual interlock
  return {
    name: "Fwd/Rev Motor",
    tags: {
      "FWD Button": { kind: "DI", label: "Forward PB (NO)" },
      "REV Button": { kind: "DI", label: "Reverse PB (NO)" },
      "Stop Button": { kind: "DI", label: "Stop PB (NC)" },
      "FWD Coil": { kind: "DO", label: "Forward Contactor" },
      "REV Coil": { kind: "DO", label: "Reverse Contactor" }
    },
    rungs: [
      { contacts: [{ tag: "Stop Button", type: "NC" }, { tag: "REV Coil", type: "NC" }, { tag: "FWD Button", type: "NO" }], coil: { tag: "FWD Coil", action: "COIL" } },
      { contacts: [{ tag: "Stop Button", type: "NC" }, { tag: "FWD Coil", type: "NC" }, { tag: "REV Button", type: "NO" }], coil: { tag: "REV Coil", action: "COIL" } }
    ]
  };
}

function starDeltaTimeline() {
  return {
    tags: {
      "Start Button": { kind: "DI", label: "Start PB" },
      "Main Contactor": { kind: "DO", label: "Main" },
      "Star Contactor": { kind: "DO", label: "Star" },
      "Delta Contactor": { kind: "DO", label: "Delta" }
    },
    startTag: "Start Button",
    steps: [
      { action: { tag: "Main Contactor", state: true } },
      { action: { tag: "Star Contactor", state: true } },
      { delayMs: 5000 },
      { action: { tag: "Star Contactor", state: false } },
      { action: { tag: "Delta Contactor", state: true } }
    ]
  };
}

function conveyorPanel() {
  // Seal-in motor with Stop and Jam interlocks
  // Conveyor := (Conveyor OR Start) AND NOT Stop AND NOT Jam
  return {
    name: "Conveyor with Jam Sensor",
    tags: {
      "Start Button": { kind: "DI", label: "Start PB (NO)" },
      "Stop Button": { kind: "DI", label: "Stop PB (NC)" },
      "Jam Sensor": { kind: "DI", label: "Jam (NO when jammed)" },
      "Conveyor Motor": { kind: "DO", label: "Conveyor" }
    },
    rungs: [{
      branches: [
        [{ tag: "Conveyor Motor", type: "NO" }], // seal-in
        [{ tag: "Start Button", type: "NO" }]
      ],
      // series interlocks are modeled as extra contacts in each branch (MVP approach: add them to both branches)
      // We'll just append interlocks into each branch so either path still requires Stop/Jam OK.
      // Stop is NC (must be closed), Jam is NC (means NOT jammed).
      coil: { tag: "Conveyor Motor", action: "COIL" }
    }]
  };
}

function pumpAltPanel() {
  // MVP selector-based alternation:
  // If Selector is ON -> run Pump 1; else -> run Pump 2 (both behind Start/Stop)
  return {
    name: "Pump Alternation (Selector)",
    tags: {
      "Start Button": { kind: "DI", label: "Start PB (NO)" },
      "Stop Button": { kind: "DI", label: "Stop PB (NC)" },
      "Pump Select": { kind: "DI", label: "Selector (ON=Pump1)" },
      "Pump 1": { kind: "DO", label: "Pump 1" },
      "Pump 2": { kind: "DO", label: "Pump 2" }
    },
    rungs: [
      { contacts: [{ tag: "Stop Button", type: "NC" }, { tag: "Start Button", type: "NO" }, { tag: "Pump Select", type: "NO" }], coil: { tag: "Pump 1", action: "COIL" } },
      { contacts: [{ tag: "Stop Button", type: "NC" }, { tag: "Start Button", type: "NO" }, { tag: "Pump Select", type: "NC" }], coil: { tag: "Pump 2", action: "COIL" } }
    ]
  };
}

function pumpAutoIR() {
  // Auto alternation (MVP): toggles ALT bit on rising Start, runs Pump1 if ALT else Pump2.
  // Addresses are direct for simplicity.
  const I0 = "I0"; // Start
  const I1 = "I1"; // Stop (pressed)
  const Q0 = "Q0"; // Pump 1
  const Q1 = "Q1"; // Pump 2
  const M0 = "M0"; // ALT
  const M1 = "M1"; // StartPrev (previous scan)
  const M2 = "M2"; // RunLatch

  const rungs = [
    // Toggle ALT on rising edge of Start:
    // If Start AND NOT prev AND NOT ALT => SET ALT
    { cond: { op: "AND", a: { var: I0 }, b: { op: "AND", a: { op: "NOT", x: { var: M1 } }, b: { op: "NOT", x: { var: M0 } } } }, actions: [{ type: "SET", target: M0 }] },
    // If Start AND NOT prev AND ALT => RESET ALT
    { cond: { op: "AND", a: { var: I0 }, b: { op: "AND", a: { op: "NOT", x: { var: M1 } }, b: { var: M0 } } }, actions: [{ type: "RESET", target: M0 }] },
    // Update prev = Start
    { cond: { var: I0 }, actions: [{ type: "COIL", target: M1 }] },
    { cond: { op: "NOT", x: { var: I0 } }, actions: [{ type: "RESET", target: M1 }] },

    // Run latch: M2 := (M2 OR Start) AND NOT Stop
    { cond: { op: "AND", a: { op: "OR", a: { var: M2 }, b: { var: I0 } }, b: { op: "NOT", x: { var: I1 } } }, actions: [{ type: "COIL", target: M2 }] },

    // Pump outputs
    { cond: { op: "AND", a: { var: M2 }, b: { var: M0 } }, actions: [{ type: "COIL", target: Q0 }] },
    { cond: { op: "AND", a: { var: M2 }, b: { op: "NOT", x: { var: M0 } } }, actions: [{ type: "COIL", target: Q1 }] }
  ];

  return {
    language: "ladder",
    networks: [{ rungs }],
    ioMap: {
      "Start Button": I0,
      "Stop Button": I1,
      "Pump 1": Q0,
      "Pump 2": Q1,
      "ALT": M0,
      "StartPrev": M1,
      "RunLatch": M2
    },
    metadata: { generatedFrom: "wizard:pump_alternation_auto" }
  };
}

async function run(panel, doUpload, savedToPanelView = false, navigateToBuild = false) {
  const link = savedToPanelView ? `<span class="small">Saved to <a href="/panel_builder.html">Panel View</a>.</span>` : "";
  show("Generating…", null, link ? `Generating… ${link}` : null);
  const c = await API.panelCompile(panel);
  if (!c.ok) return show(`Error: ${c.error}`, null, link ? `Error: ${escapeHtml(c.error)} ${link}` : null);
  const ir = c.ir;
  if (doUpload) {
    const r = await API.uploadIR(ir);
    if (!r.ok) return show(`Generated, but upload failed: ${r.error}`, ir, link ? `Generated, but upload failed: ${escapeHtml(r.error)} ${link}` : null);
    show("Generated and uploaded. Open Monitor/Electrician View.", ir, link ? `Generated and uploaded. Open Monitor/Electrician View. ${link}` : null);
  } else {
    show("Generated (preview below).", ir, link ? `Generated (preview below). ${link}` : null);
  }
  
  // Navigate to Build if requested
  if (navigateToBuild && savedToPanelView) {
    setTimeout(() => {
      window.location.href = "/panel_builder.html";
    }, 500); // Small delay to ensure localStorage is saved
  }
}

async function runTimeline(model, doUpload, navigateToBuild = false) {
  show("Generating…", null);
  const c = await API.timelineCompile(model);
  if (!c.ok) return show(`Error: ${c.error}`, null);
  const ir = c.ir;
  
  // For timeline wizards, convert IR to panel format and save
  if (navigateToBuild) {
    const panel = convertIRToPanelForWizard(ir);
    if (panel) {
      persistPanelSeedFromWizard(panel, "star_delta_starter");
    }
  }
  
  if (doUpload) {
    const r = await API.uploadIR(ir);
    if (!r.ok) return show(`Generated, but upload failed: ${r.error}`, ir);
    show("Generated and uploaded. Open Monitor/Electrician View.", ir);
  } else {
    show("Generated (preview below).", ir);
  }
  
  // Navigate to Build if requested
  if (navigateToBuild) {
    setTimeout(() => {
      window.location.href = "/panel_builder.html";
    }, 500);
  }
}

// Convert IR to panel format for timeline-based wizards
function convertIRToPanelForWizard(ir) {
  if (!ir || !ir.networks) return null;
  
  const panelTags = {};
  const panelRungs = [];
  const ioMap = ir.ioMap || {};
  
  // Create tags from ioMap
  for (const [tag, address] of Object.entries(ioMap)) {
    const addr = String(address);
    const kind = addr.startsWith("I") ? "DI" : (addr.startsWith("Q") ? "DO" : "DI");
    panelTags[tag] = {
      kind,
      label: tag,
      group: /e-?stop|overload|safety/i.test(tag) ? "safety" : "control"
    };
  }
  
  // Convert rungs from IR to panel format
  for (const net of ir.networks || []) {
    for (const rung of net.rungs || []) {
      const outputActions = (rung.actions || []).filter(a => 
        (a.type === "COIL" || a.type === "SET") && String(a.target || "").match(/^[QM]\d+$/)
      );
      
      for (const action of outputActions) {
        const outputTag = Object.entries(ioMap).find(([_, addr]) => addr === action.target)?.[0] || action.target;
        const contacts = extractContactsFromExprForWizard(rung.cond, ioMap);
        
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
  
  return {
    name: ir.metadata?.name || "Timeline Wizard",
    tags: panelTags,
    rungs: panelRungs,
    metadata: ir.metadata || {}
  };
}

// Extract contacts from boolean expression (for timeline wizards)
function extractContactsFromExprForWizard(expr, ioMap) {
  if (!expr) return [];
  const contacts = [];
  
  function walk(e, negate = false) {
    if (!e || typeof e === "boolean") return;
    if (e.var) {
      const tag = Object.entries(ioMap || {}).find(([_, addr]) => addr === e.var)?.[0] || e.var;
      contacts.push({ tag, type: negate ? "NC" : "NO" });
    } else if (e.op === "NOT") {
      walk(e.x, !negate);
    } else if (e.op === "AND") {
      walk(e.a, negate);
      walk(e.b, negate);
    } else if (e.op === "OR") {
      walk(e.a, negate);
    }
  }
  
  walk(expr);
  return contacts.length > 0 ? contacts : [];
}

async function runIR(ir, doUpload) {
  if (doUpload) {
    const r = await API.uploadIR(ir);
    if (!r.ok) return show(`Generated, but upload failed: ${r.error}`, ir);
    show("Generated and uploaded. Open Monitor/Electrician View.", ir);
  } else {
    show("Generated (preview below).", ir);
  }
}

document.getElementById("wizStartStop").onclick = () => {
  const p = startStopPanel();
  persistPanelSeedFromWizard(p, "start_stop_motor");
  return run(p, false, true);
};
document.getElementById("wizStartStopUpload").onclick = () => {
  const p = startStopPanel();
  persistPanelSeedFromWizard(p, "start_stop_motor");
  return run(p, true, true);
};
document.getElementById("wizStartStopBuild").onclick = () => {
  const p = startStopPanel();
  persistPanelSeedFromWizard(p, "start_stop_motor");
  return run(p, false, true, true); // Navigate to Build
};
document.getElementById("wizFwdRev").onclick = () => {
  const p = fwdRevPanel();
  persistPanelSeedFromWizard(p, "fwd_rev_motor");
  return run(p, false, true);
};
document.getElementById("wizFwdRevUpload").onclick = () => {
  const p = fwdRevPanel();
  persistPanelSeedFromWizard(p, "fwd_rev_motor");
  return run(p, true, true);
};
document.getElementById("wizFwdRevBuild").onclick = () => {
  const p = fwdRevPanel();
  persistPanelSeedFromWizard(p, "fwd_rev_motor");
  return run(p, false, true, true); // Navigate to Build
};

document.getElementById("wizStarDelta").onclick = () => runTimeline(starDeltaTimeline(), false);
document.getElementById("wizStarDeltaUpload").onclick = () => runTimeline(starDeltaTimeline(), true);
document.getElementById("wizStarDeltaBuild").onclick = () => runTimeline(starDeltaTimeline(), false, true); // Navigate to Build

// Patch conveyor panel to include Stop/Jam interlocks on both seal-in and start branches
function applyConveyorInterlocks(p) {
  const rung = p.rungs[0];
  const stop = { tag: "Stop Button", type: "NC" };
  const jam = { tag: "Jam Sensor", type: "NC" };
  rung.branches = rung.branches.map(b => [stop, jam, ...b]);
  return p;
}

document.getElementById("wizConveyor").onclick = () => {
  const p = applyConveyorInterlocks(conveyorPanel());
  persistPanelSeedFromWizard(p, "conveyor_jam");
  return run(p, false, true);
};
document.getElementById("wizConveyorUpload").onclick = () => {
  const p = applyConveyorInterlocks(conveyorPanel());
  persistPanelSeedFromWizard(p, "conveyor_jam");
  return run(p, true, true);
};
document.getElementById("wizConveyorBuild").onclick = () => {
  const p = applyConveyorInterlocks(conveyorPanel());
  persistPanelSeedFromWizard(p, "conveyor_jam");
  return run(p, false, true, true); // Navigate to Build
};

document.getElementById("wizPumpAlt").onclick = () => {
  const p = pumpAltPanel();
  persistPanelSeedFromWizard(p, "pump_alternation_selector");
  return run(p, false, true);
};
document.getElementById("wizPumpAltUpload").onclick = () => {
  const p = pumpAltPanel();
  persistPanelSeedFromWizard(p, "pump_alternation_selector");
  return run(p, true, true);
};
document.getElementById("wizPumpAltBuild").onclick = () => {
  const p = pumpAltPanel();
  persistPanelSeedFromWizard(p, "pump_alternation_selector");
  return run(p, false, true, true); // Navigate to Build
};

document.getElementById("wizPumpAltAuto").onclick = () => runIR(pumpAutoIR(), false);
document.getElementById("wizPumpAltAutoUpload").onclick = () => runIR(pumpAutoIR(), true);

// Safety Configuration Wizard
function safetyWizardPanel() {
  return {
    name: "Safety Configuration",
    tags: {
      "E-Stop": { kind: "DI", label: "Emergency Stop", group: "safety" },
      "Overload": { kind: "DI", label: "Overload Protection", group: "safety" },
      "Guard Door": { kind: "DI", label: "Guard Door Closed", group: "safety" },
      "Motor": { kind: "DO", label: "Motor Output", group: "control" }
    },
    rungs: [
      {
        branches: [[
          { tag: "E-Stop", type: "NC" },
          { tag: "Overload", type: "NC" },
          { tag: "Guard Door", type: "NC" }
        ]],
        coil: { tag: "Motor", action: "COIL" }
      }
    ],
    metadata: {
      goal: "Safety configuration with E-Stop, Overload, and Guard Door interlocks",
      wizard: "safety"
    }
  };
}

document.getElementById("wizSafety")?.addEventListener("click", () => {
  const panel = safetyWizardPanel();
  const ir = compilePanelToIR(panel);
  show("✅ Safety configuration generated. Click 'View in Build' to see it.", ir);
});

document.getElementById("wizSafetyBuild")?.addEventListener("click", () => {
  const panel = safetyWizardPanel();
  persistPanelSeedFromWizard(panel, "safety");
  window.location.href = "/panel_builder.html";
});

// Additional templates for expanded gallery
function twoMotorPanel() {
  return {
    name: "Two Motor System",
    tags: {
      "Start Motor 1": { kind: "DI", label: "Start Motor 1" },
      "Stop Motor 1": { kind: "DI", label: "Stop Motor 1" },
      "Start Motor 2": { kind: "DI", label: "Start Motor 2" },
      "Stop Motor 2": { kind: "DI", label: "Stop Motor 2" },
      "E-Stop": { kind: "DI", label: "Emergency Stop", group: "safety" },
      "Motor 1": { kind: "DO", label: "Motor 1" },
      "Motor 2": { kind: "DO", label: "Motor 2" }
    },
    rungs: [
      {
        branches: [[
          { tag: "E-Stop", type: "NC" },
          { tag: "Stop Motor 1", type: "NC" },
          { tag: "Start Motor 1", type: "NO" }
        ]],
        coil: { tag: "Motor 1", action: "COIL" }
      },
      {
        branches: [[
          { tag: "E-Stop", type: "NC" },
          { tag: "Stop Motor 2", type: "NC" },
          { tag: "Start Motor 2", type: "NO" }
        ]],
        coil: { tag: "Motor 2", action: "COIL" }
      }
    ],
    metadata: {
      goal: "Control two independent motors with separate start/stop buttons and shared E-Stop",
      wizard: "two_motor"
    }
  };
}

function lightControlPanel() {
  return {
    name: "Light Control",
    tags: {
      "Light Switch": { kind: "DI", label: "Light Switch" },
      "Motion Sensor": { kind: "DI", label: "Motion Sensor" },
      "Light": { kind: "DO", label: "Light Output" }
    },
    rungs: [
      {
        branches: [[
          { tag: "Light Switch", type: "NO" },
          { tag: "Motion Sensor", type: "NO" }
        ]],
        coil: { tag: "Light", action: "COIL" }
      }
    ],
    metadata: {
      goal: "Light turns ON when switch is ON OR motion is detected",
      wizard: "light_control"
    }
  };
}

function valveControlPanel() {
  return {
    name: "Valve Control",
    tags: {
      "Open Valve": { kind: "DI", label: "Open Valve Button" },
      "Close Valve": { kind: "DI", label: "Close Valve Button" },
      "Limit Open": { kind: "DI", label: "Limit Switch Open" },
      "Limit Close": { kind: "DI", label: "Limit Switch Close" },
      "E-Stop": { kind: "DI", label: "Emergency Stop", group: "safety" },
      "Valve Open": { kind: "DO", label: "Valve Open Output" },
      "Valve Close": { kind: "DO", label: "Valve Close Output" }
    },
    rungs: [
      {
        branches: [[
          { tag: "E-Stop", type: "NC" },
          { tag: "Limit Close", type: "NC" },
          { tag: "Open Valve", type: "NO" }
        ]],
        coil: { tag: "Valve Open", action: "COIL" }
      },
      {
        branches: [[
          { tag: "E-Stop", type: "NC" },
          { tag: "Limit Open", type: "NC" },
          { tag: "Close Valve", type: "NO" }
        ]],
        coil: { tag: "Valve Close", action: "COIL" }
      }
    ],
    metadata: {
      goal: "Control valve open/close with limit switches and E-Stop protection",
      wizard: "valve_control"
    }
  };
}

// Wire up new template buttons
document.getElementById("wizTwoMotor")?.addEventListener("click", () => {
  const panel = twoMotorPanel();
  persistPanelSeedFromWizard(panel, "two_motor");
  return run(panel, false, true);
});
document.getElementById("wizTwoMotorUpload")?.addEventListener("click", () => {
  const panel = twoMotorPanel();
  persistPanelSeedFromWizard(panel, "two_motor");
  return run(panel, true, true);
});
document.getElementById("wizTwoMotorBuild")?.addEventListener("click", () => {
  const panel = twoMotorPanel();
  persistPanelSeedFromWizard(panel, "two_motor");
  return run(panel, false, true, true);
});

document.getElementById("wizLight")?.addEventListener("click", () => {
  const panel = lightControlPanel();
  persistPanelSeedFromWizard(panel, "light_control");
  return run(panel, false, true);
});
document.getElementById("wizLightUpload")?.addEventListener("click", () => {
  const panel = lightControlPanel();
  persistPanelSeedFromWizard(panel, "light_control");
  return run(panel, true, true);
});
document.getElementById("wizLightBuild")?.addEventListener("click", () => {
  const panel = lightControlPanel();
  persistPanelSeedFromWizard(panel, "light_control");
  return run(panel, false, true, true);
});

document.getElementById("wizValve")?.addEventListener("click", () => {
  const panel = valveControlPanel();
  persistPanelSeedFromWizard(panel, "valve_control");
  return run(panel, false, true);
});
document.getElementById("wizValveUpload")?.addEventListener("click", () => {
  const panel = valveControlPanel();
  persistPanelSeedFromWizard(panel, "valve_control");
  return run(panel, true, true);
});
document.getElementById("wizValveBuild")?.addEventListener("click", () => {
  const panel = valveControlPanel();
  persistPanelSeedFromWizard(panel, "valve_control");
  return run(panel, false, true, true);
});
