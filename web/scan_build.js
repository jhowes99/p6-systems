const elMsg = document.getElementById("msg");
const elOut = document.getElementById("out");

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
    suggestions.push({ wizard: "Pump Alternation (coming next)", why: "Detected 'PUMP'." });
  }

  if (!suggestions.length) suggestions.push({ wizard: "Start / Stop Motor", why: "Default safe starting point." });
  return suggestions;
}

async function ocrImage(file) {
  if (!window.Tesseract) throw new Error("Tesseract not loaded");
  const { data } = await window.Tesseract.recognize(file, "eng", {
    logger: (m) => {
      if (m?.status === "recognizing text") {
        const pct = Math.round((m.progress || 0) * 100);
        elMsg.textContent = `OCR: ${pct}%`;
      }
    }
  });
  return data?.text || "";
}

document.getElementById("run").onclick = async () => {
  const f = document.getElementById("file").files?.[0];
  if (!f) { elMsg.textContent = "Pick an image first."; return; }
  elMsg.textContent = "OCR starting…";
  const text = await ocrImage(f);
  const suggestions = suggestFromText(text);
  elOut.textContent = JSON.stringify({ extractedTextPreview: text.slice(0, 800), suggestions }, null, 2);
  elMsg.textContent = "Done. See suggestions below.";
};

