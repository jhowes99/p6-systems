/**
 * Shared UI helpers — commissioning tool consistency.
 * Include after app_shell.js; use setBanner instead of alert().
 */
(function () {
  "use strict";

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function ensureBannerContainer() {
    let el = document.getElementById("uiBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "uiBanner";
      el.setAttribute("aria-live", "polite");
      const main = document.querySelector("main.wrap, main.page, .wrap");
      if (main && main.firstChild) main.insertBefore(el, main.firstChild);
      else if (document.body) document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function setBanner(type, message, detail) {
    const container = ensureBannerContainer();
    container.className = "banner banner-" + (type || "info");
    container.innerHTML = "<strong>" + esc(message) + "</strong>" + (detail ? "<br><span class=\"small\">" + esc(detail) + "</span>" : "");
    container.style.display = "block";
  }

  function clearBanner() {
    const el = document.getElementById("uiBanner");
    if (el) el.style.display = "none";
  }

  async function apiFetch(url, opts) {
    const res = await fetch(url, { credentials: "include", ...opts });
    let data;
    try {
      data = await res.json();
    } catch {
      if (!res.ok) throw new Error("Request failed: " + res.status);
      return null;
    }
    if (!res.ok || data.ok === false) {
      const msg = data.error || "Request failed";
      setBanner("error", msg);
      throw new Error(msg);
    }
    return data;
  }

  function renderTable(containerEl, columns, rows, options) {
    if (!containerEl) return;
    const thead = columns.map((c) => "<th>" + esc(c.label || c.key) + "</th>").join("");
    const trs = rows.map((row) =>
      "<tr>" + columns.map((col) => {
        const val = row[col.key];
        const cell = col.render ? col.render(val, row) : esc(val);
        return "<td>" + cell + "</td>";
      }).join("") + "</tr>"
    ).join("");
    containerEl.innerHTML = "<table class=\"table\"><thead><tr>" + thead + "</tr></thead><tbody>" + trs + "</tbody></table>";
  }

  function downloadText(filename, mime, text) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  function formatAgo(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function badge(type, text) {
    return "<span class=\"badge badge-" + (type || "off") + "\">" + esc(text) + "</span>";
  }

  // ---- Tier-based feature gating (Core / Pro / Enterprise) ----
  var TIER_ORDER = { core: 0, pro: 1, enterprise: 2 };
  var cachedTier = null;

  async function fetchLicenseTier() {
    try {
      var res = await fetch("/api/license", { credentials: "include" });
      var data = await res.json();
      if (data && data.ok && data.tier) {
        cachedTier = data.tier.toLowerCase();
        return cachedTier;
      }
    } catch (e) {}
    cachedTier = "core";
    return cachedTier;
  }

  function getLicenseTier() {
    return cachedTier || "core";
  }

  function tierAtLeast(required) {
    var r = TIER_ORDER[required] ?? -1;
    var c = TIER_ORDER[getLicenseTier()] ?? 0;
    return c >= r;
  }

  function showTierModal(requiredTier) {
    var label = requiredTier === "enterprise" ? "Enterprise" : "Pro";
    var existing = document.getElementById("tierModal");
    if (!existing) {
      var wrap = document.createElement("div");
      wrap.id = "tierModal";
      wrap.className = "tierModal";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.innerHTML = "<div class=\"tierModalBackdrop\"></div><div class=\"tierModalContent\"><h3 id=\"tierModalTitle\">" + label + "</h3><p id=\"tierModalMessage\">This feature is available in " + label + ". Contact your administrator to enable.</p><button type=\"button\" class=\"btn\" id=\"tierModalClose\">OK</button></div>";
      document.body.appendChild(wrap);
      var closeBtn = document.getElementById("tierModalClose");
      var back = wrap.querySelector(".tierModalBackdrop");
      if (closeBtn) closeBtn.onclick = function () { wrap.style.display = "none"; };
      if (back) back.onclick = function () { wrap.style.display = "none"; };
      wrap.style.display = "none";
    }
    var title = document.getElementById("tierModalTitle");
    var msg = document.getElementById("tierModalMessage");
    if (title) title.textContent = label;
    if (msg) msg.textContent = "This feature is available in " + label + ". Contact your administrator to enable.";
    existing = document.getElementById("tierModal");
    if (existing) { existing.style.display = "flex"; }
  }

  function applyTierGating() {
    var tier = getLicenseTier();
    var selectors = ["[data-tier=\"pro\"]", "[data-tier=\"enterprise\"]"];
    selectors.forEach(function (sel) {
      var required = sel.indexOf("enterprise") !== -1 ? "enterprise" : "pro";
      document.querySelectorAll(sel).forEach(function (el) {
        if (tierAtLeast(required)) {
          el.classList.remove("tier-locked");
          el.removeAttribute("data-tier-locked");
          return;
        }
        el.classList.add("tier-locked");
        el.setAttribute("data-tier-locked", required);
        if (el._tierClickBound) return;
        el._tierClickBound = true;
        el.addEventListener("click", function (e) {
          if (el.getAttribute("data-tier-locked")) {
            e.preventDefault();
            e.stopPropagation();
            showTierModal(required);
          }
        });
      });
    });
  }

  async function refreshLicenseAndGating() {
    await fetchLicenseTier();
    applyTierGating();
  }

  function navigateTo(tabOrUrl) {
    if (typeof tabOrUrl === "string") {
      if (tabOrUrl.startsWith("/") || tabOrUrl.startsWith("http")) window.location.href = tabOrUrl;
      else window.location.href = "/" + tabOrUrl + ".html";
    }
  }

  let statusPollTimer = null;
  let lastStatus = null;

  function renderHeaderStatus(status) {
    const host = document.getElementById("headerStatusPills");
    if (!host) return;
    if (!status || status.ok === false) {
      host.innerHTML = "<span class=\"pill badge-off\">Status unavailable</span>";
      return;
    }
    const project = status.projectLoaded ? "<a href=\"/pid_import.html\" class=\"pill pill-ok\">Project loaded</a>" : "<a href=\"/pid_import.html\" class=\"pill pill-warn\">Not loaded</a>";
    let validation = "<a href=\"/validation.html\" class=\"pill badge-off\">Validation —</a>";
    if (status.validation) {
      const v = status.validation;
      const cls = v.score >= 80 ? "pill-ok" : v.score >= 50 ? "pill-warn" : "pill-error";
      validation = "<a href=\"/validation.html\" class=\"pill " + cls + "\">Validation " + v.score + " " + formatAgo(v.lastRunAt) + "</a>";
    }
    let tests = "<a href=\"/tests.html\" class=\"pill badge-off\">Tests —</a>";
    if (status.tests && status.tests.total > 0) {
      const t = status.tests;
      const cls = t.status === "PASS" ? "pill-ok" : "pill-error";
      tests = "<a href=\"/tests.html\" class=\"pill " + cls + "\">Tests " + t.status + " " + formatAgo(t.lastRunAt) + "</a>";
    }
    const secure = status.secureMode
      ? (status.authenticated ? "<a href=\"/security.html\" class=\"pill pill-ok\">Secure ON</a>" : "<a href=\"/security.html\" class=\"pill pill-error\">Login required</a>")
      : "<a href=\"/security.html\" class=\"pill badge-off\">Secure OFF</a>";
    host.innerHTML = project + " " + validation + " " + tests + " " + secure;
  }

  async function fetchStatus() {
    try {
      const res = await fetch("/api/status", { credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        lastStatus = data;
        try { localStorage.setItem("ui.lastStatus", JSON.stringify(data)); } catch (e) {}
      }
      renderHeaderStatus(data);
    } catch (e) {
      try {
        const cached = localStorage.getItem("ui.lastStatus");
        if (cached) renderHeaderStatus(JSON.parse(cached));
        else renderHeaderStatus(null);
      } catch (e2) {
        renderHeaderStatus(null);
      }
    }
  }

  function startHeaderStatusPolling(intervalMs) {
    intervalMs = intervalMs || 4000;
    if (document.visibilityState === "visible") fetchStatus();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") fetchStatus();
    });
    statusPollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (window.lastStatusAuthenticated === false) return; // reduce polling when login required
      fetchStatus();
    }, intervalMs);
  }

  window.UI = {
    setBanner,
    clearBanner,
    apiFetch,
    renderTable,
    downloadText,
    formatDate,
    formatAgo,
    badge,
    navigateTo,
    renderHeaderStatus,
    startHeaderStatusPolling,
    esc,
    getLicenseTier: function () { return getLicenseTier(); },
    tierAtLeast,
    fetchLicenseTier,
    refreshLicenseAndGating,
    applyTierGating,
    showTierModal
  };
})();
