const API = {
  importPID: async (formData) => {
    const res = await fetch("/api/pid/import", {
      method: "POST",
      body: formData
    });
    return res.json();
  },
  importPIDFromText: async (text) => {
    const res = await fetch("/api/pid/import-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    return res.json();
  },
  importAndUpload: async (formData) => {
    const res = await fetch("/api/pid/import-and-upload", {
      method: "POST",
      body: formData
    });
    return res.json();
  },
  importTextAndUpload: async (text) => {
    const res = await fetch("/api/pid/import-text-and-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    return res.json();
  },
  importProjectBundle: async (formData) => {
    const res = await fetch("/api/project/import", {
      method: "POST",
      body: formData
    });
    return res.json();
  },
  exportST: () => fetch("/api/program/st").then(r => r.text()),
  generateNarrative: async (formData) => {
    const res = await fetch("/api/narrative/generate", { method: "POST", body: formData });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) {
        return { ok: false, serverDown: true, error: "Start the Axiom Verify server and open this page from it." };
      }
      return { ok: false, error: (text && text.slice(0, 200)) || "Generation failed." };
    }
    return res.json();
  }
};

// Tab switching
function switchTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const content = document.getElementById(`tab-${tabName}`);
  if (!tab || !content) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  tab.classList.add("active");
  content.classList.add("active");
}
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});
// Open narrative tab when arriving via pid_import.html#narrative (e.g. from header "Logic to Control Narrative")
if (document.location.hash === "#narrative") switchTab("narrative");

// Bundle import
const bundleStatus = document.getElementById("bundleStatus");
document.getElementById("btnBundleImport")?.addEventListener("click", async () => {
  try {
    bundleStatus.innerHTML = `<div class="status info">Preparing bundle…</div>`;
    const pidFile = document.getElementById("bundlePid")?.files?.[0];
    const ioFile = document.getElementById("bundleIo")?.files?.[0];
    const ceFile = document.getElementById("bundleCE")?.files?.[0];
    const narrativeFile = document.getElementById("bundleNarrative")?.files?.[0];
    const alarmsFile = document.getElementById("bundleAlarms")?.files?.[0];

    if (!pidFile) {
      bundleStatus.innerHTML = `<div class="status error"><strong>✗ Error:</strong> Please upload a P&amp;ID file.</div>`;
      return;
    }

    const formData = new FormData();
    if (ioFile) formData.append("io", ioFile);
    if (ceFile) formData.append("causeEffect", ceFile);
    if (narrativeFile) formData.append("narrative", narrativeFile);
    if (alarmsFile) formData.append("alarms", alarmsFile);

    // For images, OCR client-side and send pidText (works for scanned drawings).
    const isImage = (pidFile.type && pidFile.type.startsWith("image/")) || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(pidFile.name);
    if (isImage) {
      bundleStatus.innerHTML = `<div class="status info"><strong>OCR (P&amp;ID image):</strong> starting…</div>`;
      const text = await ocrImageFile(pidFile);
      formData.append("pidText", text || "");
    } else {
      // PDF: try server-side text extraction first; UI will still succeed if PDF has selectable text.
      formData.append("pid", pidFile);
    }

    bundleStatus.innerHTML = `<div class="status info">Generating PLC code from bundle…</div>`;
    let result = await API.importProjectBundle(formData);

    // If PDF was scanned and server couldn't extract text, fallback to OCR in browser then retry.
    const needsPidOcr =
      !result.ok &&
      String(result.error || "").toLowerCase().includes("no selectable text");

    if (!result.ok) {
      // Some servers return a warning in result.warnings even if ok; but if not ok, show errors.
      // For scanned PDFs, attempt OCR and retry.
      const maybeNoText =
        String(result.error || "").includes("No text could be extracted") ||
        String(result.error || "").includes("no selectable text");

      const isPdf = pidFile.type === "application/pdf" || pidFile.name.toLowerCase().endsWith(".pdf");
      if (isPdf && maybeNoText) {
        bundleStatus.innerHTML = `<div class="status info"><strong>OCR (scanned PDF):</strong> extracting text…</div>`;
        const text = await ocrPdfFile(pidFile);
        const fd2 = new FormData();
        if (ioFile) fd2.append("io", ioFile);
        if (ceFile) fd2.append("causeEffect", ceFile);
        if (narrativeFile) fd2.append("narrative", narrativeFile);
        if (alarmsFile) fd2.append("alarms", alarmsFile);
        fd2.append("pidText", text || "");
        bundleStatus.innerHTML = `<div class="status info">Generating PLC code from OCR’d P&amp;ID…</div>`;
        result = await API.importProjectBundle(fd2);
      }
    }

    if (!result.ok) {
      bundleStatus.innerHTML = `<div class="status error"><strong>✗ Error:</strong> ${escapeHtml(result.error || "Unknown error")}</div>`;
      return;
    }

    // Transform to match displayResult expectations
    const counts = result.model?.pid?.counts || {};
    const display = {
      ok: true,
      ir: result.ir,
      ioMap: result.ioMap,
      elements: {
        instruments: counts.instruments || 0,
        valves: counts.valves || 0,
        pumps: counts.pumps || 0,
        controlLoops: counts.controlLoops || 0
      },
      warnings: result.warnings || []
    };

    displayResult(display);

    if (display.warnings?.length) {
      bundleStatus.innerHTML =
        `<div class="status warning"><strong>Generated with warnings:</strong><br>` +
        `<ul style="margin: 8px 0 0 18px;">${display.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`;
    } else {
      bundleStatus.innerHTML = `<div class="status success">✓ Bundle imported and PLC code generated.</div>`;
    }
  } catch (e) {
    bundleStatus.innerHTML = `<div class="status error"><strong>✗ Error:</strong> ${escapeHtml(String(e?.message || e))}</div>`;
    console.error("Bundle import error:", e);
  }
});

// File upload handling
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const fileStatus = document.getElementById("fileStatus");

uploadArea.addEventListener("click", () => fileInput.click());

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
});

fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

async function handleFile(file) {
  fileStatus.innerHTML = `<div class="status info">Processing ${file.name}...</div>`;
  
  const formData = new FormData();
  formData.append("file", file);

  try {
    const result = await API.importPID(formData);
    if (result.ok) {
      displayResult(result);
      if (result.warning) {
        fileStatus.innerHTML = `<div class="status warning">⚠ ${result.warning}</div>`;
      } else {
        fileStatus.innerHTML = `<div class="status success">✓ Successfully processed ${file.name}</div>`;
      }
    } else {
      // If server couldn't extract text OR image OCR wasn't implemented server-side,
      // try OCR fallback in the browser (so images/scanned PDFs still work).
      const err = String(result.error || "");
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const isImage = (file.type && file.type.startsWith("image/")) || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name);
      const ocrCandidate =
        (isPdf || isImage) &&
        (
          err.includes("No text could be extracted") ||
          err.includes("Image OCR is not yet implemented") ||
          err.includes("Failed to extract text from file")
        );

      if (ocrCandidate) {
        await tryOcrFallback(file, result);
        return;
      }

      renderError(result);
    }
  } catch (e) {
    fileStatus.innerHTML = `<div class="status error">✗ Error: ${e.message}<br><br>Please check the browser console for more details.</div>`;
    console.error("P&ID import error:", e);
  }
}

function renderError(result) {
  let errorHTML = `<div class="status error">`;
  errorHTML += `<strong>✗ Error:</strong> ${result.error || "Unknown error"}`;
  if (result.suggestion) errorHTML += `<br><br><strong>Suggestion:</strong> ${result.suggestion}`;
  if (result.details) errorHTML += `<br><br><strong>Details:</strong> ${result.details}`;
  errorHTML += `</div>`;
  fileStatus.innerHTML = errorHTML;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function tryOcrFallback(file, originalError) {
  // Guard: OCR libraries loaded?
  if (!window.Tesseract) {
    renderError({
      error: "OCR fallback is not available (Tesseract.js failed to load).",
      suggestion: "Reload the page and try again, or use the JSON Input tab."
    });
    return;
  }

  fileStatus.innerHTML = `<div class="status info"><strong>OCR fallback:</strong> extracting text from ${file.name}…</div>`;

  try {
    let text = "";
    if (file.type && file.type.startsWith("image/")) {
      text = await ocrImageFile(file);
    } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      text = await ocrPdfFile(file);
    } else {
      renderError({
        error: "Unsupported file type for OCR fallback.",
        suggestion: "Upload a PDF/PNG/JPG, or use the JSON Input tab."
      });
      return;
    }

    if (!text || !text.trim()) {
      renderError({
        error: "OCR ran but produced no text.",
        suggestion:
          "If the drawing is low-resolution, try exporting a higher quality PDF/image. " +
          "You can also use the JSON Input tab as a guaranteed path."
      });
      return;
    }

    fileStatus.innerHTML =
      `<div class="status info"><strong>OCR complete:</strong> extracted ${text.length} characters. Generating PLC code…</div>`;

    const importResult = await API.importPIDFromText(text);
    if (importResult.ok) {
      displayResult(importResult);
      fileStatus.innerHTML =
        `<div class="status success">✓ Imported via OCR (${text.length} chars extracted). You can now upload to the PLC runtime.</div>`;
    } else {
      fileStatus.innerHTML =
        `<div class="status error"><strong>✗ OCR extracted text but tag parsing failed.</strong><br><br>${escapeHtml(importResult.error || "Unknown error")}<br><br><strong>Suggestion:</strong> ${escapeHtml(importResult.suggestion || "Try JSON Input or ensure tags look like PT-101, XV-101, P-101, LC-101.")}</div>`;
    }
  } catch (e) {
    const msg = String(e?.message || e);
    let diag = "";

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const pdfjsLoaded = !!window.pdfjsLib;
      let pdfMin = "unknown";
      let pdfWorker = "unknown";
      try {
        const r = await fetch("/vendor/pdfjs/pdf.min.mjs", { method: "GET", cache: "no-store" });
        pdfMin = String(r.status);
      } catch {
        pdfMin = "failed";
      }
      try {
        const r = await fetch("/vendor/pdfjs/pdf.worker.min.mjs", { method: "GET", cache: "no-store" });
        pdfWorker = String(r.status);
      } catch {
        pdfWorker = "failed";
      }

      diag =
        `<br><br><strong>PDF OCR diagnostics:</strong>` +
        `<br>- pdfjsLib loaded: ${pdfjsLoaded}` +
        `<br>- /vendor/pdfjs/pdf.min.js: ${pdfMin}` +
        `<br>- /vendor/pdfjs/pdf.worker.min.js: ${pdfWorker}` +
        `<br><br><strong>Fix:</strong> hard refresh (Ctrl+F5). If this still fails, confirm the local server is serving <code>/vendor/pdfjs/</code>.`;
    }

    fileStatus.innerHTML =
      `<div class="status error"><strong>✗ OCR fallback failed.</strong><br><br>${escapeHtml(msg)}${diag}</div>`;
    console.error("OCR fallback error:", e, { originalError });
  }
}

async function ocrImageFile(file) {
  // Use Tesseract directly on the image File object
  const { data } = await window.Tesseract.recognize(file, "eng", {
    logger: (m) => {
      if (m?.status === "recognizing text") {
        const pct = Math.round((m.progress || 0) * 100);
        fileStatus.innerHTML = `<div class="status info"><strong>OCR (image):</strong> ${pct}%</div>`;
      }
    }
  });
  return data?.text || "";
}

async function ocrPdfFile(file) {
  // pdfjs-dist 4.x ships ESM (.mjs). Load it on demand and stash on window for reuse.
  if (!window.pdfjsLib) {
    try {
      const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
      window.pdfjsLib = pdfjs;
    } catch (e) {
      throw new Error(
        "PDF.js failed to load, cannot OCR PDF. " +
        "Check that /vendor/pdfjs/pdf.min.mjs is reachable (200), then hard refresh (Ctrl+F5). " +
        `(${String(e?.message || e)})`
      );
    }
  }

  // Configure worker (PDF.js 4.x)
  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  } catch {}

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  // OCR first N pages to keep it fast; increase if you want more coverage.
  const maxPages = Math.min(pdf.numPages || 1, 3);
  let allText = "";

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    fileStatus.innerHTML = `<div class="status info"><strong>OCR (PDF):</strong> rendering page ${pageNum}/${maxPages}…</div>`;
    const page = await pdf.getPage(pageNum);
    const scale = 2.0; // higher = better OCR, slower
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    fileStatus.innerHTML = `<div class="status info"><strong>OCR (PDF):</strong> recognizing page ${pageNum}/${maxPages}…</div>`;
    const { data } = await window.Tesseract.recognize(canvas, "eng", {
      logger: (m) => {
        if (m?.status === "recognizing text") {
          const pct = Math.round((m.progress || 0) * 100);
          fileStatus.innerHTML =
            `<div class="status info"><strong>OCR (PDF page ${pageNum}/${maxPages}):</strong> ${pct}%</div>`;
        }
      }
    });
    allText += "\n" + (data?.text || "");
  }

  return allText;
}

// JSON import
document.getElementById("btnImportJSON").addEventListener("click", async () => {
  const jsonInput = document.getElementById("jsonInput").value;
  if (!jsonInput.trim()) {
    alert("Please enter JSON data");
    return;
  }

  let pidData;
  try {
    pidData = JSON.parse(jsonInput);
  } catch (e) {
    alert(`Invalid JSON: ${e.message}`);
    return;
  }

  const formData = new FormData();
  formData.append("pidData", JSON.stringify(pidData));

  try {
    const result = await API.importPID(formData);
    if (result.ok) {
      displayResult(result);
      document.getElementById("fileStatus").innerHTML = `<div class="status success">✓ Successfully imported JSON data</div>`;
    } else {
      let errorHTML = `<div class="status error">`;
      errorHTML += `<strong>✗ Error:</strong> ${result.error || "Unknown error"}`;
      if (result.suggestion) {
        errorHTML += `<br><br><strong>Suggestion:</strong> ${result.suggestion}`;
      }
      if (result.details) {
        errorHTML += `<br><br><strong>Details:</strong> ${result.details}`;
      }
      errorHTML += `</div>`;
      document.getElementById("fileStatus").innerHTML = errorHTML;
    }
  } catch (e) {
    document.getElementById("fileStatus").innerHTML = `<div class="status error">✗ Error: ${e.message}<br><br>Please check the browser console for more details.</div>`;
    console.error("JSON import error:", e);
  }
});

function displayResult(result) {
  const resultPanel = document.getElementById("resultPanel");
  resultPanel.style.display = "block";
  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });

  // Elements summary
  const summary = document.getElementById("elementsSummary");
  const totalElements = (result.elements.instruments || 0) + 
                       (result.elements.valves || 0) + 
                       (result.elements.pumps || 0) + 
                       (result.elements.controlLoops || 0);
  
  let summaryHTML = `
    <p><strong>Detected Elements:</strong></p>
    <ul>
      <li>Instruments: ${result.elements.instruments || 0}</li>
      <li>Valves: ${result.elements.valves || 0}</li>
      <li>Pumps: ${result.elements.pumps || 0}</li>
      <li>Control Loops: ${result.elements.controlLoops || 0}</li>
    </ul>
  `;
  
  if (totalElements === 0 && result.warning) {
    summaryHTML += `<div class="status warning" style="margin-top: 10px; padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;">
      <strong>⚠ No elements detected:</strong><br>
      ${result.warning}
    </div>`;
  }
  
  summary.innerHTML = summaryHTML;

  // I/O Mapping
  if (result.ioMap && Object.keys(result.ioMap).length > 0) {
    const ioMapContainer = document.getElementById("ioMapContainer");
    ioMapContainer.innerHTML = "";
    for (const [tag, address] of Object.entries(result.ioMap)) {
      const div = document.createElement("div");
      div.className = "io-item";
      div.textContent = `${tag} → ${address}`;
      ioMapContainer.appendChild(div);
    }
    document.getElementById("ioMapping").style.display = "block";
  }

  // Code preview
  const codePreview = document.getElementById("codePreview");
  codePreview.textContent = JSON.stringify(result.ir, null, 2);

  // Extract and store goal
  const goal = result.ir?.metadata?.goal || result.metadata?.goal || result.goal || null;
  if (goal) {
    localStorage.setItem("project.goal", goal);
  } else {
    // Prompt user for goal if not present
    const userGoal = prompt("What is the goal of this project? (e.g., 'Control pump P-101 based on level LC-101')");
    if (userGoal && userGoal.trim()) {
      localStorage.setItem("project.goal", userGoal.trim());
    }
  }

  // Store imported panel data for Build page
  // Convert IR to panel format if possible, or store IR for Build to process
  if (result.ir) {
    localStorage.setItem("project.importedIR", JSON.stringify(result.ir));
    localStorage.setItem("project.importedIOMap", JSON.stringify(result.ioMap || {}));
  }

  // Store result for later use
  window.lastPIDResult = result;

  // Add "Send to Build" button if not already present
  const uploadSection = document.querySelector("#resultPanel .upload-section") || document.getElementById("statusMessage");
  if (uploadSection && !document.getElementById("btnSendToBuild")) {
    const btnSendToBuild = document.createElement("button");
    btnSendToBuild.id = "btnSendToBuild";
    btnSendToBuild.className = "btn";
    btnSendToBuild.textContent = "Send to Build";
    btnSendToBuild.style.marginTop = "10px";
    btnSendToBuild.onclick = () => {
      window.location.href = "/panel_builder.html";
    };
    uploadSection.appendChild(btnSendToBuild);
  }
}

// Upload to PLC
document.getElementById("btnUploadToPLC").addEventListener("click", async () => {
  if (!window.lastPIDResult) {
    alert("No PLC code to upload. Please import a P&ID first.");
    return;
  }

  const statusMessage = document.getElementById("statusMessage");
  statusMessage.innerHTML = `<div class="status info">Uploading to PLC runtime...</div>`;

  try {
    const res = await fetch("/api/program", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ir: window.lastPIDResult.ir })
    });

    const result = await res.json();
    if (result.ok) {
      statusMessage.innerHTML = `<div class="status success">✓ PLC code uploaded successfully! <a href="/monitor.html">Open Monitor</a> to test it.</div>`;
    } else {
      statusMessage.innerHTML = `<div class="status error">✗ Upload failed: ${result.error}</div>`;
    }
  } catch (e) {
    statusMessage.innerHTML = `<div class="status error">✗ Error: ${e.message}</div>`;
  }
});

// Download IR
document.getElementById("btnDownloadIR").addEventListener("click", () => {
  if (!window.lastPIDResult) {
    alert("No PLC code to download. Please import a P&ID first.");
    return;
  }

  const blob = new Blob([JSON.stringify(window.lastPIDResult.ir, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pid_generated_program.ir.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

// Export ST
document.getElementById("btnExportST").addEventListener("click", async () => {
  if (!window.lastPIDResult) {
    alert("No PLC code to export. Please import a P&ID first.");
    return;
  }

  // First upload the code, then export ST
  try {
    await fetch("/api/program", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ir: window.lastPIDResult.ir })
    });

    const st = await API.exportST();
    const blob = new Blob([st], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pid_generated_program.st";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert(`Error exporting ST: ${e.message}`);
  }
});

// Scan-to-Build functionality
function suggestFromText(t) {
  const s = t.toUpperCase();
  const suggestions = [];

  if (s.includes("VFD") || s.includes("DRIVE") || s.match(/\bACS\d+\b/) || s.match(/\bPOWERFLEX\b/)) {
    suggestions.push({ wizard: "Forward / Reverse Motor", why: "Detected VFD/Drive-like text." });
  }
  if (s.includes("MOTOR") || s.includes("HP") || s.includes("KW") || s.includes("RPM")) {
    suggestions.push({ wizard: "Start / Stop Motor", why: "Detected motor nameplate-like fields (HP/kW/RPM)." });
  }
  if (s.includes("PUMP")) {
    suggestions.push({ wizard: "Pump Alternation", why: "Detected 'PUMP'." });
  }

  if (!suggestions.length) suggestions.push({ wizard: "Start / Stop Motor", why: "Default safe starting point." });
  return suggestions;
}

// Scan-to-Build tab handlers
const scanUploadArea = document.getElementById("scanUploadArea");
const scanFileInput = document.getElementById("scanFileInput");
const scanStatus = document.getElementById("scanStatus");
const scanSuggestions = document.getElementById("scanSuggestions");

if (scanUploadArea && scanFileInput) {
  scanUploadArea.addEventListener("click", () => scanFileInput.click());

  scanUploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    scanUploadArea.classList.add("dragover");
  });

  scanUploadArea.addEventListener("dragleave", () => {
    scanUploadArea.classList.remove("dragover");
  });

  scanUploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    scanUploadArea.classList.remove("dragover");
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      scanFileInput.files = files;
      handleScanFile(files[0]);
    }
  });

  scanFileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleScanFile(e.target.files[0]);
    }
  });

  document.getElementById("btnScan")?.addEventListener("click", async () => {
    const file = scanFileInput.files?.[0];
    if (!file) {
      scanStatus.innerHTML = `<div class="status error">Please select a photo first.</div>`;
      return;
    }
    await handleScanFile(file);
  });
}

async function handleScanFile(file) {
  if (!window.Tesseract) {
    scanStatus.innerHTML = `<div class="status error">OCR library (Tesseract) is not loaded. Please refresh the page.</div>`;
    return;
  }

  scanStatus.innerHTML = `<div class="status info">OCR starting…</div>`;
  scanSuggestions.innerHTML = "";

  try {
    const text = await ocrImageFile(file);
    const suggestions = suggestFromText(text);
    
    scanStatus.innerHTML = `<div class="status success">✓ OCR complete. Extracted ${text.length} characters.</div>`;
    
    // Display suggestions
    let suggestionsHTML = `<div class="card" style="margin-top: 12px;"><h3 style="margin-top:0;">Suggested Control Templates</h3>`;
    suggestions.forEach((s, idx) => {
      suggestionsHTML += `
        <div style="padding: 10px; margin: 8px 0; background: #f4f4f4; border-radius: 8px;">
          <strong>${escapeHtml(s.wizard)}</strong>
          <div class="small" style="margin-top: 4px; color: #666;">${escapeHtml(s.why)}</div>
        </div>
      `;
    });
    suggestionsHTML += `
      <div style="margin-top: 12px;">
        <a href="/wizards.html" class="btn">Open Control Templates</a>
      </div>
    </div>`;
    
    scanSuggestions.innerHTML = suggestionsHTML;
    
    // Show extracted text preview (first 500 chars)
    const previewHTML = `
      <div class="card" style="margin-top: 12px;">
        <h3 style="margin-top:0;">Extracted Text Preview</h3>
        <pre style="background: #f7f7f7; padding: 10px; border-radius: 6px; overflow: auto; max-height: 200px; font-size: 12px;">${escapeHtml(text.slice(0, 500))}${text.length > 500 ? "\n\n... (truncated)" : ""}</pre>
      </div>
    `;
    scanSuggestions.innerHTML += previewHTML;
  } catch (e) {
    scanStatus.innerHTML = `<div class="status error">✗ OCR failed: ${escapeHtml(String(e?.message || e))}</div>`;
    console.error("Scan error:", e);
  }
}

// Logic to Control Narrative (same flow as P&ID Import: one file, one button, full output)
const narrativeStatus = document.getElementById("narrativeStatus");
const narrativeDownloads = document.getElementById("narrativeDownloads");
const narrativeDownloadList = document.getElementById("narrativeDownloadList");
const btnNarrative = document.getElementById("btnNarrativeGenerate");
btnNarrative?.addEventListener("click", async () => {
  const logicFile = document.getElementById("narrativeLogicFile")?.files?.[0];
  if (!logicFile) {
    narrativeStatus.innerHTML = `<div class="status error">Please select a Logic/functional diagrams PDF.</div>`;
    narrativeDownloads.style.display = "none";
    return;
  }
  narrativeStatus.innerHTML = `<div class="status info">Generating control narrative…</div>`;
  narrativeDownloads.style.display = "none";
  narrativeDownloadList.innerHTML = "";
  if (btnNarrative) btnNarrative.disabled = true;
  const fd = new FormData();
  fd.append("logic", logicFile);
  const tpl = document.getElementById("narrativeTemplateFile")?.files?.[0];
  if (tpl) fd.append("template", tpl);
  fd.append("project", document.getElementById("narrativeProject")?.value || "Combustion Control System, Fully Metered");
  fd.append("customer", document.getElementById("narrativeCustomer")?.value || "TotalEnergies Port Arthur, TX.");
  try {
    const out = await API.generateNarrative(fd);
    if (out && out.ok && out.outputs) {
      narrativeStatus.innerHTML = `<div class="status success">Done. Download your outputs below.</div>`;
      const expected = ["control_narrative.md", "control_narrative.docx", "control_narrative.pdf", "tag_dictionary.csv", "cause_effect.csv"];
      const byName = new Map((out.outputs || []).map(o => [o.name, o]));
      const pdfMissing = !byName.get("control_narrative.pdf");
      const warnings = out.warnings || [];
      expected.forEach(name => {
        const item = byName.get(name);
        if (item) {
          const a = document.createElement("a");
          a.href = "/api/narrative/exports/" + item.path;
          a.download = (item.name.split("/").pop() || item.name);
          a.textContent = item.name;
          a.style.display = "block";
          a.style.marginBottom = "6px";
          narrativeDownloadList.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.style.display = "block";
          span.style.marginBottom = "6px";
          span.style.color = "#64748b";
          span.textContent = name + " (not generated)";
          narrativeDownloadList.appendChild(span);
        }
      });
      if (pdfMissing && warnings.length) {
        const tip = document.createElement("p");
        tip.className = "small";
        tip.style.marginTop = "10px";
        tip.style.color = "#64748b";
        tip.textContent = "To generate PDF: install reportlab in the narrative Python environment (e.g. cd control_narrative_gen && pip install -r requirements.txt, or use a .venv there).";
        narrativeDownloadList.appendChild(tip);
      }
      narrativeDownloads.style.display = "block";
    } else if (out && out.serverDown) {
      narrativeStatus.innerHTML = `<div class="status error">Request failed. Check that the server is running.</div>`;
    } else {
      narrativeStatus.innerHTML = `<div class="status error">${escapeHtml(out?.error || "Generation failed.")}</div>`;
    }
  } catch (e) {
    narrativeStatus.innerHTML = `<div class="status error">${escapeHtml(String(e?.message || e))}</div>`;
  } finally {
    if (btnNarrative) btnNarrative.disabled = false;
  }
});
