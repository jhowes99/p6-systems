(function () {
  const snapshotLabel = document.getElementById("snapshotLabel");
  const btnCreate = document.getElementById("btnCreate");
  const snapshotList = document.getElementById("snapshotList");
  const diffA = document.getElementById("diffA");
  const diffB = document.getElementById("diffB");
  const btnDiff = document.getElementById("btnDiff");
  const diffResult = document.getElementById("diffResult");

  function setBanner(type, message) {
    if (window.UI && window.UI.setBanner) window.UI.setBanner(type, message, "");
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  async function loadSnapshots() {
    const r = await fetch("/api/snapshots");
    const data = await r.json();
    const list = data.ok ? data.snapshots || [] : [];
    snapshotList.innerHTML = list.map((s) => `<li><span>${esc(s.id)}</span> <span class="small">${esc(s.createdAt || "")}</span></li>`).join("") || "<li class=\"small\">No snapshots yet.</li>";

    const opts = list.map((s) => `<option value="${esc(s.id)}">${esc(s.id)}</option>`).join("");
    diffA.innerHTML = "<option value=\"\">— select —</option>" + opts;
    diffB.innerHTML = "<option value=\"\">— select —</option>" + opts;
  }

  async function updateEmptyState() {
    const emptyEl = document.getElementById("emptyStateVersions");
    const contentEl = document.getElementById("versionsContent");
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

  btnCreate.onclick = async () => {
    try {
      const label = snapshotLabel.value.trim() || "snapshot";
      const r = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label })
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setBanner("error", data.error || "Create failed");
        return;
      }
      snapshotLabel.value = "";
      setBanner("ok", "Snapshot created.");
      loadSnapshots();
    } catch (e) {
      setBanner("error", e?.message || "Error");
    }
  };

  btnDiff.onclick = async () => {
    const idA = diffA.value;
    const idB = diffB.value;
    if (!idA || !idB) {
      diffResult.style.display = "block";
      diffResult.innerHTML = "<p>Select both snapshots.</p>";
      return;
    }
    if (idA === idB) {
      diffResult.style.display = "block";
      diffResult.innerHTML = "<p>Select two different snapshots.</p>";
      return;
    }
    try {
      const r = await fetch(`/api/snapshots/diff?idA=${encodeURIComponent(idA)}&idB=${encodeURIComponent(idB)}`);
      const data = await r.json();
      if (!r.ok || !data.ok) {
        diffResult.style.display = "block";
        diffResult.innerHTML = "<p>" + esc(data.error || "Diff failed") + "</p>";
        return;
      }
      const d = data.diff;
      diffResult.style.display = "block";
      diffResult.innerHTML = `
        <h4>Summary</h4>
        <p>Tags added: ${d.tagsAdded?.length ?? 0}. Removed: ${d.tagsRemoved?.length ?? 0}. Changed: ${d.tagsChanged?.length ?? 0}.</p>
        <p>C&E rules added: ${d.ceAdded ?? 0}. Removed: ${d.ceRemoved ?? 0}.</p>
        <p>IR A: ${d.irStatsA?.networks ?? 0} networks, ${d.irStatsA?.rungs ?? 0} rungs. IR B: ${d.irStatsB?.networks ?? 0} networks, ${d.irStatsB?.rungs ?? 0} rungs.</p>
        ${(d.tagsAdded?.length || d.tagsRemoved?.length) ? `<h4>Tags added</h4><ul>${(d.tagsAdded || []).map((t) => "<li>" + esc(t) + "</li>").join("")}</ul><h4>Tags removed</h4><ul>${(d.tagsRemoved || []).map((t) => "<li>" + esc(t) + "</li>").join("")}</ul>` : ""}
      `;
    } catch (e) {
      diffResult.style.display = "block";
      diffResult.innerHTML = "<p>" + esc(e?.message || "Error") + "</p>";
    }
  };

  updateEmptyState();
  loadSnapshots();
})();
