const elScanInfo = document.getElementById("scanInfo");
const elStatus = document.getElementById("status");
const elSummary = document.getElementById("summary");
const elWarnings = document.getElementById("warnings");
const elIoMap = document.getElementById("ioMap");
const elIrPreview = document.getElementById("irPreview");

const ioFile = document.getElementById("ioFile");
const ceFile = document.getElementById("ceFile");
const btnGenerate = document.getElementById("btnGenerate");
const btnUpload = document.getElementById("btnUpload");

let lastGenerated = null; // { ir, ioMap, warnings, model }

async function apiState() {
  const r = await fetch("/api/state");
  return r.json();
}
async function apiProjectImport(formData) {
  const r = await fetch("/api/project/import", { method: "POST", body: formData });
  return r.json();
}
async function apiUpload(ir) {
  const r = await fetch("/api/program", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir })
  });
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

function setStatus(kind, html) {
  const cls =
    kind === "ok" ? "status success" :
    kind === "warn" ? "status warning" :
    kind === "err" ? "status error" :
    "status info";
  elStatus.className = cls;
  elStatus.innerHTML = html;
}

function renderResult(r) {
  lastGenerated = r;
  btnUpload.disabled = !r?.ir;

  const model = r.model || {};
  const ioCount = model.io?.count ?? 0;
  const ceCount = model.causeEffect?.count ?? 0;
  const pidCounts = model.pid?.counts || {};
  const pidTotal =
    (pidCounts.instruments || 0) +
    (pidCounts.valves || 0) +
    (pidCounts.pumps || 0) +
    (pidCounts.controlLoops || 0) +
    (pidCounts.equipment || 0);

  elSummary.innerHTML = `
    <div><strong>Parsed:</strong></div>
    <ul style="margin:8px 0 0 18px;">
      <li>I/O entries: <strong>${escapeHtml(String(ioCount))}</strong></li>
      <li>Cause &amp; Effect rules: <strong>${escapeHtml(String(ceCount))}</strong></li>
      <li>P&amp;ID elements (optional): <strong>${escapeHtml(String(pidTotal))}</strong></li>
    </ul>
  `;

  const ws = r.warnings || [];
  elWarnings.innerHTML = ws.length
    ? `<ul style="margin:0 0 0 18px;">${ws.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
    : `<div class="small">No warnings.</div>`;

  elIoMap.textContent = JSON.stringify(r.ioMap || {}, null, 2);
  elIrPreview.textContent = JSON.stringify(r.ir || {}, null, 2);
}

btnGenerate?.addEventListener("click", async () => {
  try {
    setStatus("info", "Generating…");
    btnUpload.disabled = true;
    lastGenerated = null;

    const fd = new FormData();
    const io = ioFile?.files?.[0];
    const ce = ceFile?.files?.[0];
    if (io) fd.append("io", io);
    if (ce) fd.append("causeEffect", ce);

    // We intentionally do NOT require a P&ID here. Backend will proceed with warnings.
    const r = await apiProjectImport(fd);
    if (!r.ok) {
      setStatus("err", `<strong>Error:</strong> ${escapeHtml(r.error || "Import failed")}`);
      return;
    }
    setStatus("ok", `Generated. ${r.warnings?.length ? "See warnings below." : ""}`);
    renderResult(r);
  } catch (e) {
    setStatus("err", `<strong>Error:</strong> ${escapeHtml(String(e?.message || e))}`);
  }
});

btnUpload?.addEventListener("click", async () => {
  try {
    if (!lastGenerated?.ir) {
      setStatus("err", "Nothing to upload yet. Generate first.");
      return;
    }
    setStatus("info", "Uploading to runtime…");
    const r = await apiUpload(lastGenerated.ir);
    if (!r.ok) {
      setStatus("err", `<strong>Upload failed:</strong> ${escapeHtml(r.error || "Unknown error")}`);
      return;
    }
    setStatus("ok", `Uploaded. Open <a href="/monitor.html">Monitor</a> or <a href="/interlocks.html">Interlocks</a>.`);
  } catch (e) {
    setStatus("err", `<strong>Error:</strong> ${escapeHtml(String(e?.message || e))}`);
  }
});

async function loop() {
  try {
    const s = await apiState();
    const st = s.scanStats || {};
    const phases = st?.phases?.last;
    elScanInfo.textContent =
      st && typeof st.lastMs === "number"
        ? `PLC ${s.running ? "RUN" : "STOP"}${s.lastError ? " · FAULT" : ""} · last ${fmtMs(st.lastMs)}ms${phases ? ` · phases ${fmtMs(phases.inputMs)}/${fmtMs(phases.logicMs)}/${fmtMs(phases.housekeepingMs)}ms` : ""}`
        : "";
  } catch {
    // ignore
  } finally {
    setTimeout(loop, 600);
  }
}
loop();

