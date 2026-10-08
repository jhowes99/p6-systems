(function () {
  const btnSyncCE = document.getElementById("btnSyncCE");
  const btnGenerate = document.getElementById("btnGenerate");
  const btnRun = document.getElementById("btnRun");
  const btnExport = document.getElementById("btnExport");
  const rerunRow = document.getElementById("rerunRow");
  const btnRerunAll = document.getElementById("btnRerunAll");
  const btnRerunFailed = document.getElementById("btnRerunFailed");
  const summary = document.getElementById("summary");
  const resultsBody = document.getElementById("resultsBody");
  const detailDrawer = document.getElementById("detailDrawer");
  const detailTitle = document.getElementById("detailTitle");
  const detailFixGuide = document.getElementById("detailFixGuide");
  const detailContent = document.getElementById("detailContent");
  const btnFixInApp = document.getElementById("btnFixInApp");
  const btnRerunThis = document.getElementById("btnRerunThis");
  const btnCloseDetail = document.getElementById("btnCloseDetail");

  let lastTests = [];
  let lastRun = null;
  /** Current failed result when detail drawer or fix modal is open (for re-run / apply). */
  let lastDetailResult = null;

  async function updateEmptyState() {
    const emptyEl = document.getElementById("emptyStateTests");
    const contentEl = document.getElementById("testsContent");
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

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function renderResults() {
    if (!lastRun?.results) return;
    const s = lastRun.summary || {};
    summary.textContent = `Total: ${s.total}, Passed: ${s.passed}, Failed: ${s.failed}`;
    resultsBody.innerHTML = (lastRun.results || []).map((r) => {
      const failures = [...(r.outputDiffs || []).map((d) => `${d.var} expected ${d.expected} got ${d.actual}`), ...(r.memDiffs || []).map((d) => `${d.var} expected ${d.expected} got ${d.actual}`)].join("; ");
      return `<tr>
        <td>${esc(r.name)}</td>
        <td class="${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</td>
        <td>${esc(failures)}</td>
        <td><button class="linkBtn" data-idx="${r.id}">Detail</button></td>
      </tr>`;
    }).join("");
    btnExport.disabled = false;
    if (rerunRow) rerunRow.style.display = "flex";
    if (btnRerunFailed) btnRerunFailed.style.display = (s.failed > 0) ? "inline-flex" : "none";
    resultsBody.querySelectorAll(".linkBtn").forEach((btn) => {
      btn.onclick = () => showDetail(btn.dataset.idx);
    });
  }

  const FIX_STEPS = [
    "Cause & Effect — Edit the C&E rule below if the rule is wrong.",
    "Monitor — Use Live I/O to verify input states match what the test expects (causes ON/OFF).",
    "Build View — Check the rung that drives this output; extra conditions or wrong logic will prevent the output from turning on.",
    "Fix here — Edit the C&E list below, then Apply C&E & re-run this test."
  ];

  /** From test id like ce-1-pos or ce-2-neg get 0-based rule index, or -1. */
  function getRuleIndexFromTestId(id) {
    if (!id || typeof id !== "string") return -1;
    const m = /^ce-(\d+)-/.exec(id);
    return m ? Math.max(0, parseInt(m[1], 10) - 1) : -1;
  }

  function buildFixGuide(r) {
    const outputDiffs = r.outputDiffs || [];
    const memDiffs = r.memDiffs || [];
    const parts = [];
    for (const d of outputDiffs) {
      if (d.expected === true) {
        parts.push(`<strong>Output ${esc(d.var)}</strong> was expected to be <strong>ON</strong> but was <strong>OFF</strong>.`);
      } else {
        parts.push(`<strong>Output ${esc(d.var)}</strong> was expected to be <strong>OFF</strong> but was <strong>ON</strong>.`);
      }
    }
    for (const d of memDiffs) {
      if (d.expected === true) {
        parts.push(`<strong>Memory ${esc(d.var)}</strong> was expected <strong>ON</strong> but was <strong>OFF</strong>.`);
      } else {
        parts.push(`<strong>Memory ${esc(d.var)}</strong> was expected <strong>OFF</strong> but was <strong>ON</strong>.`);
      }
    }
    if (parts.length === 0) return "";
    let html = "<p class=\"fixGuideLead\">" + parts.join(" ") + "</p>";
    html += "<p class=\"fixGuideSub\">Things to check:</p><ul class=\"fixGuideSteps\">";
    FIX_STEPS.forEach((s) => { html += "<li>" + esc(s) + "</li>"; });
    html += "</ul>";
    return html;
  }

  function getFixModalMessage(r) {
    const outputDiffs = r.outputDiffs || [];
    const memDiffs = r.memDiffs || [];
    const parts = [];
    for (const d of outputDiffs) {
      if (d.expected === true) parts.push("Output " + d.var + " was expected to be ON but was OFF.");
      else parts.push("Output " + d.var + " was expected to be OFF but was ON.");
    }
    for (const d of memDiffs) {
      if (d.expected === true) parts.push("Memory " + d.var + " was expected ON but was OFF.");
      else parts.push("Memory " + d.var + " was expected OFF but was ON.");
    }
    return parts.length ? parts.join(" ") : "Test failed.";
  }

  async function openFixModal(result) {
    lastDetailResult = result;
    const modal = document.getElementById("testsFixModal");
    const titleEl = document.getElementById("testsFixModalTitle");
    const messageEl = document.getElementById("testsFixModalMessage");
    const stepsEl = document.getElementById("testsFixModalSteps");
    const ceSection = document.getElementById("testsFixModalCE");
    const causesInput = document.getElementById("testsFixModalCauses");
    const effectsInput = document.getElementById("testsFixModalEffects");
    const ceStatus = document.getElementById("testsFixModalCEStatus");
    if (!modal || !titleEl || !messageEl || !stepsEl) return;
    titleEl.textContent = result.name || result.id || "Test failed";
    messageEl.textContent = getFixModalMessage(result);
    stepsEl.innerHTML = FIX_STEPS.map((s) => "<li>" + esc(s) + "</li>").join("");
    const ruleIndex = getRuleIndexFromTestId(result.id);
    if (ceSection) ceSection.style.display = ruleIndex >= 0 ? "block" : "none";
    if (ceStatus) { ceStatus.style.display = "none"; ceStatus.textContent = ""; ceStatus.className = "testsFixModalEditStatus"; }
    if (ruleIndex >= 0 && (causesInput || effectsInput)) {
      try {
        const r = await fetch("/api/project/last", { credentials: "include" });
        const data = await r.json();
        const rules = (data?.ok && data?.project?.causeEffectRules) || [];
        const rule = rules[ruleIndex];
        if (rule) {
          if (causesInput) causesInput.value = (rule.causes || []).join(", ");
          if (effectsInput) effectsInput.value = (rule.effects || []).join(", ");
        } else {
          if (causesInput) causesInput.value = "";
          if (effectsInput) effectsInput.value = "";
        }
      } catch {
        if (causesInput) causesInput.value = "";
        if (effectsInput) effectsInput.value = "";
      }
    }
    modal.setAttribute("aria-hidden", "false");
    modal.style.display = "flex";
  }

  function closeFixModal() {
    const modal = document.getElementById("testsFixModal");
    if (modal) {
      modal.setAttribute("aria-hidden", "true");
      modal.style.display = "none";
    }
  }

  function showDetail(id) {
    const r = (lastRun?.results || []).find((x) => x.id === id);
    if (!r) return;
    lastDetailResult = r;
    detailTitle.textContent = r.name || r.id;
    if (r.pass === false && detailFixGuide) {
      detailFixGuide.innerHTML = buildFixGuide(r);
      detailFixGuide.style.display = "block";
      if (btnFixInApp) btnFixInApp.style.display = "inline-flex";
      if (btnRerunThis) { btnRerunThis.style.display = "inline-flex"; btnRerunThis.dataset.detailId = r.id; }
    } else {
      detailFixGuide.style.display = "none";
      detailFixGuide.innerHTML = "";
      if (btnFixInApp) btnFixInApp.style.display = "none";
      if (btnRerunThis) btnRerunThis.style.display = "none";
    }
    const lines = [
      "Initial snapshot (outputs): " + JSON.stringify(r.initialSnapshot?.outputs || {}, null, 2),
      "Final snapshot (outputs): " + JSON.stringify(r.finalSnapshot?.outputs || {}, null, 2),
      "Output diffs: " + JSON.stringify(r.outputDiffs || [], null, 2),
      "Mem diffs: " + JSON.stringify(r.memDiffs || [], null, 2)
    ];
    detailContent.textContent = lines.join("\n\n");
    detailDrawer.style.display = "block";
  }

  async function runTestsSubset(testsToRun) {
    if (!testsToRun.length) return null;
    const res = await fetch("/api/tests/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tests: testsToRun })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return null;
    return data;
  }

  if (btnSyncCE) {
    btnSyncCE.onclick = async () => {
      try {
        btnSyncCE.disabled = true;
        summary.textContent = "Syncing C&E from logic...";
        const res = await fetch("/api/project/derive-ce-from-logic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          summary.textContent = "Error: " + (data.error || "Sync failed");
          return;
        }
        const count = data.count ?? (data.causeEffectRules || []).length;
        summary.textContent = "C&E synced from logic: " + count + " rule(s). Click Generate from C&E to refresh tests.";
        lastTests = [];
        lastRun = null;
        resultsBody.innerHTML = "";
        btnRun.disabled = true;
        btnExport.disabled = true;
        if (rerunRow) rerunRow.style.display = "none";
      } catch (e) {
        summary.textContent = "Error: " + (e?.message || e);
      } finally {
        btnSyncCE.disabled = false;
      }
    };
  }

  btnGenerate.onclick = async () => {
    try {
      const res = await fetch("/api/tests/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        summary.textContent = "Error: " + (data.error || "Generate failed");
        return;
      }
      lastTests = data.tests || [];
      lastRun = null;
      summary.textContent = `Generated ${lastTests.length} test(s). Click Run Tests.`;
      resultsBody.innerHTML = "";
      btnRun.disabled = lastTests.length === 0;
      btnExport.disabled = true;
      if (rerunRow) rerunRow.style.display = "none";
    } catch (e) {
      summary.textContent = "Error: " + (e?.message || e);
    }
  };

  btnRun.onclick = async () => {
    if (!lastTests.length) return;
    try {
      summary.textContent = "Running...";
      const res = await fetch("/api/tests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tests: lastTests })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        summary.textContent = "Error: " + (data.error || "Run failed");
        return;
      }
      lastRun = data;
      renderResults();
    } catch (e) {
      summary.textContent = "Error: " + (e?.message || e);
    }
  };

  if (btnRerunAll) {
    btnRerunAll.onclick = async () => {
      if (!lastTests.length) return;
      try {
        summary.textContent = "Re-running all...";
        const data = await runTestsSubset(lastTests);
        if (!data) { summary.textContent = "Re-run failed."; return; }
        lastRun = data;
        renderResults();
      } catch (e) {
        summary.textContent = "Error: " + (e?.message || e);
      }
    };
  }

  if (btnRerunFailed) {
    btnRerunFailed.onclick = async () => {
      const failed = (lastRun?.results || []).filter((x) => !x.pass);
      if (!failed.length) return;
      const testsToRun = failed.map((f) => lastTests.find((t) => t.id === f.id)).filter(Boolean);
      if (!testsToRun.length) return;
      try {
        summary.textContent = "Re-running failed tests...";
        const data = await runTestsSubset(testsToRun);
        if (!data) { summary.textContent = "Re-run failed."; return; }
        const byId = {};
        (data.results || []).forEach((res) => { byId[res.id] = res; });
        lastRun.results = (lastRun.results || []).map((old) => byId[old.id] != null ? byId[old.id] : old);
        lastRun.summary = { total: lastRun.results.length, passed: lastRun.results.filter((r) => r.pass).length, failed: lastRun.results.filter((r) => !r.pass).length };
        renderResults();
      } catch (e) {
        summary.textContent = "Error: " + (e?.message || e);
      }
    };
  }

  if (btnRerunThis) {
    btnRerunThis.onclick = async () => {
      const id = btnRerunThis.dataset.detailId;
      if (!id) return;
      const testDef = lastTests.find((t) => t.id === id);
      if (!testDef) return;
      try {
        btnRerunThis.disabled = true;
        btnRerunThis.textContent = "Running...";
        const data = await runTestsSubset([testDef]);
        if (!data || !data.results || !data.results[0]) {
          btnRerunThis.disabled = false;
          btnRerunThis.textContent = "Re-run this test";
          return;
        }
        const newResult = data.results[0];
        const idx = (lastRun.results || []).findIndex((r) => r.id === id);
        if (idx >= 0) lastRun.results[idx] = newResult;
        lastRun.summary = { total: lastRun.results.length, passed: lastRun.results.filter((r) => r.pass).length, failed: lastRun.results.filter((r) => !r.pass).length };
        renderResults();
        if (newResult.pass) {
          detailDrawer.style.display = "none";
          if (summary) summary.textContent = "Total: " + lastRun.summary.total + ", Passed: " + lastRun.summary.passed + ", Failed: " + lastRun.summary.failed + " — This test now passes.";
        } else {
          detailFixGuide.innerHTML = buildFixGuide(newResult);
          detailContent.textContent = [
            "Initial snapshot (outputs): " + JSON.stringify(newResult.initialSnapshot?.outputs || {}, null, 2),
            "Final snapshot (outputs): " + JSON.stringify(newResult.finalSnapshot?.outputs || {}, null, 2),
            "Output diffs: " + JSON.stringify(newResult.outputDiffs || [], null, 2),
            "Mem diffs: " + JSON.stringify(newResult.memDiffs || [], null, 2)
          ].join("\n\n");
        }
        btnRerunThis.disabled = false;
        btnRerunThis.textContent = "Re-run this test";
      } catch (e) {
        btnRerunThis.disabled = false;
        btnRerunThis.textContent = "Re-run this test";
      }
    };
  }

  btnCloseDetail.onclick = () => {
    detailDrawer.style.display = "none";
  };

  if (btnFixInApp) {
    btnFixInApp.onclick = () => {
      if (lastDetailResult) openFixModal(lastDetailResult);
    };
  }

  const testsFixModal = document.getElementById("testsFixModal");
  const testsFixModalBackdrop = document.querySelector("#testsFixModal .testsFixModalBackdrop");
  const testsFixModalClose = document.getElementById("testsFixModalClose");
  if (testsFixModalBackdrop) testsFixModalBackdrop.addEventListener("click", closeFixModal);
  if (testsFixModalClose) testsFixModalClose.addEventListener("click", closeFixModal);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && testsFixModal && testsFixModal.getAttribute("aria-hidden") === "false") closeFixModal();
  });

  const testsFixModalApplyCE = document.getElementById("testsFixModalApplyCE");
  const testsFixModalCauses = document.getElementById("testsFixModalCauses");
  const testsFixModalEffects = document.getElementById("testsFixModalEffects");
  const testsFixModalCEStatus = document.getElementById("testsFixModalCEStatus");
  if (testsFixModalApplyCE && testsFixModalCauses && testsFixModalEffects && testsFixModalCEStatus) {
    testsFixModalApplyCE.addEventListener("click", async () => {
      const result = lastDetailResult;
      if (!result) return;
      const ruleIndex = getRuleIndexFromTestId(result.id);
      if (ruleIndex < 0) {
        testsFixModalCEStatus.textContent = "This test is not a C&E rule test.";
        testsFixModalCEStatus.className = "testsFixModalEditStatus error";
        testsFixModalCEStatus.style.display = "block";
        return;
      }
      const causesStr = (testsFixModalCauses.value || "").trim();
      const effectsStr = (testsFixModalEffects.value || "").trim();
      const causes = causesStr.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      const effects = effectsStr.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      if (!causes.length || !effects.length) {
        testsFixModalCEStatus.textContent = "Enter at least one cause and one effect (comma-separated tags).";
        testsFixModalCEStatus.className = "testsFixModalEditStatus error";
        testsFixModalCEStatus.style.display = "block";
        return;
      }
      testsFixModalApplyCE.disabled = true;
      testsFixModalCEStatus.style.display = "block";
      testsFixModalCEStatus.textContent = "Applying C&E…";
      testsFixModalCEStatus.className = "testsFixModalEditStatus";
      try {
        const res = await fetch("/api/project/cause-effect-rule", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleIndex, causes, effects }),
          credentials: "include"
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          testsFixModalCEStatus.textContent = data.error || "Update failed.";
          testsFixModalCEStatus.className = "testsFixModalEditStatus error";
          testsFixModalApplyCE.disabled = false;
          return;
        }
        testsFixModalCEStatus.textContent = "Regenerating tests and re-running…";
        const genRes = await fetch("/api/tests/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          credentials: "include"
        });
        const genData = await genRes.json();
        const newTests = (genData.ok && genData.tests) ? genData.tests : lastTests;
        const testDef = newTests.find((t) => t.id === result.id);
        if (!testDef) {
          testsFixModalCEStatus.textContent = "C&E updated. Re-generate and run tests from the main page.";
          testsFixModalCEStatus.className = "testsFixModalEditStatus";
          testsFixModalApplyCE.disabled = false;
          lastTests = newTests;
          return;
        }
        lastTests = lastTests.map((t) => (t.id === result.id ? testDef : t));
        if (lastTests.every((t) => t.id !== result.id)) lastTests = newTests;
        const runData = await runTestsSubset([testDef]);
        if (!runData || !runData.results || !runData.results[0]) {
          testsFixModalCEStatus.textContent = "C&E updated. Re-run failed (try Run Tests again).";
          testsFixModalCEStatus.className = "testsFixModalEditStatus";
          testsFixModalApplyCE.disabled = false;
          return;
        }
        const newResult = runData.results[0];
        const idx = (lastRun.results || []).findIndex((r) => r.id === result.id);
        if (idx >= 0) lastRun.results[idx] = newResult;
        lastRun.summary = { total: lastRun.results.length, passed: lastRun.results.filter((r) => r.pass).length, failed: lastRun.results.filter((r) => !r.pass).length };
        renderResults();
        lastDetailResult = newResult;
        if (newResult.pass) {
          testsFixModalCEStatus.textContent = "C&E updated. Test re-run: PASS.";
          testsFixModalCEStatus.className = "testsFixModalEditStatus ok";
          detailDrawer.style.display = "none";
          if (summary) summary.textContent = "Total: " + lastRun.summary.total + ", Passed: " + lastRun.summary.passed + ", Failed: " + lastRun.summary.failed;
        } else {
          testsFixModalCEStatus.textContent = "C&E updated. Test re-run: still failing. Check tags in IO list or logic.";
          testsFixModalCEStatus.className = "testsFixModalEditStatus";
          if (detailFixGuide) detailFixGuide.innerHTML = buildFixGuide(newResult);
          if (detailContent) detailContent.textContent = [
            "Initial snapshot (outputs): " + JSON.stringify(newResult.initialSnapshot?.outputs || {}, null, 2),
            "Final snapshot (outputs): " + JSON.stringify(newResult.finalSnapshot?.outputs || {}, null, 2),
            "Output diffs: " + JSON.stringify(newResult.outputDiffs || [], null, 2),
            "Mem diffs: " + JSON.stringify(newResult.memDiffs || [], null, 2)
          ].join("\n\n");
        }
        testsFixModalApplyCE.disabled = false;
      } catch (e) {
        testsFixModalCEStatus.textContent = e?.message || "Request failed.";
        testsFixModalCEStatus.className = "testsFixModalEditStatus error";
        testsFixModalApplyCE.disabled = false;
      }
    });
  }

  updateEmptyState();

  btnExport.onclick = async () => {
    if (!lastRun?.results) return;
    try {
      const res = await fetch("/api/tests/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: lastRun.summary, results: lastRun.results })
      });
      const text = await res.text();
      if (!res.ok) {
        try {
          const j = JSON.parse(text);
          summary.textContent = "Export error: " + (j.error || text);
        } catch {
          summary.textContent = "Export error: " + text;
        }
        return;
      }
      const blob = new Blob([text], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fat_sat_results.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      summary.textContent = "Export error: " + (e?.message || e);
    }
  };
})();
