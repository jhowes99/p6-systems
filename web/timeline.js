const elSteps = document.getElementById("steps");
const elMsg = document.getElementById("msg");
const elPrev = document.getElementById("preview");

const API = {
  compile: (model) => fetch("/api/timeline/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model })
  }).then(r => r.json()),
  uploadIR: (ir) => fetch("/api/program", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir })
  }).then(r => r.json())
};

const model = {
  tags: {
    "Start Button": { kind: "DI", label: "Start PB" },
    "Motor M1": { kind: "DO", label: "Motor" },
    "Valve V1": { kind: "DO", label: "Valve" }
  },
  startTag: "Start Button",
  steps: [
    { action: { tag: "Motor M1", state: true } },
    { delayMs: 5000 },
    { action: { tag: "Valve V1", state: true } }
  ]
};

function render() {
  elSteps.innerHTML = "";
  model.steps.forEach((s, idx) => {
    const el = document.createElement("div");
    el.className = "step";
    if (s.delayMs != null) {
      el.innerHTML = `
        <strong>Delay</strong>
        <label>ms</label>
        <input type="number" min="0" value="${s.delayMs}" data-i="${idx}" data-k="delayMs" />
        <button data-del="${idx}" class="btn secondary">Remove</button>
      `;
    } else {
      el.innerHTML = `
        <strong>Action</strong>
        <label>Tag</label>
        <input value="${s.action.tag}" data-i="${idx}" data-k="tag" />
        <label>State</label>
        <select data-i="${idx}" data-k="state">
          <option value="true" ${s.action.state ? "selected" : ""}>ON</option>
          <option value="false" ${!s.action.state ? "selected" : ""}>OFF</option>
        </select>
        <button data-del="${idx}" class="btn secondary">Remove</button>
      `;
    }
    elSteps.appendChild(el);
  });

  elSteps.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    const i = Number(b.dataset.del);
    model.steps.splice(i, 1);
    render();
  });
  elSteps.querySelectorAll("input[data-i], select[data-i]").forEach(inp => inp.onchange = () => {
    const i = Number(inp.dataset.i);
    const k = inp.dataset.k;
    if (k === "delayMs") model.steps[i].delayMs = Number(inp.value);
    if (k === "tag") model.steps[i].action.tag = inp.value;
    if (k === "state") model.steps[i].action.state = inp.value === "true";
  });
}

document.getElementById("addAction").onclick = () => { model.steps.push({ action: { tag: "Output", state: true } }); render(); };
document.getElementById("addDelay").onclick = () => { model.steps.push({ delayMs: 1000 }); render(); };

document.getElementById("compile").onclick = async () => {
  model.startTag = document.getElementById("startTag").value || "Start Button";
  elMsg.textContent = "Compiling…";
  const r = await API.compile(model);
  if (!r.ok) { elMsg.textContent = `Error: ${r.error}`; return; }
  elPrev.textContent = JSON.stringify(r.ir, null, 2);
  const up = await API.uploadIR(r.ir);
  if (!up.ok) { elMsg.textContent = `Compiled, but upload failed: ${up.error}`; return; }
  elMsg.textContent = `Uploaded. Open Monitor/Electrician View. ${r.warnings?.length ? "Warnings: " + r.warnings.join("; ") : ""}`;
};

render();

