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

  function fmtVal(v) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string") return v || "—";
    try {
      return JSON.stringify(v);
    } catch {
      return "—";
    }
  }

  /** Resolve first matching tag from live signal list (demo tags evolved; keep aliases). */
  function findSignal(byTag, ...aliases) {
    for (const tag of aliases) {
      if (byTag[tag]) return { tag, signal: byTag[tag] };
    }
    const keys = Object.keys(byTag);
    for (const alias of aliases) {
      const re = new RegExp("^" + alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-_]?") + "$", "i");
      const hit = keys.find((k) => re.test(k));
      if (hit) return { tag: hit, signal: byTag[hit] };
    }
    return null;
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
      <div>mode<br><b>${fmtVal(st.mode)}</b></div>
      <div>sim time<br><b>${fmtVal(st.sim?.timeMs ?? 0)} ms</b></div>
      <div>scans<br><b>${fmtVal(st.sim?.scanCount ?? 0)}</b></div>
      <div>project<br><b>${fmtVal((st.boundProjectId || "none").slice(0, 12))}</b></div>`;
  }

  function renderSignals(signals) {
    const byTag = Object.fromEntries((signals || []).map((s) => [s.tag, s]));
    // Canonical demo tags first; legacy aliases for older seeds
    const interesting = [
      [["ESD-101.Healthy", "ESTOP101.Healthy", "ESD101.Healthy"], "E-Stop"],
      [["LT-101.High", "LSH101.High", "LSH-101.High"], "LSH High"],
      [["VALVE-101.OpenCommand", "XV101.OpenCommand", "XV-101.OpenCommand"], "Valve Cmd"],
      [["VALVE-101.OpenedFeedback", "XV101.OpenedFeedback", "XV-101.OpenedFeedback"], "Valve Open"],
      [["M-101.Energize", "M101.Energize"], "Motor"],
      [["PUMP-101.RunningFeedback", "P101.RunningFeedback", "P-101.RunningFeedback"], "Pump Run"],
      [["System.Start"], "Start"],
      [["System.Reset"], "Reset"]
    ];
    $("equip").innerHTML = interesting.map(([aliases, label]) => {
      const hit = findSignal(byTag, ...aliases);
      const v = hit?.signal?.currentValue;
      let cls = "unk";
      if (v === true) cls = "on";
      else if (v === false) cls = "off";
      const primary = aliases[0] || "";
      if (/Healthy/i.test(primary) && v === false) cls = "alarm";
      if (/High$/i.test(primary) && v === true) cls = "alarm";
      return `<div class="row"><span>${label}</span><span class="${cls}">${fmtVal(v)}</span></div>`;
    }).join("");

    $("signals").innerHTML = `
      <div class="h"><span>Tag</span><span>Value</span><span>Dir</span><span>Quality</span><span>Addr</span></div>
      ${(signals || []).map((s) => `
        <div class="r">
          <span>${s.tag}</span>
          <span>${fmtVal(s.currentValue)}</span>
          <span>${fmtVal(s.direction)}</span>
          <span>${fmtVal(s.quality)}</span>
          <span>${fmtVal(s.address)}</span>
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

  $("btnEstop").onclick = async () => { await setSig("ESD-101.Healthy", false); await refresh(); };
  $("btnEstopClear").onclick = async () => { await setSig("ESD-101.Healthy", true); await refresh(); };
  $("btnLshOn").onclick = async () => { await setSig("LT-101.High", true); await refresh(); };
  $("btnLshOff").onclick = async () => { await setSig("LT-101.High", false); await refresh(); };

  await refresh();
  setInterval(() => { refresh().catch(() => {}); }, 500);
})();
