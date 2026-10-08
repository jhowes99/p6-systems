(function () {
  const scoreSection = document.getElementById("scoreSection");
  const scoreGauge = document.getElementById("scoreGauge");
  const scoreValue = document.getElementById("scoreValue");
  const statsRow = document.getElementById("statsRow");
  const errorsSection = document.getElementById("errorsSection");
  const errorsList = document.getElementById("errorsList");
  const warningsSection = document.getElementById("warningsSection");
  const warningsList = document.getElementById("warningsList");
  const noData = document.getElementById("noData");
  const demoViewBanner = document.getElementById("demoViewBanner");
  const demoViewBannerText = document.getElementById("demoViewBannerText");
  const btnShowFullValidation = document.getElementById("btnShowFullValidation");
  const validationDemoTrigger = document.getElementById("validationDemoTrigger");
  const validationDemo100Trigger = document.getElementById("validationDemo100Trigger");

  /** Last full validation result from API (used for demo + restore). */
  let lastFullResult = null;
  /** 'subset' | '100' | null. When set, UI shows a demo view instead of full results. */
  let demoMode = null;

  /** In-tool fix steps only (no "go back" or re-import). */
  const FIX_GUIDE = {
    tag_missing_in_io: {
      title: "Tag missing in IO list",
      steps: [
        "Use the Fix here (IO List) section below to add this tag with the correct IO type.",
        "Then click Apply & re-validate. The finding will be resolved in the tool."
      ]
    },
    duplicate_io_type: {
      title: "Duplicate tag with different IO type",
      steps: [
        "Use the Fix here (IO List) section below to set the correct type for this tag.",
        "Click Apply & re-validate to resolve."
      ]
    },
    effect_should_be_output: {
      title: "Effect should be an output",
      steps: [
        "Use the Fix here (IO List) section below and set IO type to DO or AO.",
        "Click Apply & re-validate to resolve."
      ]
    },
    cause_should_be_input: {
      title: "Cause should be an input",
      steps: [
        "Use the Fix here (IO List) section below and set IO type to DI or AI.",
        "Click Apply & re-validate to resolve."
      ]
    },
    multiple_rules_same_effect: {
      title: "Multiple rules write to same effect",
      steps: [
        "If this is intentional (e.g. redundant logic), use Accept as exception below.",
        "Otherwise, use the tool to review which rule should control this output and accept the one that applies."
      ]
    },
    orphan_io: {
      title: "Tag in IO list but not in Cause&Effect",
      steps: [
        "If this tag is intentionally unused for now, use Accept as exception below.",
        "It will no longer count against your score."
      ]
    },
    near_duplicate_tag: {
      title: "Possible duplicate tag",
      steps: [
        "If the two tags are intentionally different, use Accept as exception below.",
        "Otherwise, fix the tag spelling in the Fix here (IO List) section if one is wrong."
      ]
    },
    safety_tag_not_in_io: {
      title: "Safety tag should be in IO list",
      steps: [
        "Use the Fix here (IO List) section below to add this tag as DI.",
        "Click Apply & re-validate to resolve."
      ]
    },
    safety_should_be_di: {
      title: "Safety tag should be DI",
      steps: [
        "Use the Fix here (IO List) section below and set IO type to DI.",
        "Click Apply & re-validate to resolve."
      ]
    }
  };

  /** Rules that support in-tool IO edit (add/update one IO entry). */
  const IO_EDIT_RULES = ["tag_missing_in_io", "duplicate_io_type", "effect_should_be_output", "cause_should_be_input", "safety_tag_not_in_io", "safety_should_be_di"];
  /** Current finding when modal is open (for Accept as exception). */
  let lastFixGuideItem = null;

  function getFixGuide(rule) {
    return FIX_GUIDE[rule] || {
      title: rule || "Finding",
      steps: [
        "Use the options below to fix here in the tool or accept as exception.",
        "Validation will update automatically."
      ]
    };
  }

  /** Re-run validation with current project and refresh UI. */
  async function reRunValidation() {
    const lastRes = await fetch("/api/project/last", { credentials: "include" });
    const last = await lastRes.json();
    if (!last.ok || !last.project) return null;
    const body = {
      pidElements: {},
      ioListEntries: last.project.ioEntries || [],
      causeEffectRules: last.project.causeEffectRules || []
    };
    const res = await fetch("/api/project/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok && data) {
      lastFullResult = data;
      demoMode = null;
      showResult(data);
    }
    return data;
  }

  function openFixGuide(item, isError) {
    const modal = document.getElementById("validationFixModal");
    const titleEl = document.getElementById("validationFixModalTitle");
    const messageEl = document.getElementById("validationFixModalMessage");
    const stepsEl = document.getElementById("validationFixModalSteps");
    const editEl = document.getElementById("validationFixModalEdit");
    const exceptionEl = document.getElementById("validationFixModalException");
    const tagInput = document.getElementById("validationFixModalTag");
    const ioTypeSelect = document.getElementById("validationFixModalIoType");
    const editStatus = document.getElementById("validationFixModalEditStatus");
    const passcodeInput = document.getElementById("validationFixModalPasscode");
    const exceptionStatus = document.getElementById("validationFixModalExceptionStatus");
    if (!modal || !titleEl || !messageEl || !stepsEl) return;
    const rule = item.rule || (isError ? "error" : "warning");
    const guide = getFixGuide(rule);
    titleEl.textContent = guide.title;
    messageEl.textContent = item.message || "";
    stepsEl.innerHTML = (guide.steps || []).map((s) => "<li>" + escapeHtml(s) + "</li>").join("");
    const canEditIo = IO_EDIT_RULES.includes(rule);
    if (editEl) editEl.style.display = canEditIo ? "block" : "none";
    if (exceptionEl) exceptionEl.style.display = !canEditIo ? "block" : "none";
    if (tagInput) {
      tagInput.value = item.tag != null ? String(item.tag) : "";
      tagInput.placeholder = rule === "tag_missing_in_io" ? "e.g. C-001" : "";
    }
    if (ioTypeSelect) {
      if (rule === "effect_should_be_output") { ioTypeSelect.value = "DO"; }
      else if (rule === "cause_should_be_input") { ioTypeSelect.value = "DI"; }
      else if (rule === "safety_tag_not_in_io" || rule === "safety_should_be_di") { ioTypeSelect.value = "DI"; }
      else { ioTypeSelect.value = "DI"; }
    }
    if (editStatus) { editStatus.style.display = "none"; editStatus.textContent = ""; editStatus.className = "validationFixModalEditStatus"; }
    if (passcodeInput) { passcodeInput.value = ""; passcodeInput.placeholder = "Admin passcode (if required)"; }
    const acceptedByInput = document.getElementById("validationFixModalAcceptedBy");
    if (acceptedByInput) { acceptedByInput.value = ""; acceptedByInput.placeholder = "e.g. Jane Smith"; }
    if (exceptionStatus) { exceptionStatus.style.display = "none"; exceptionStatus.textContent = ""; exceptionStatus.className = "validationFixModalEditStatus"; }
    lastFixGuideItem = { rule, tag: item.tag != null ? String(item.tag) : null };
    modal.setAttribute("aria-hidden", "false");
    modal.style.display = "flex";
  }

  function closeFixModal() {
    const modal = document.getElementById("validationFixModal");
    if (modal) {
      modal.setAttribute("aria-hidden", "true");
      modal.style.display = "none";
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  /** Build a demo subset: first N errors, first M warnings, recalc score. */
  function toDemoSubset(full) {
    const maxErrors = 2;
    const maxWarnings = 4;
    const errs = (full.errors || []).slice(0, maxErrors);
    const warns = (full.warnings || []).slice(0, maxWarnings);
    const score = Math.max(0, Math.min(100, 100 - 10 * errs.length - 2 * warns.length));
    const stats = { ...(full.stats || {}), ioCount: full.stats?.ioCount ?? 0, ceRules: full.stats?.ceRules ?? 0, errorCount: errs.length, warningCount: warns.length };
    return { ...full, errors: errs, warnings: warns, score, stats };
  }

  /** Build a 100% pass view for demos: score 100, no errors, no warnings. */
  function toDemo100(full) {
    const stats = { ...(full.stats || {}), ioCount: full.stats?.ioCount ?? 0, ceRules: full.stats?.ceRules ?? 0, errorCount: 0, warningCount: 0 };
    return { ...full, score: 100, errors: [], warnings: [], stats };
  }

  function showResult(validation) {
    if (!validation) {
      noData.style.display = "block";
      scoreSection.style.display = "none";
      errorsSection.style.display = "none";
      warningsSection.style.display = "none";
      if (demoViewBanner) demoViewBanner.style.display = "none";
      demoMode = null;
      loadExceptions();
      return;
    }
    noData.style.display = "none";
    scoreSection.style.display = "flex";
    const score = Number(validation.score);
    scoreValue.textContent = score;
    scoreGauge.className = "scoreGauge " + (score >= 80 ? "good" : score >= 50 ? "warn" : "bad");
    const stats = validation.stats || {};
    statsRow.innerHTML = `
      <span>IO: ${stats.ioCount ?? 0}</span>
      <span>C&E rules: ${stats.ceRules ?? 0}</span>
      <span>Errors: ${stats.errorCount ?? validation.errors?.length ?? 0}</span>
      <span>Warnings: ${stats.warningCount ?? validation.warnings?.length ?? 0}</span>
    `;

    const errs = validation.errors || [];
    if (errs.length) {
      errorsSection.style.display = "block";
      errorsList.innerHTML = errs.map((e, i) => {
        const rule = e.rule || "error";
        const tag = e.tag != null ? String(e.tag) : "";
        const msg = escapeHtml(e.message || "");
        return `<li class="validationFindingRow" data-index="${i}" data-rule="${escapeHtml(rule)}" data-tag="${escapeHtml(tag)}" title="Click for how to fix">
          <input type="checkbox" class="findingCheckbox" data-rule="${escapeHtml(rule)}" data-tag="${escapeHtml(tag)}" aria-label="Select for exception" />
          <span class="findingText"><strong>${escapeHtml(rule)}</strong>: ${msg}</span>
        </li>`;
      }).join("");
      errorsList.querySelectorAll("li").forEach((li, i) => {
        const cb = li.querySelector(".findingCheckbox");
        if (cb) {
          cb.addEventListener("click", (e) => e.stopPropagation());
          cb.addEventListener("change", updateBulkBar);
        }
        li.querySelector(".findingText").addEventListener("click", () => openFixGuide(errs[i], true));
      });
    } else {
      errorsSection.style.display = "none";
    }

    const warns = validation.warnings || [];
    if (warns.length) {
      warningsSection.style.display = "block";
      warningsList.innerHTML = warns.map((w, i) => {
        const rule = w.rule || "warning";
        const tag = w.tag != null ? String(w.tag) : "";
        const msg = escapeHtml(w.message || "");
        return `<li class="validationFindingRow" data-index="${i}" data-rule="${escapeHtml(rule)}" data-tag="${escapeHtml(tag)}" title="Click for how to fix">
          <input type="checkbox" class="findingCheckbox" data-rule="${escapeHtml(rule)}" data-tag="${escapeHtml(tag)}" aria-label="Select for exception" />
          <span class="findingText"><strong>${escapeHtml(rule)}</strong>: ${msg}</span>
        </li>`;
      }).join("");
      warningsList.querySelectorAll("li").forEach((li, i) => {
        const cb = li.querySelector(".findingCheckbox");
        if (cb) {
          cb.addEventListener("click", (e) => e.stopPropagation());
          cb.addEventListener("change", updateBulkBar);
        }
        li.querySelector(".findingText").addEventListener("click", () => openFixGuide(warns[i], false));
      });
    } else {
      warningsSection.style.display = "none";
    }
    updateBulkBar();
    loadExceptions();
  }

  function getSelectedFindings() {
    const items = [];
    document.querySelectorAll(".findingCheckbox:checked").forEach((cb) => {
      const rule = cb.getAttribute("data-rule") || "";
      const tag = cb.getAttribute("data-tag") || "";
      if (rule) items.push({ rule, tag: tag || undefined });
    });
    return items;
  }

  function updateBulkBar() {
    const bar = document.getElementById("bulkExceptionBar");
    const countEl = document.getElementById("bulkExceptionCount");
    const passcodeEl = document.getElementById("bulkExceptionPasscode");
    if (!bar || !countEl) return;
    const items = getSelectedFindings();
    if (items.length === 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "block";
    countEl.textContent = items.length + " selected";
    if (passcodeEl) {
      fetch("/api/project/validation-exceptions/requires-passcode", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.ok && d.requiresPasscode) passcodeEl.style.display = "inline-block"; else passcodeEl.style.display = "none"; })
        .catch(() => { passcodeEl.style.display = "none"; });
    }
  }

  function clearBulkSelection() {
    document.querySelectorAll(".findingCheckbox:checked").forEach((cb) => { cb.checked = false; });
    updateBulkBar();
  }

  async function loadExceptions() {
    const section = document.getElementById("exceptionsSection");
    const listEl = document.getElementById("exceptionsList");
    if (!section || !listEl) return;
    try {
      const res = await fetch("/api/project/validation-exceptions", { credentials: "include" });
      const data = await res.json();
      const list = (data.ok && data.exceptions) ? data.exceptions : [];
      if (list.length === 0) {
        section.style.display = "none";
        return;
      }
      section.style.display = "block";
      listEl.innerHTML = list.map((ex) => {
        const label = ex.tag ? escapeHtml(ex.rule + " — " + ex.tag) : escapeHtml(ex.rule);
        const by = ex.acceptedBy ? " by " + escapeHtml(ex.acceptedBy) : "";
        const at = ex.acceptedAt ? " " + escapeHtml(ex.acceptedAt.slice(0, 10)) : "";
        return "<li><span>" + label + by + at + "</span> <button type=\"button\" class=\"btn-small linkLike\" data-remove-id=\"" + escapeHtml(ex.id) + "\">Remove</button></li>";
      }).join("");
      listEl.querySelectorAll("[data-remove-id]").forEach((btn) => {
        btn.addEventListener("click", () => removeException(btn.getAttribute("data-remove-id")));
      });
    } catch (e) {
      section.style.display = "none";
    }
  }

  async function removeException(id) {
    const removedBy = window.prompt("Your name (for audit trail):") || "";
    const passcodeRes = await fetch("/api/project/validation-exceptions/requires-passcode", { credentials: "include" });
    const passcodeData = await passcodeRes.json();
    let adminPasscode = "";
    if (passcodeData.ok && passcodeData.requiresPasscode) {
      adminPasscode = window.prompt("Admin passcode required to remove exception:") || "";
    }
    try {
      const res = await fetch("/api/project/validation-exceptions/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPasscode, removedBy: removedBy.trim() || undefined }),
        credentials: "include"
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        await reRunValidation();
        loadExceptions();
      } else if (window.UI && window.UI.setBanner) window.UI.setBanner("error", data.error || "Remove failed.");
    } catch (e) {
      if (window.UI && window.UI.setBanner) window.UI.setBanner("error", e?.message || "Request failed.");
    }
  }

  let validating = false;
  const btnValidateLast = document.getElementById("btnValidateLast");
  if (btnValidateLast) {
    btnValidateLast.onclick = async () => {
      if (validating) return;
      validating = true;
      btnValidateLast.disabled = true;
      try {
      const lastRes = await fetch("/api/project/last");
      const last = await lastRes.json();
      if (!last.ok || !last.project) {
        showResult(null);
        validating = false;
        btnValidateLast.disabled = false;
        return;
      }
      const body = {
        pidElements: {},
        ioListEntries: last.project.ioEntries || [],
        causeEffectRules: last.project.causeEffectRules || []
      };
      const res = await fetch("/api/project/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        showResult({
          ok: false,
          score: 0,
          errors: [{ message: "Server returned non-JSON (status " + res.status + "). Check console/network." }],
          warnings: [],
          stats: {}
        });
        validating = false;
        btnValidateLast.disabled = false;
        return;
      }
      if (!res.ok || !data.ok) {
        const errMsg = data.error || "Validation request failed (status " + res.status + ")";
        showResult({ ok: false, score: 0, errors: [{ message: errMsg }], warnings: [], stats: {} });
        validating = false;
        btnValidateLast.disabled = false;
        return;
      }
      lastFullResult = data;
      demoMode = null;
      if (demoViewBanner) demoViewBanner.style.display = "none";
      showResult(data);
    } catch (e) {
      const msg = e?.message || String(e);
      showResult({
        ok: false,
        score: 0,
        errors: [{ message: msg.includes("fetch") ? "Network error: is the server running? " + msg : msg }],
        warnings: [],
        stats: {}
      });
    } finally {
      validating = false;
      btnValidateLast.disabled = false;
    }
  };
  }

  const btnApplyAutoFixes = document.getElementById("btnApplyAutoFixes");
  if (btnApplyAutoFixes) {
    btnApplyAutoFixes.onclick = async () => {
      if (validating) return;
      validating = true;
      btnApplyAutoFixes.disabled = true;
      try {
        const lastRes = await fetch("/api/project/last", { credentials: "include" });
        const last = await lastRes.json();
        if (!last.ok || !last.project) {
          if (window.UI && window.UI.setBanner) window.UI.setBanner("warn", "No project loaded. Import a bundle first.");
          validating = false;
          btnApplyAutoFixes.disabled = false;
          return;
        }
        const res = await fetch("/api/project/apply-auto-fixes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          credentials: "include"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (window.UI && window.UI.setBanner) window.UI.setBanner("error", data.error || "Apply auto-fixes failed.");
          validating = false;
          btnApplyAutoFixes.disabled = false;
          return;
        }
        const applied = data.applied || {};
        const added = (applied.tag_missing_in_io || []).length;
        const merged = (applied.multiple_rules_same_effect || []).length;
        lastFullResult = data.validation;
        demoMode = null;
        showResult(data.validation);
        if (window.UI && window.UI.setBanner && (added || merged)) {
          window.UI.setBanner("ok", "Auto-fixes applied: " + (added ? added + " tag(s) added to IO list" : "") + (added && merged ? "; " : "") + (merged ? merged + " effect(s) merged from multiple rules" : "") + ".");
        }
      } catch (e) {
        if (window.UI && window.UI.setBanner) window.UI.setBanner("error", e?.message || "Request failed.");
      } finally {
        validating = false;
        btnApplyAutoFixes.disabled = false;
      }
    };
  }

  function applyDemoView() {
    if (!lastFullResult || !(lastFullResult.errors?.length || lastFullResult.warnings?.length)) return;
    demoMode = "subset";
    showResult(toDemoSubset(lastFullResult));
    if (demoViewBanner) {
      demoViewBanner.style.display = "block";
      if (demoViewBannerText) demoViewBannerText.textContent = "Demo view: showing a subset of findings.";
    }
  }

  function applyDemoView100() {
    if (!lastFullResult) return;
    demoMode = "100";
    showResult(toDemo100(lastFullResult));
    if (demoViewBanner) {
      demoViewBanner.style.display = "block";
      if (demoViewBannerText) demoViewBannerText.textContent = "Demo view: showing 100% for presentation.";
    }
  }

  function restoreFullView() {
    demoMode = null;
    if (demoViewBanner) demoViewBanner.style.display = "none";
    if (lastFullResult) showResult(lastFullResult);
  }

  if (validationDemoTrigger) {
    validationDemoTrigger.addEventListener("click", function () {
      if (demoMode === "subset") restoreFullView();
      else applyDemoView();
    });
  }
  if (validationDemo100Trigger) {
    validationDemo100Trigger.addEventListener("click", function () {
      if (demoMode === "100") restoreFullView();
      else applyDemoView100();
    });
  }
  if (btnShowFullValidation) {
    btnShowFullValidation.addEventListener("click", restoreFullView);
  }

  const fixModalClose = document.getElementById("validationFixModalClose");
  const fixModalBackdrop = document.querySelector(".validationFixModalBackdrop");
  const fixModalApply = document.getElementById("validationFixModalApply");
  const fixModalTag = document.getElementById("validationFixModalTag");
  const fixModalIoType = document.getElementById("validationFixModalIoType");
  const fixModalEditStatus = document.getElementById("validationFixModalEditStatus");
  if (fixModalClose) fixModalClose.addEventListener("click", closeFixModal);
  if (fixModalBackdrop) fixModalBackdrop.addEventListener("click", closeFixModal);
  const fixModalAcceptException = document.getElementById("validationFixModalAcceptException");
  const fixModalPasscode = document.getElementById("validationFixModalPasscode");
  const fixModalAcceptedBy = document.getElementById("validationFixModalAcceptedBy");
  const fixModalExceptionStatus = document.getElementById("validationFixModalExceptionStatus");
  if (fixModalAcceptException && fixModalExceptionStatus) {
    fixModalAcceptException.addEventListener("click", async () => {
      if (!lastFixGuideItem) return;
      const acceptedBy = (fixModalAcceptedBy && fixModalAcceptedBy.value) ? fixModalAcceptedBy.value.trim() : "";
      if (!acceptedBy) {
        fixModalExceptionStatus.style.display = "block";
        fixModalExceptionStatus.textContent = "Your name is required for traceability.";
        fixModalExceptionStatus.className = "validationFixModalEditStatus error";
        return;
      }
      const adminPasscode = (fixModalPasscode && fixModalPasscode.value) ? fixModalPasscode.value : "";
      fixModalAcceptException.disabled = true;
      fixModalExceptionStatus.style.display = "block";
      fixModalExceptionStatus.textContent = "Adding exception…";
      fixModalExceptionStatus.className = "validationFixModalEditStatus";
      try {
        const res = await fetch("/api/project/validation-exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rule: lastFixGuideItem.rule,
            tag: lastFixGuideItem.tag || undefined,
            acceptedBy,
            adminPasscode: adminPasscode || undefined
          }),
          credentials: "include"
        });
        const data = await res.json();
        if (!res.ok) {
          fixModalExceptionStatus.textContent = data.error || "Failed.";
          fixModalExceptionStatus.className = "validationFixModalEditStatus error";
          if (data.requiresPasscode) fixModalExceptionStatus.textContent = "Admin passcode required.";
          fixModalAcceptException.disabled = false;
          return;
        }
        const updated = await reRunValidation();
        fixModalExceptionStatus.textContent = "Accepted as exception. Validation updated. Score: " + (updated?.score ?? "—");
        fixModalExceptionStatus.className = "validationFixModalEditStatus ok";
        fixModalAcceptException.disabled = false;
      } catch (e) {
        fixModalExceptionStatus.textContent = e?.message || "Request failed.";
        fixModalExceptionStatus.className = "validationFixModalEditStatus error";
        fixModalAcceptException.disabled = false;
      }
    });
  }

  if (fixModalApply && fixModalTag && fixModalIoType && fixModalEditStatus) {
    fixModalApply.addEventListener("click", async () => {
      const tag = (fixModalTag.value || "").trim();
      const ioType = (fixModalIoType.value || "DI").toUpperCase();
      if (!tag) {
        fixModalEditStatus.textContent = "Enter a tag.";
        fixModalEditStatus.className = "validationFixModalEditStatus error";
        fixModalEditStatus.style.display = "block";
        return;
      }
      fixModalApply.disabled = true;
      fixModalEditStatus.style.display = "block";
      fixModalEditStatus.textContent = "Applying…";
      fixModalEditStatus.className = "validationFixModalEditStatus";
      try {
        const res = await fetch("/api/project/io-entry", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag, ioType }),
          credentials: "include"
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          fixModalEditStatus.textContent = data.error || "Update failed.";
          fixModalEditStatus.className = "validationFixModalEditStatus error";
          fixModalApply.disabled = false;
          return;
        }
        const updated = await reRunValidation();
        fixModalEditStatus.textContent = updated ? "Updated. Validation re-run. Score: " + (updated.score ?? "—") : "Updated. Re-run validation to refresh.";
        fixModalEditStatus.className = "validationFixModalEditStatus ok";
        fixModalApply.disabled = false;
      } catch (e) {
        fixModalEditStatus.textContent = e?.message || "Request failed.";
        fixModalEditStatus.className = "validationFixModalEditStatus error";
        fixModalApply.disabled = false;
      }
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeFixModal();
  });

  const selectAllErrors = document.getElementById("selectAllErrors");
  const selectAllWarnings = document.getElementById("selectAllWarnings");
  const bulkExceptionBar = document.getElementById("bulkExceptionBar");
  const bulkExceptionAcceptedBy = document.getElementById("bulkExceptionAcceptedBy");
  const bulkExceptionPasscode = document.getElementById("bulkExceptionPasscode");
  const bulkExceptionAccept = document.getElementById("bulkExceptionAccept");
  const bulkExceptionClear = document.getElementById("bulkExceptionClear");
  const bulkExceptionStatus = document.getElementById("bulkExceptionStatus");

  if (selectAllErrors) {
    selectAllErrors.addEventListener("click", () => {
      const el = document.getElementById("errorsList");
      if (el) el.querySelectorAll(".findingCheckbox").forEach((cb) => { cb.checked = true; });
      updateBulkBar();
    });
  }
  if (selectAllWarnings) {
    selectAllWarnings.addEventListener("click", () => {
      const el = document.getElementById("warningsList");
      if (el) el.querySelectorAll(".findingCheckbox").forEach((cb) => { cb.checked = true; });
      updateBulkBar();
    });
  }
  if (bulkExceptionClear) bulkExceptionClear.addEventListener("click", clearBulkSelection);

  if (bulkExceptionAccept && bulkExceptionAcceptedBy && bulkExceptionStatus) {
    bulkExceptionAccept.addEventListener("click", async () => {
      const items = getSelectedFindings();
      if (!items.length) return;
      const acceptedBy = (bulkExceptionAcceptedBy.value || "").trim();
      if (!acceptedBy) {
        bulkExceptionStatus.style.display = "block";
        bulkExceptionStatus.textContent = "Your name is required for traceability.";
        bulkExceptionStatus.className = "bulkExceptionStatus error";
        return;
      }
      const adminPasscode = (bulkExceptionPasscode && bulkExceptionPasscode.value) ? bulkExceptionPasscode.value : "";
      bulkExceptionAccept.disabled = true;
      bulkExceptionStatus.style.display = "block";
      bulkExceptionStatus.textContent = "Adding exceptions…";
      bulkExceptionStatus.className = "bulkExceptionStatus";
      try {
        const res = await fetch("/api/project/validation-exceptions/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acceptedBy, adminPasscode: adminPasscode || undefined, items }),
          credentials: "include"
        });
        const data = await res.json();
        if (!res.ok) {
          bulkExceptionStatus.textContent = data.error || "Failed.";
          bulkExceptionStatus.className = "bulkExceptionStatus error";
          bulkExceptionAccept.disabled = false;
          return;
        }
        await reRunValidation();
        clearBulkSelection();
        bulkExceptionStatus.textContent = data.count + " exception(s) accepted. Validation updated.";
        bulkExceptionStatus.className = "bulkExceptionStatus ok";
        bulkExceptionAccept.disabled = false;
      } catch (e) {
        bulkExceptionStatus.textContent = e?.message || "Request failed.";
        bulkExceptionStatus.className = "bulkExceptionStatus error";
        bulkExceptionAccept.disabled = false;
      }
    });
  }

  // Triple-click on score area: cycle full → subset → 100% → full
  let scoreClickCount = 0;
  let scoreClickTimer = null;
  if (scoreSection) {
    scoreSection.addEventListener("click", function () {
      scoreClickCount++;
      clearTimeout(scoreClickTimer);
      scoreClickTimer = setTimeout(function () { scoreClickCount = 0; }, 400);
      if (scoreClickCount >= 3) {
        scoreClickCount = 0;
        if (demoMode === null) applyDemoView();
        else if (demoMode === "subset") applyDemoView100();
        else restoreFullView();
      }
    });
  }

  showResult(null);
})();
