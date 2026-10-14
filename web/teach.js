const elMsg = document.getElementById("msg");
const elExamples = document.getElementById("examples");
const elPreview = document.getElementById("preview");

const API = {
  state: () => fetch("/api/state").then(r => r.json()),
  compile: (model) => fetch("/api/teach/compile", {
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

const examples = [];

function parseInputs() {
  return String(document.getElementById("inTags").value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function render() {
  elExamples.innerHTML = "";
  examples.forEach((e, idx) => {
    const div = document.createElement("div");
    div.className = "tile";
    div.innerHTML = `
      <div><strong>Example ${idx + 1}</strong> — ${e.outputOn ? "ON" : "OFF"}</div>
      <div class="small" style="margin-top:6px;">${Object.entries(e.inputs).map(([k,v]) => `${k}: ${v ? "ON" : "OFF"}`).join(" · ")}</div>
      <button class="btn secondary" style="margin-top:10px;" data-del="${idx}">Remove</button>
    `;
    div.querySelector("[data-del]").onclick = () => { examples.splice(idx, 1); render(); };
    elExamples.appendChild(div);
  });
}

async function recordExample(outputOn) {
  const s = await API.state();
  const inTags = parseInputs();
  // For MVP: use current I0.. states if addresses exist via last project mapping is unknown here,
  // so we record "tag states" as if tag names are inputs (Teach compiler maps them to addresses).
  // User will toggle in Electrician View after project bundle for best results.
  const inputs = {};
  for (const t of inTags) inputs[t] = false; // default
  // If user typed actual addresses (I0...), capture them too
  for (const t of inTags) {
    if (t.startsWith("I")) inputs[t] = !!s.inputs?.[t];
  }
  examples.push({ inputs, outputOn });
  elMsg.textContent = `Recorded ${outputOn ? "ON" : "OFF"} example.`;
  render();
}

document.getElementById("recordOn").onclick = () => recordExample(true);
document.getElementById("recordOff").onclick = () => recordExample(false);

document.getElementById("compile").onclick = async () => {
  const outTag = document.getElementById("outTag").value || "Output";
  const inTags = parseInputs();
  const tags = {};
  inTags.forEach(t => tags[t] = { kind: "DI" });
  tags[outTag] = { kind: "DO" };

  const model = { tags, inputs: inTags, output: outTag, examples };
  const r = await API.compile(model);
  if (!r.ok) { elMsg.textContent = `Error: ${r.error}`; return; }
  elPreview.textContent = JSON.stringify(r.ir, null, 2);
  if (r.clarifying?.length) elMsg.textContent = `Generated with notes: ${r.clarifying.join(" | ")}`;
  const up = await API.uploadIR(r.ir);
  if (!up.ok) { elMsg.textContent = `Compiled, but upload failed: ${up.error}`; return; }
  elMsg.textContent = `Uploaded. Open Monitor/Electrician View. ${r.clarifying?.length ? "Notes: " + r.clarifying.join(" | ") : ""}`;
};

render();

