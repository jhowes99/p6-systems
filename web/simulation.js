(async function () {
  const $ = (id) => document.getElementById(id);

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function pulse(tag) {
    await api("/api/runtime/signal", { method: "POST", body: JSON.stringify({ tag, value: true }) });
    await api("/api/runtime/step", { method: "POST", body: "{}" });
    await api("/api/runtime/signal", { method: "POST", body: JSON.stringify({ tag, value: false }) });
  }

  async function setSig(tag, value) {
    await api("/api/runtime/signal", { method: "POST", body: JSON.stringify({ tag, value }) });
  }

  function renderStatus(st) {
    $("modePill").textContent = String(st.mode || "—").toUpperCase();
    $("stats").innerHTML = `
      <div>mode<br><b>${st.mode}</b></div>
      <div>sim time<br><b>${st.sim?.timeMs ?? 0} ms</b></div>
      <div>scans<br><b>${st.sim?.scanCount ?? 0}</b></div>
      <div>project<br><b>${(st.boundProjectId || "none").slice(0, 12)}</b></div>`;
  }

  function renderSignals(signals) {
    const byTag = Object.fromEntries((signals || []).map((s) => [s.tag, s]));
    const interesting = [
      ["ESTOP101.Healthy", "E-Stop"],
      ["LSH101.High", "LSH High"],
      ["XV101.OpenCommand", "Valve Cmd"],
      ["XV101.OpenedFeedback", "Valve Open"],
      ["M101.Energize", "Motor"],
      ["P101.RunningFeedback", "Pump Run"],
      ["System.Start", "Start"],
      ["System.Reset", "Reset"]
    ];
    $("equip").innerHTML = interesting.map(([tag, label]) => {
      const s = byTag[tag];
      const v = s?.currentValue;
      let cls = v ? "on" : "off";
      if (tag === "ESTOP101.Healthy" && v === false) cls = "alarm";
      if (tag === "LSH101.High" && v === true) cls = "alarm";
      return `<div class="row"><span>${label}</span><span class="${cls}">${String(v)}</span></div>`;
    }).join("");

    $("signals").innerHTML = `
      <div class="h"><span>Tag</span><span>Value</span><span>Dir</span><span>Quality</span><span>Addr</span></div>
      ${(signals || []).map((s) => `
        <div class="r">
          <span>${s.tag}</span>
          <span>${s.currentValue}</span>
          <span>${s.direction}</span>
          <span>${s.quality}</span>
          <span>${s.address || "—"}</span>
        </div>`).join("")}`;
  }

  async function refresh() {
    const [st, sig] = await Promise.all([
      api("/api/runtime/status"),
      api("/api/runtime/signals")
    ]);
    renderStatus(st);
    renderSignals(sig.signals || []);
  }

  document.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-act");
      await api(`/api/runtime/${act}`, { method: "POST", body: "{}" });
      await refresh();
    });
  });

  document.querySelectorAll("[data-sig]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await pulse(btn.getAttribute("data-sig"));
      await refresh();
    });
  });

  $("btnEstop").onclick = async () => { await setSig("ESTOP101.Healthy", false); await refresh(); };
  $("btnEstopClear").onclick = async () => { await setSig("ESTOP101.Healthy", true); await refresh(); };
  $("btnLshOn").onclick = async () => { await setSig("LSH101.High", true); await refresh(); };
  $("btnLshOff").onclick = async () => { await setSig("LSH101.High", false); await refresh(); };

  await refresh();
  setInterval(() => { refresh().catch(() => {}); }, 500);
})();
