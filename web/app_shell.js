/* Shared app shell for all pages (tabs + 4 big actions).
   Usage: add <div id="appShell"></div>, include this script, set <body data-app-active="panel"> */
(function () {
  const PRODUCT_NAME = "P6 Systems";
  const PRODUCT_TAGLINE = "From P&ID to virtual commissioning.";
  const PRODUCT_SUBLINE = "Studio • Runtime • Verify • Connect";

  const PAGE_TITLES = {
    workflow: "Dashboard", validation: "Validate", tests: "Tests", exports: "Reports",
    versions: "Projects", security: "Settings", panel: "Control Logic", monitor: "I/O Mapping",
    interlocks: "Interlocks", hmi: "HMI", safety: "Safety", wizards: "Equipment Library",
    narrative: "Documents", timeline: "Sequencing", audit: "Audit Log",
    import: "Documents", pid: "P&ID Viewer", scan: "Scan-to-Build", teach: "Teach Mode",
    electrician: "Electrician View", project: "Projects",
    simulate: "Simulation", verify: "P6 Verify", connect: "P6 Connect",
    canvas: "Live Canvas", tags: "Tag Map", trace: "Traceability", logic: "Logic Deploy",
    library: "Equipment Library", reports: "Reports", readiness: "Readiness", ingest: "Documents"
  };

  const TABS = [
    { id: "workflow", label: "Dashboard", href: "/workflow.html" },
    { id: "versions", label: "Projects", href: "/versions.html" },
    { id: "ingest", label: "Documents", href: "/ingest.html" },
    { id: "import", label: "P&ID Import", href: "/pid_import.html" },
    { id: "library", label: "Equipment Library", href: "/library.html" },
    { id: "monitor", label: "I/O Mapping", href: "/monitor.html" },
    { id: "panel", label: "Control Logic", href: "/panel_builder.html" },
    { id: "logic", label: "Logic Deploy", href: "/logic.html" },
    { id: "simulate", label: "Simulation", href: "/simulation.html" },
    { id: "canvas", label: "Live Canvas", href: "/canvas.html" },
    { id: "verify", label: "P6 Verify", href: "/verify.html" },
    { id: "trace", label: "Traceability", href: "/trace.html" },
    { id: "connect", label: "P6 Connect", href: "/connect.html" },
    { id: "tags", label: "Tag Map", href: "/tags.html" },
    { id: "engineering", label: "Ignition Eng.", href: "/engineering.html" },
    { id: "reports", label: "Reports", href: "/reports.html" },
    { id: "readiness", label: "Readiness", href: "/readiness.html" },
    { id: "security", label: "Settings", href: "/security.html" },
    { id: "audit", label: "Audit", href: "/audit.html", tier: "enterprise" }
  ];

  const TOOLBAR = [
    { label: "Simulate", sub: "P6 Runtime", href: "/simulation.html", primary: true },
    { label: "Canvas", sub: "Live process", href: "/canvas.html" },
    { label: "Verify", sub: "FAT tests", href: "/verify.html" }
  ];
  const PRIMARY_TAB_IDS = new Set(["simulate", "canvas", "verify", "connect"]);

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function getBoolLS(key, def) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return def;
      return v === "1";
    } catch {
      return def;
    }
  }
  function setBoolLS(key, v) {
    try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ }
  }
  // Unified mode - always use simple language with OT terms
  function getModeLS() {
    return "beginner"; // Always unified mode
  }
  function setModeLS(mode) {
    // No-op - mode is always unified
  }

  async function setStrictMode(enabled) {
    try {
      await fetch("/api/mode/strict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !!enabled })
      });
    } catch {
      // ignore (local demo)
    }
  }

  function applyPrefs() {
    // Always-on accessibility prefs (per request): Gloves + Contrast + Strict
    setBoolLS("ui.gloves", true);
    setBoolLS("ui.hicontrast", true);
    const strictWas = getBoolLS("ui.strict", false);
    if (!strictWas) setBoolLS("ui.strict", true);
    // Apply classes
    document.body.classList.add("gloves", "hicontrast");
    // Ensure strict mode best-effort on first load
    if (!strictWas) setStrictMode(true);
    return { gloves: true, hc: true, strict: true };
  }

  function tabMarkup(tab, className) {
    const isActive = tab.id === (document.body?.dataset?.appActive || "");
    const tier = tab.tier || "";
    return `
      <a class="${className} ${isActive ? "active" : ""}" href="${esc(tab.href)}" data-tab="${esc(tab.id)}"${tier ? ` data-tier="${esc(tier)}"` : ""}${isActive ? ` aria-current="page"` : ""}>
        ${esc(tab.label)}
        ${tab.tier === "pro" ? `<span class="tabPill tierPill">Pro</span>` : ""}
        ${tab.tier === "enterprise" ? `<span class="tabPill tierPill">Enterprise</span>` : ""}
        ${tab.id === "simulate" ? `<span class="tabPill">Live</span>` : ""}
        ${tab.id === "workflow" ? `<span class="tabPill">Default</span>` : ""}
      </a>
    `;
  }

  function mount() {
    const host = document.getElementById("appShell");
    if (!host) return;

    const active = document.body?.dataset?.appActive || "";
    const prefs = applyPrefs();
    const mode = "beginner"; // Always unified mode
    document.body.setAttribute("data-mode", mode);

    host.innerHTML = `
      <div class="appShell">
        <div class="appShellBar">
          <div class="brandRow">
            <div class="brandLogoWrap">
              <img src="/logo.png" alt="${esc(PRODUCT_NAME)}" class="brandLogo" />
            </div>
            <div>
              <div class="brandTag">${esc(PRODUCT_TAGLINE)}</div>
              <div class="brandSubline">${esc(PRODUCT_SUBLINE)}</div>
            </div>
            <a href="/safety.html" class="defineSafetyBtn" title="Define Safety - Configure E-Stops, Interlocks, and Safety Chain">
              <span class="safetyBtnIcon">🛡️</span>
              <span>Define Safety</span>
            </a>
            <a href="/pid_import.html" class="pidImportBtn" title="Import and Generate - P&ID, Logic to Control Narrative, and more">
              <span class="pidIcon">📋</span>
              <span>Import and Generate</span>
            </a>
          </div>

          <div class="navRow">
            <div id="headerStatusPills" class="headerStatusPills"></div>
            <details class="quickActionsDrop" id="quickActionsDrop">
              <summary class="quickActionsBtn" aria-label="Quick actions">Actions</summary>
              <div class="quickActionsMenu" role="menu">
                <button type="button" data-action="runValidation">Run Validation</button>
                <button type="button" data-action="generateTests">Generate Tests</button>
                <button type="button" data-action="runTests">Run Tests</button>
                <button type="button" data-action="downloadPacket">Download Commissioning Packet</button>
                <button type="button" data-action="createSnapshot">Create Snapshot</button>
              </div>
            </details>
            <details class="menuDrawer">
              <summary class="hamburgerBtn" aria-label="Open navigation menu">
                <span class="burgerIcon" aria-hidden="true"></span>
                <span class="burgerLabel">Menu</span>
              </summary>
              <div class="drawerList" role="menu">
                ${TABS.map(t => tabMarkup(t, "drawerLink")).join("")}
              </div>
            </details>
          </div>
        </div>

        <div class="toolbar" aria-label="Main actions">
          <a class="toolBtn toolBtnHome" href="/workflow.html" title="Workflow – start here">
            <span class="homeIcon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </span>
            <span>Home</span>
          </a>
          ${TOOLBAR.map(b => `
            <a class="toolBtn ${b.primary ? "primary" : ""}" href="${esc(b.href)}">
              <span>${esc(b.label)}</span>
              <span class="sub">${esc(b.sub)}</span>
            </a>
          `).join("")}
        </div>
      </div>
    `;

    if (window.UI && window.UI.startHeaderStatusPolling) window.UI.startHeaderStatusPolling(4000);
    if (window.UI && window.UI.renderHeaderStatus) window.UI.renderHeaderStatus(null);
    setTimeout(function () {
      if (window.UI && window.UI.refreshLicenseAndGating) window.UI.refreshLicenseAndGating();
    }, 0);

    const tab = TABS.find(t => t.id === active);
    const pageName = PAGE_TITLES[active] || (tab && tab.label) || "App";
    document.title = PRODUCT_NAME + " — " + pageName;

    const qa = document.getElementById("quickActionsDrop");
    if (qa) {
      qa.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const action = btn.getAttribute("data-action");
          qa.removeAttribute("open");
          if (!window.UI) return;
          try {
            if (action === "runValidation") {
              const last = await fetch("/api/project/last", { credentials: "include" }).then((r) => r.json());
              if (!last.ok || !last.project) { window.UI.setBanner("warn", "Load a project first.", "Go to Import."); return; }
              const res = await fetch("/api/project/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pidElements: {}, ioListEntries: last.project.ioEntries || [], causeEffectRules: last.project.causeEffectRules || [] }), credentials: "include" });
              const data = await res.json();
              if (data.ok) window.UI.setBanner("ok", "Validation complete. Score: " + (data.score ?? 0), "See Validate tab for details.");
              else window.UI.setBanner("error", data.error || "Validation failed.");
            } else if (action === "generateTests") {
              const res = await fetch("/api/tests/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "include" });
              const data = await res.json();
              if (data.ok) window.UI.setBanner("ok", "Generated " + (data.tests?.length ?? 0) + " tests.", "Go to Tests to run them.");
              else window.UI.setBanner("error", data.error || "Generate failed.");
            } else if (action === "runTests") {
              const gen = await fetch("/api/tests/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "include" }).then((r) => r.json());
              const tests = gen.tests || [];
              if (!tests.length) { window.UI.setBanner("warn", "No tests to run. Generate from C&E first."); return; }
              const res = await fetch("/api/tests/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tests }), credentials: "include" });
              const data = await res.json();
              if (data.ok) window.UI.setBanner("ok", "Tests complete: " + (data.summary?.passed ?? 0) + " passed, " + (data.summary?.failed ?? 0) + " failed.", "");
              else window.UI.setBanner("error", data.error || "Run failed.");
            } else if (action === "downloadPacket") {
              const r = await fetch("/api/export/commissioning-packet", { credentials: "include" });
              if (!r.ok) { const j = await r.json().catch(() => ({})); window.UI.setBanner("error", j.error || "Download failed."); return; }
              const blob = await r.blob();
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "commissioning_packet.zip"; a.click(); URL.revokeObjectURL(a.href);
              window.UI.setBanner("ok", "Commissioning packet downloaded. Project reset — you can import another.", "");
            } else if (action === "createSnapshot") {
              const res = await fetch("/api/snapshots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "snapshot" }), credentials: "include" });
              const data = await res.json();
              if (data.ok) window.UI.setBanner("ok", "Snapshot created.", "See Versions tab.");
              else window.UI.setBanner("error", data.error || "Snapshot failed.");
            }
          } catch (e) {
            window.UI.setBanner("error", e?.message || "Action failed.");
          }
        });
      });
    }
  }

  // auto mount
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  // expose for debugging
  window.AppShell = { mount };
})();

