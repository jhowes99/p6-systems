(function () {
  const steps = [
    { id: "import", label: "Import Bundle", href: "/pid_import.html", desc: "P&ID, I/O List, Cause & Effect" },
    { id: "validate", label: "Validate", href: "/validation.html", desc: "Cross-document sanity checks" },
    { id: "monitor", label: "Monitor", href: "/monitor.html", desc: "Live I/O and diagram" },
    { id: "interlocks", label: "Interlocks", href: "/interlocks.html", desc: "Permissives, trips, reason tree" },
    { id: "tests", label: "FAT/SAT Tests", href: "/tests.html", desc: "Generate and run tests" },
    { id: "export", label: "Export Commissioning Packet", href: "/exports.html", desc: "Download packet and reports" },
    { id: "versions", label: "Versions", href: "/versions.html", desc: "Snapshots and diff" },
    { id: "security", label: "Security", href: "/security.html", desc: "Secure mode and audit" }
  ];

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function badgeClass(status) {
    if (status === "ok" || status === "PASS" || status === "loaded") return "badge-ok";
    if (status === "warn" || status === "WARN") return "badge-warn";
    if (status === "error" || status === "FAIL") return "badge-error";
    return "badge-off";
  }

  function renderCards(status) {
    const container = document.getElementById("workflowCards");
    if (!container) return;
    const projectLoaded = status?.projectLoaded ?? false;
    const validation = status?.validation;
    const tests = status?.tests;
    const secureMode = status?.secureMode ?? false;
    const authenticated = status?.authenticated !== false;

    const getBadge = (stepId) => {
      if (stepId === "import") return { text: projectLoaded ? "Loaded" : "Not loaded", type: projectLoaded ? "ok" : "off" };
      if (stepId === "validate") return validation ? { text: "Score " + validation.score + " · " + (validation.lastRunAt ? "run" : ""), type: validation.score >= 80 ? "ok" : validation.score >= 50 ? "warn" : "error" } : { text: "—", type: "off" };
      if (stepId === "tests") return tests && tests.total > 0 ? { text: tests.status + " · " + (tests.lastRunAt ? "run" : ""), type: tests.status === "PASS" ? "ok" : "error" } : { text: "—", type: "off" };
      if (stepId === "security") return { text: secureMode ? (authenticated ? "ON" : "Login required") : "OFF", type: secureMode && !authenticated ? "error" : secureMode ? "ok" : "off" };
      return { text: "—", type: "off" };
    };

    container.innerHTML = steps.map((s) => {
      const b = getBadge(s.id);
      return "<a href=\"" + esc(s.href) + "\" class=\"workflowCard\"><h3>" + esc(s.label) + "</h3><p class=\"small\">" + esc(s.desc) + "</p><span class=\"badge " + badgeClass(b.type) + "\">" + esc(b.text) + "</span></a>";
    }).join("");
  }

  async function load() {
    try {
      const res = await fetch("/api/status", { credentials: "include" });
      const data = await res.json();
      if (data.ok) renderCards(data);
      else renderCards(null);
    } catch (e) {
      renderCards(null);
    }
  }

  load();
  setInterval(load, 5000);
})();
