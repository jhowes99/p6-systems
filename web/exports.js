const elMsg = document.getElementById("msg");
const elPrev = document.getElementById("preview");
const elOutcome = document.getElementById("outcomeStatus");

function showBanner(type, message, detail) {
  if (window.UI && window.UI.setBanner) window.UI.setBanner(type, message, detail);
  else if (elMsg) elMsg.textContent = message;
}

// Update outcome display and empty state
async function updateOutcome() {
  const emptyEl = document.getElementById("emptyStateExports");
  const contentEl = document.getElementById("exportsContent");
  if (!elOutcome) return;

  try {
    const lastRes = await fetch("/api/project/last", { credentials: "include" });
    const last = await lastRes.json();
    const progRes = await fetch("/api/program");
    const prog = await progRes.json();
    const ir = prog?.ir;
    const hasProject = last && last.ok && last.project;
    const hasProgram = ir && ir.networks && ir.networks.length > 0;

    if (emptyEl && contentEl) {
      if (!hasProject && !hasProgram) {
        emptyEl.style.display = "block";
        contentEl.style.display = "none";
      } else {
        emptyEl.style.display = "none";
        contentEl.style.display = "block";
      }
    }

    if (!ir || !ir.networks || ir.networks.length === 0) {
      elOutcome.innerHTML = `
        <div style="padding: 12px; background: #fef3c7; border-radius: 8px; border: 1px solid #f59e0b;">
          <strong>No program uploaded</strong>
          <br><br>
          Build a program first:
          <ol style="margin: 8px 0 0 18px;">
            <li>Go to <strong>Import</strong> to load a P&ID bundle</li>
            <li>Or go to <strong>Build</strong> to create panel logic and upload</li>
          </ol>
        </div>
      `;
      return;
    }
    
    // Count devices and rungs
    const rungs = [];
    for (const net of ir.networks || []) {
      for (const rung of net.rungs || []) {
        rungs.push(rung);
      }
    }
    const ioMap = ir.ioMap || {};
    const inputs = Object.values(ioMap).filter(addr => String(addr).startsWith("I")).length;
    const outputs = Object.values(ioMap).filter(addr => String(addr).startsWith("Q")).length;
    const devices = Object.keys(ioMap).length;
    
    elOutcome.innerHTML = `
      <div style="padding: 12px; background: #d1fae5; border-radius: 8px; border: 1px solid #10b981;">
        <strong>✅ Program ready to deploy</strong>
        <div style="margin-top: 10px; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
          <div>
            <div style="font-size: 24px; font-weight: 900; color: #059669;">${rungs.length}</div>
            <div class="small">Rungs</div>
          </div>
          <div>
            <div style="font-size: 24px; font-weight: 900; color: #059669;">${devices}</div>
            <div class="small">Devices</div>
          </div>
          <div>
            <div style="font-size: 24px; font-weight: 900; color: #059669;">${inputs}</div>
            <div class="small">Inputs</div>
          </div>
          <div>
            <div style="font-size: 24px; font-weight: 900; color: #059669;">${outputs}</div>
            <div class="small">Outputs</div>
          </div>
        </div>
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(16,185,129,.3);">
          <div class="small">Program is uploaded and ready. Use <strong>Advanced: Export Formats</strong> below to download code for your PLC platform.</div>
        </div>
      </div>
    `;
  } catch (e) {
    elOutcome.innerHTML = `
      <div style="padding: 12px; background: #fee2e2; border-radius: 8px; border: 1px solid #ef4444;">
        <strong>Error checking program status</strong>
        <br><br>
        <div class="small">${(e && e.message) ? String(e.message).replace(/</g, "&lt;") : "Unknown error"}</div>
      </div>
    `;
  }
}

// Recent commissioning packets list
async function updateRecentPackets() {
  const listEl = document.getElementById("recentPacketsList");
  const noneEl = document.getElementById("recentPacketsNone");
  if (!listEl) return;
  try {
    const r = await fetch("/api/commissioning-packets", { credentials: "include" });
    const data = await r.json();
    const packets = (data.ok && data.packets) ? data.packets : [];
    listEl.innerHTML = "";
    if (noneEl) noneEl.style.display = packets.length ? "none" : "block";
    packets.forEach((p) => {
      const li = document.createElement("li");
      li.style.marginBottom = "6px";
      const date = p.createdAt ? new Date(p.createdAt).toLocaleString() : "—";
      const label = p.projectName || p.filename || p.id;
      const size = p.size != null ? (p.size < 1024 ? p.size + " B" : (p.size / 1024).toFixed(1) + " KB") : "";
      li.innerHTML = `<a href="/api/commissioning-packets/${encodeURIComponent(p.id)}/download" download="${(p.filename || "packet.zip").replace(/"/g, "&quot;")}" class="small" style="color: #0f172a;">${String(label).replace(/</g, "&lt;")}</a> <span class="small" style="color: #64748b;">${date}${size ? " · " + size : ""}</span>`;
      listEl.appendChild(li);
    });
  } catch (e) {
    if (noneEl) noneEl.textContent = "Could not load recent packets.";
    noneEl.style.display = "block";
  }
}

// Update outcome on load
updateOutcome();
updateRecentPackets();

function download(name, content, type) {
  const blob = new Blob([content], { type: type || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function fetchText(url) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  return t;
}

async function fetchJson(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.ok === false) throw new Error(j.error || "Export failed");
  return j;
}

document.getElementById("btnCodesys").onclick = async () => {
  try {
    const t = await fetchText("/api/export/codesys");
    elPrev.textContent = t;
    download("P6 Systems_codesys.st", t, "text/plain");
    elMsg.textContent = "Downloaded Codesys ST.";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};

document.getElementById("btnSiemens").onclick = async () => {
  try {
    const t = await fetchText("/api/export/siemens");
    elPrev.textContent = t;
    download("P6 Systems_siemens.scl", t, "text/plain");
    elMsg.textContent = "Downloaded Siemens SCL.";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};

document.getElementById("btnPython").onclick = async () => {
  try {
    const t = await fetchText("/api/export/python");
    elPrev.textContent = t;
    download("P6 Systems_program.py", t, "text/x-python");
    elMsg.textContent = "Downloaded Python export.";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};

document.getElementById("btnAB").onclick = async () => {
  try {
    const j = await fetchJson("/api/export/allen-bradley");
    elPrev.textContent = JSON.stringify(j, null, 2);
    for (const f of j.files || []) {
      download(f.name, f.content, f.contentType);
    }
    elMsg.textContent = "Downloaded AB placeholder CSVs (tags + rungs).";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};

document.getElementById("btnCommissioningPacket").onclick = async () => {
  try {
    const r = await fetch("/api/export/commissioning-packet", { credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showBanner("error", j.error || "Download failed.");
      return;
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "commissioning_packet.zip";
    a.click();
    URL.revokeObjectURL(a.href);
    showBanner("ok", "Commissioning packet downloaded. Project reset — you can import another.", "");
    if (elMsg) elMsg.textContent = "Downloaded Commissioning Packet. Project reset.";
    updateOutcome();
    updateRecentPackets();
  } catch (e) {
    showBanner("error", e?.message || "Download failed.");
    if (elMsg) elMsg.textContent = "Error: " + (e?.message || "Download failed.");
  }
};

document.getElementById("btnIOListCSV").onclick = async () => {
  try {
    const t = await fetchText("/api/export/io-list?format=csv");
    elPrev.textContent = t;
    download("P6 Systems_io_list.csv", t, "text/csv");
    elMsg.textContent = "Downloaded I/O List (CSV).";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; showBanner("error", e?.message); }
};

document.getElementById("btnIOListJSON").onclick = async () => {
  try {
    const j = await fetchJson("/api/export/io-list?format=json");
    elPrev.textContent = JSON.stringify(j, null, 2);
    download("P6 Systems_io_list.json", JSON.stringify(j, null, 2), "application/json");
    elMsg.textContent = "Downloaded I/O List (JSON).";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};

async function downloadCsvEndpoint(url, filename, description) {
  const r = await fetch(url);
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Export failed");
  }
  const t = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(t);
      throw new Error(j.error || t);
    } catch (err) {
      if (err.message) throw err;
      throw new Error(t);
    }
  }
  download(filename, t, "text/csv");
  elMsg.textContent = description;
}

document.getElementById("btnTerminalPlan").onclick = async () => {
  try {
    await downloadCsvEndpoint("/api/export/terminal-plan", "P6 Systems_terminal_plan.csv", "Downloaded Terminal Plan (CSV).");
    elPrev.textContent = "Terminal plan CSV downloaded.";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};
document.getElementById("btnWireSchedule").onclick = async () => {
  try {
    await downloadCsvEndpoint("/api/export/wire-schedule", "P6 Systems_wire_schedule.csv", "Downloaded Wire Schedule (CSV).");
    elPrev.textContent = "Wire schedule CSV downloaded.";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};
document.getElementById("btnIOCheckout").onclick = async () => {
  try {
    await downloadCsvEndpoint("/api/export/io-checkout", "P6 Systems_io_checkout.csv", "Downloaded I/O Checkout (CSV).");
    elPrev.textContent = "I/O checkout CSV downloaded.";
  } catch (e) { elMsg.textContent = `Error: ${e.message}`; }
};

