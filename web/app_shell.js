/**
 * P6 Universal Application Shell — Master Spec §5–§6
 * Mount: <div id="appShell"></div> + body[data-app-active="…"]
 * Preserves project context via /api/model/projects/active + optional ?projectId=
 */
(function () {
  const PRODUCT_NAME = "P6 Systems";

  const NAV = [
    {
      group: "WORKSPACE",
      items: [
        { id: "studio", label: "Overview / Studio", href: "/studio.html" },
        { id: "versions", label: "Projects", href: "/versions.html" },
        { id: "ingest", label: "Documents", href: "/ingest.html" }
      ]
    },
    {
      group: "ENGINEERING",
      items: [
        { id: "studio-map", label: "Studio", href: "/studio.html" },
        { id: "pid", label: "P&ID Mapping", href: "/pid_import.html" },
        { id: "library", label: "Equipment", href: "/library.html" },
        { id: "monitor", label: "I/O", href: "/monitor.html" },
        { id: "logic", label: "Logic", href: "/logic.html" },
        { id: "interlocks", label: "Interlocks", href: "/interlocks.html" }
      ]
    },
    {
      group: "SIMULATION",
      items: [
        { id: "simulate", label: "Runtime", href: "/studio.html?demo=1" },
        { id: "canvas", label: "Virtual PLC / Map", href: "/studio.html" },
        { id: "verify", label: "Verify", href: "/verify.html" },
        { id: "reports", label: "Test Results", href: "/reports.html" }
      ]
    },
    {
      group: "CONNECTIVITY",
      items: [
        { id: "connect", label: "Connect", href: "/connect.html" },
        { id: "engineering", label: "Ignition", href: "/engineering.html" },
        { id: "tags", label: "OPC UA / Tags", href: "/tags.html" }
      ]
    },
    {
      group: "OUTPUT",
      items: [
        { id: "reports-out", label: "Reports", href: "/reports.html" },
        { id: "exports", label: "Evidence / Exports", href: "/exports.html" },
        { id: "readiness", label: "Readiness", href: "/readiness.html" }
      ]
    }
  ];

  const PAGE_TITLES = {
    studio: "Studio",
    workflow: "Overview",
    versions: "Projects",
    ingest: "Documents",
    pid: "P&ID Mapping",
    library: "Equipment",
    monitor: "I/O",
    logic: "Logic",
    panel: "Control Logic",
    interlocks: "Interlocks",
    simulate: "Runtime",
    canvas: "Live Canvas",
    verify: "P6 Verify",
    connect: "P6 Connect",
    engineering: "Ignition",
    tags: "Tag Map",
    reports: "Reports",
    exports: "Exports",
    readiness: "Readiness",
    security: "Settings",
    audit: "Audit",
    trace: "X-Ray / Trace",
    import: "Documents"
  };

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function activeId() {
    return document.body?.dataset?.appActive || "";
  }

  function withProject(href) {
    try {
      const u = new URL(href, location.origin);
      const pid = sessionStorage.getItem("p6.activeProjectId");
      if (pid && !u.searchParams.get("projectId")) u.searchParams.set("projectId", pid);
      return u.pathname + u.search + u.hash;
    } catch {
      return href;
    }
  }

  function isActive(item) {
    const a = activeId();
    if (item.id === a) return true;
    if (a === "studio" && (item.id === "studio" || item.id === "studio-map" || item.id === "canvas")) return true;
    if (a === "panel" && item.id === "logic") return true;
    if (a === "import" && item.id === "ingest") return true;
    return false;
  }

  async function loadProjectContext() {
    try {
      const params = new URLSearchParams(location.search);
      const want = params.get("projectId");
      if (want) {
        await fetch("/api/model/projects/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: want })
        });
      }
      const r = await fetch("/api/model/projects/active");
      const d = await r.json();
      const p = d.project;
      if (p?.id) sessionStorage.setItem("p6.activeProjectId", p.id);
      return p || null;
    } catch {
      return null;
    }
  }

  async function loadRuntimePills() {
    try {
      const r = await fetch("/api/runtime/status");
      const s = await r.json();
      const running = !!(s.running || s.scanning || s.state === "running");
      const paused = !!(s.paused || s.state === "paused");
      return {
        mode: String(s.mode || "SIM").toUpperCase(),
        run: paused ? "PAUSED" : running ? "RUNNING" : "STOPPED",
        runClass: paused ? "pause" : running ? "run" : "stop"
      };
    } catch {
      return { mode: "SIM", run: "—", runClass: "" };
    }
  }

  function ensureFonts() {
    if (document.getElementById("p6Fonts")) return;
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    const link = document.createElement("link");
    link.id = "p6Fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;600&display=swap";
    document.head.append(pre1, pre2, link);
  }

  async function mount() {
    const host = document.getElementById("appShell");
    if (!host) return;
    // Studio (and any future host) may iframe tools with ?embed=1 — skip nested app chrome
    try {
      if (new URLSearchParams(location.search).get("embed") === "1") {
        document.body.classList.add("p6-embed");
        host.remove();
        return;
      }
    } catch (_) { /* ignore */ }

    ensureFonts();
    document.body.classList.add("p6-app");
    const project = await loadProjectContext();
    const rt = await loadRuntimePills();
    const active = activeId();
    const pageName = PAGE_TITLES[active] || "App";
    document.title = PRODUCT_NAME + " — " + pageName;

    const navHtml = NAV.map((g) => `
      <div class="p6NavGroup">
        <div class="p6NavGroupLabel">${esc(g.group)}</div>
        ${g.items.map((item) => `
          <a class="p6NavItem ${isActive(item) ? "active" : ""}" href="${esc(withProject(item.href))}">${esc(item.label)}</a>
        `).join("")}
      </div>
    `).join("");

    host.innerHTML = `
      <header class="p6Header">
        <a class="p6Brand" href="/landing.html" title="${esc(PRODUCT_NAME)}">
          <img src="${active === "verify" ? "/logo-verify.png" : "/logo.png"}" alt="${esc(active === "verify" ? "P6 Verify" : PRODUCT_NAME)}" />
        </a>
        <div class="p6ProjectBox">
          <div class="p6ProjectName" id="p6ShellProjectName">${esc(project?.name || "No active project")}</div>
          <div class="p6ProjectMeta" id="p6ShellProjectMeta">${project ? esc(`id=${project.id} · model v${project.modelVersion || 1}`) : "Open Studio or Projects to select"}</div>
        </div>
        <div class="p6HeaderPills">
          <span class="p6Pill" id="p6PillMode">${esc(rt.mode)}</span>
          <span class="p6Pill ${esc(rt.runClass)}" id="p6PillRun">${esc(rt.run)}</span>
          <span class="p6Pill" id="p6PillSave">${project ? "MODEL" : "—"}</span>
        </div>
        <div class="p6HeaderActions">
          <a class="p6Btn primary" href="${esc(withProject("/studio.html"))}">Studio</a>
          <a class="p6Btn" href="${esc(withProject("/studio.html?wizard=1"))}">New project</a>
          <a class="p6Btn" href="/security.html">Settings</a>
          <a class="p6Btn ghost" href="/landing.html">Exit</a>
        </div>
      </header>
      <aside class="p6SideNav" aria-label="Platform navigation">${navHtml}</aside>
    `;

    if (window.UI && window.UI.startHeaderStatusPolling) {
      /* legacy status host optional */
      const legacy = document.createElement("div");
      legacy.id = "headerStatusPills";
      legacy.hidden = true;
      host.appendChild(legacy);
      window.UI.startHeaderStatusPolling(4000);
    }

    setInterval(async () => {
      const next = await loadRuntimePills();
      const mode = document.getElementById("p6PillMode");
      const run = document.getElementById("p6PillRun");
      if (mode) mode.textContent = next.mode;
      if (run) {
        run.textContent = next.run;
        run.className = "p6Pill " + next.runClass;
      }
    }, 4000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.AppShell = { mount, withProject };
})();
