/**
 * P6 Symbol Registry — one definition per equipment family.
 * Fields: identity, type aliases, modes, ports, props, control caps, runtime bindings.
 */
(function (global) {
  const P6 = (global.P6Symbols = global.P6Symbols || {});
  const svg = () => P6.svg || {};

  /** @typedef {{ id: string, side: string, u: number, v: number, kinds: string[], role: string, label: string }} PortDef */

  function portsProcessLR(extra) {
    return [
      { id: "in", side: "left", u: 0, v: 0.5, kinds: ["process"], role: "in", label: "In" },
      { id: "out", side: "right", u: 1, v: 0.5, kinds: ["process"], role: "out", label: "Out" },
      ...(extra || [])
    ];
  }

  function def(entry) {
    return entry;
  }

  const REGISTRY = [
    def({
      id: "centrifugal_pump",
      type: "pump",
      aliases: ["pump", "centrifugal_pump", "centrifugal pump"],
      label: "Centrifugal pump",
      category: "rotating",
      library: true,
      defaultSize: { w: 140, h: 90 },
      ports: [
        { id: "suction", side: "left", u: 0, v: 0.5, kinds: ["process", "instrument"], role: "in", label: "Suction" },
        { id: "discharge", side: "right", u: 1, v: 0.5, kinds: ["process", "instrument"], role: "out", label: "Discharge" },
        { id: "drive", side: "bottom", u: 0.5, v: 1, kinds: ["mechanical"], role: "in", label: "Drive" }
      ],
      props: ["ratedGpm", "headM"],
      controlCaps: ["start", "stop", "fault_reset"],
      runtimeBindings: {
        running: { match: /Running|Energize/i, truthy: true },
        fault: { match: /Fault/i, truthy: true }
      },
      svgKey: "pump"
    }),
    def({
      id: "electric_motor",
      type: "motor",
      aliases: ["motor", "electric_motor"],
      label: "Electric motor",
      category: "electrical",
      library: true,
      defaultSize: { w: 130, h: 85 },
      ports: [
        { id: "shaft", side: "top", u: 0.5, v: 0, kinds: ["mechanical"], role: "out", label: "Shaft" },
        { id: "power", side: "left", u: 0, v: 0.45, kinds: ["electrical"], role: "in", label: "Power" },
        { id: "control", side: "left", u: 0, v: 0.65, kinds: ["control", "signal"], role: "in", label: "Control" }
      ],
      props: ["ratedKw", "voltage"],
      controlCaps: ["energize", "deenergize"],
      runtimeBindings: {
        running: { match: /Energize|Running/i, truthy: true },
        fault: { match: /Fault/i, truthy: true }
      },
      svgKey: "motor"
    }),
    def({
      id: "isolation_valve",
      type: "valve",
      aliases: ["valve", "isolation_valve", "gate_valve", "ball_valve"],
      label: "Isolation valve",
      category: "valve",
      library: true,
      defaultSize: { w: 120, h: 80 },
      ports: portsProcessLR([
        { id: "actuator", side: "top", u: 0.5, v: 0, kinds: ["control", "signal", "instrument"], role: "in", label: "Actuator" }
      ]),
      props: ["failPosition"],
      controlCaps: ["open", "close"],
      runtimeBindings: {
        valveOpen: { match: /OpenedFeedback/i, truthy: true },
        valveCmd: { match: /OpenCommand/i, truthy: true },
        fault: { match: /Fault/i, truthy: true }
      },
      svgKey: "valve"
    }),
    def({
      id: "control_valve",
      type: "control_valve",
      aliases: ["control_valve", "cv"],
      label: "Control valve",
      category: "valve",
      library: true,
      defaultSize: { w: 120, h: 80 },
      ports: portsProcessLR([
        { id: "actuator", side: "top", u: 0.5, v: 0, kinds: ["control", "signal", "instrument"], role: "in", label: "Actuator" }
      ]),
      props: ["cv"],
      controlCaps: ["modulate"],
      runtimeBindings: {
        valveOpen: { match: /OpenedFeedback|Position/i, truthy: true },
        valveCmd: { match: /OpenCommand|Setpoint/i, truthy: true }
      },
      svgKey: "control_valve"
    }),
    def({
      id: "check_valve",
      type: "check_valve",
      aliases: ["check_valve"],
      label: "Check valve",
      category: "valve",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: portsProcessLR(),
      props: [],
      controlCaps: [],
      runtimeBindings: {},
      svgKey: "check_valve"
    }),
    def({
      id: "butterfly_valve",
      type: "butterfly_valve",
      aliases: ["butterfly_valve"],
      label: "Butterfly valve",
      category: "valve",
      library: true,
      defaultSize: { w: 120, h: 80 },
      ports: portsProcessLR([
        { id: "actuator", side: "top", u: 0.5, v: 0, kinds: ["control", "signal"], role: "in", label: "Actuator" }
      ]),
      props: [],
      controlCaps: ["open", "close"],
      runtimeBindings: {
        valveOpen: { match: /OpenedFeedback/i, truthy: true },
        valveCmd: { match: /OpenCommand/i, truthy: true }
      },
      svgKey: "butterfly_valve"
    }),
    def({
      id: "storage_tank",
      type: "tank",
      aliases: ["tank", "storage_tank"],
      label: "Storage tank",
      category: "vessel",
      library: true,
      defaultSize: { w: 160, h: 110 },
      ports: [
        { id: "inlet", side: "left", u: 0, v: 0.55, kinds: ["process", "instrument"], role: "in", label: "Inlet" },
        { id: "outlet", side: "right", u: 1, v: 0.55, kinds: ["process", "instrument"], role: "out", label: "Outlet" },
        { id: "vent", side: "top", u: 0.5, v: 0, kinds: ["process"], role: "bidir", label: "Vent" },
        { id: "instrument", side: "top", u: 0.75, v: 0.1, kinds: ["instrument", "signal", "process"], role: "bidir", label: "Instrument" }
      ],
      props: ["heightM", "diameterM", "capacityM3", "initialLevelPct", "highAlarmPct"],
      controlCaps: [],
      runtimeBindings: {
        levelPct: { match: /LevelPct|Level\b/i, numeric: true },
        alarm: { match: /High|Alarm/i, truthy: true }
      },
      svgKey: "tank"
    }),
    def({
      id: "process_vessel",
      type: "vessel",
      aliases: ["vessel", "process_vessel"],
      label: "Process vessel",
      category: "vessel",
      library: true,
      defaultSize: { w: 150, h: 100 },
      ports: [
        { id: "inlet", side: "left", u: 0, v: 0.5, kinds: ["process"], role: "in", label: "Inlet" },
        { id: "outlet", side: "right", u: 1, v: 0.5, kinds: ["process"], role: "out", label: "Outlet" },
        { id: "vent", side: "top", u: 0.5, v: 0, kinds: ["process"], role: "bidir", label: "Vent" }
      ],
      props: ["volumeM3"],
      controlCaps: [],
      runtimeBindings: { levelPct: { match: /LevelPct|Level\b/i, numeric: true } },
      svgKey: "vessel"
    }),
    def({
      id: "mixer",
      type: "mixer",
      aliases: ["mixer", "agitator"],
      label: "Mixer / agitator",
      category: "rotating",
      library: true,
      defaultSize: { w: 140, h: 95 },
      ports: portsProcessLR([
        { id: "drive", side: "top", u: 0.5, v: 0, kinds: ["mechanical", "electrical"], role: "in", label: "Drive" }
      ]),
      props: [],
      controlCaps: ["start", "stop"],
      runtimeBindings: { running: { match: /Running|Energize/i, truthy: true } },
      svgKey: "mixer"
    }),
    def({
      id: "compressor",
      type: "compressor",
      aliases: ["compressor"],
      label: "Compressor",
      category: "rotating",
      library: true,
      defaultSize: { w: 140, h: 90 },
      ports: [
        { id: "suction", side: "left", u: 0, v: 0.65, kinds: ["process"], role: "in", label: "Suction" },
        { id: "discharge", side: "right", u: 1, v: 0.65, kinds: ["process"], role: "out", label: "Discharge" },
        { id: "drive", side: "bottom", u: 0.5, v: 1, kinds: ["mechanical"], role: "in", label: "Drive" }
      ],
      props: [],
      controlCaps: ["start", "stop"],
      runtimeBindings: { running: { match: /Running|Energize/i, truthy: true }, fault: { match: /Fault/i, truthy: true } },
      svgKey: "compressor"
    }),
    def({
      id: "blower",
      type: "blower",
      aliases: ["blower", "fan"],
      label: "Blower / fan",
      category: "rotating",
      library: true,
      defaultSize: { w: 140, h: 90 },
      ports: [
        { id: "suction", side: "left", u: 0, v: 0.5, kinds: ["process"], role: "in", label: "Inlet" },
        { id: "discharge", side: "right", u: 1, v: 0.5, kinds: ["process"], role: "out", label: "Outlet" },
        { id: "drive", side: "bottom", u: 0.5, v: 1, kinds: ["mechanical"], role: "in", label: "Drive" }
      ],
      props: [],
      controlCaps: ["start", "stop"],
      runtimeBindings: { running: { match: /Running|Energize/i, truthy: true } },
      svgKey: "blower"
    }),
    def({
      id: "heat_exchanger",
      type: "heat_exchanger",
      aliases: ["heat_exchanger", "hx", "exchanger"],
      label: "Heat exchanger",
      category: "thermal",
      library: true,
      defaultSize: { w: 150, h: 95 },
      ports: [
        { id: "process_in", side: "left", u: 0, v: 0.35, kinds: ["process"], role: "in", label: "Process in" },
        { id: "process_out", side: "right", u: 1, v: 0.35, kinds: ["process"], role: "out", label: "Process out" },
        { id: "utility_in", side: "left", u: 0, v: 0.7, kinds: ["process"], role: "in", label: "Utility in" },
        { id: "utility_out", side: "right", u: 1, v: 0.7, kinds: ["process"], role: "out", label: "Utility out" }
      ],
      props: [],
      controlCaps: [],
      runtimeBindings: { running: { match: /Flow|Active/i, truthy: true } },
      svgKey: "heat_exchanger"
    }),
    def({
      id: "level_transmitter",
      type: "level_transmitter",
      aliases: ["level_transmitter", "lt"],
      label: "Level transmitter",
      category: "instrument",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: [
        { id: "process", side: "bottom", u: 0.5, v: 1, kinds: ["process", "instrument"], role: "in", label: "Process" },
        { id: "signal", side: "top", u: 0.5, v: 0, kinds: ["signal", "instrument", "control"], role: "out", label: "Signal" }
      ],
      props: ["units"],
      controlCaps: [],
      runtimeBindings: {
        levelPct: { match: /LevelPct|Level|Value/i, numeric: true },
        alarm: { match: /High|Alarm/i, truthy: true }
      },
      svgKey: "level_transmitter"
    }),
    def({
      id: "flow_transmitter",
      type: "flow_transmitter",
      aliases: ["flow_transmitter", "ft", "fit"],
      label: "Flow transmitter",
      category: "instrument",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: [
        { id: "process", side: "bottom", u: 0.5, v: 1, kinds: ["process", "instrument"], role: "in", label: "Process" },
        { id: "signal", side: "top", u: 0.5, v: 0, kinds: ["signal", "instrument", "control"], role: "out", label: "Signal" }
      ],
      props: ["units"],
      controlCaps: [],
      runtimeBindings: { displayValue: { match: /FlowGpm|FlowRate|Flow\b/i, numeric: true } },
      svgKey: "flow_transmitter"
    }),
    def({
      id: "pressure_transmitter",
      type: "pressure_transmitter",
      aliases: ["pressure_transmitter", "pt", "pit"],
      label: "Pressure transmitter",
      category: "instrument",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: [
        { id: "process", side: "bottom", u: 0.5, v: 1, kinds: ["process", "instrument"], role: "in", label: "Process" },
        { id: "signal", side: "top", u: 0.5, v: 0, kinds: ["signal", "instrument", "control"], role: "out", label: "Signal" }
      ],
      props: ["units"],
      controlCaps: [],
      runtimeBindings: { displayValue: { match: /Pressure|Psi|Bar/i, numeric: true } },
      svgKey: "pressure_transmitter"
    }),
    def({
      id: "temperature_transmitter",
      type: "temperature_transmitter",
      aliases: ["temperature_transmitter", "tt", "tit"],
      label: "Temperature transmitter",
      category: "instrument",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: [
        { id: "process", side: "bottom", u: 0.5, v: 1, kinds: ["process", "instrument"], role: "in", label: "Process" },
        { id: "signal", side: "top", u: 0.5, v: 0, kinds: ["signal", "instrument", "control"], role: "out", label: "Signal" }
      ],
      props: ["units"],
      controlCaps: [],
      runtimeBindings: { displayValue: { match: /Temp|Temperature/i, numeric: true } },
      svgKey: "temperature_transmitter"
    }),
    def({
      id: "level_switch",
      type: "level_switch",
      aliases: ["level_switch", "lsh", "lsl"],
      label: "Level switch",
      category: "instrument",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: [
        { id: "process", side: "bottom", u: 0.5, v: 1, kinds: ["process", "instrument"], role: "in", label: "Process" },
        { id: "signal", side: "top", u: 0.5, v: 0, kinds: ["signal", "control"], role: "out", label: "Contact" }
      ],
      props: [],
      controlCaps: [],
      runtimeBindings: { active: { match: /High|Active|Tripped/i, truthy: true } },
      svgKey: "level_switch"
    }),
    def({
      id: "pressure_switch",
      type: "pressure_switch",
      aliases: ["pressure_switch", "psh", "psl"],
      label: "Pressure switch",
      category: "instrument",
      library: true,
      defaultSize: { w: 110, h: 75 },
      ports: [
        { id: "process", side: "bottom", u: 0.5, v: 1, kinds: ["process", "instrument"], role: "in", label: "Process" },
        { id: "signal", side: "top", u: 0.5, v: 0, kinds: ["signal", "control"], role: "out", label: "Contact" }
      ],
      props: [],
      controlCaps: [],
      runtimeBindings: { active: { match: /High|Active|Tripped/i, truthy: true } },
      svgKey: "pressure_switch"
    }),
    def({
      id: "emergency_stop",
      type: "emergency_stop_input",
      aliases: ["emergency_stop_input", "estop", "esd", "emergency_stop"],
      label: "E-stop (sim)",
      category: "safety",
      library: true,
      defaultSize: { w: 110, h: 80 },
      ports: [
        { id: "signal", side: "bottom", u: 0.5, v: 1, kinds: ["control", "signal", "electrical"], role: "out", label: "Contact" }
      ],
      props: [],
      controlCaps: ["simulate_trip", "simulate_reset"],
      runtimeBindings: {
        healthy: { match: /Healthy/i, truthy: true },
        active: { match: /Activated|Tripped/i, truthy: true }
      },
      svgKey: "emergency_stop_input",
      safetyNote: "Simulated model behavior only — not a certified physical safety function"
    })
  ];

  const byAlias = new Map();
  for (const e of REGISTRY) {
    byAlias.set(e.type.toLowerCase(), e);
    byAlias.set(e.id.toLowerCase(), e);
    for (const a of e.aliases || []) byAlias.set(String(a).toLowerCase(), e);
  }

  function resolve(type) {
    const key = String(type || "").toLowerCase().trim();
    if (byAlias.has(key)) return byAlias.get(key);
    for (const [k, e] of byAlias) {
      if (key.includes(k) || k.includes(key)) return e;
    }
    return null;
  }

  function libraryTypes() {
    return REGISTRY.filter((e) => e.library).map((e) => ({ type: e.type, label: e.label, category: e.category }));
  }

  function bindLive(entry, live) {
    const state = {
      running: false,
      fault: false,
      alarm: false,
      active: false,
      healthy: true,
      levelPct: null,
      displayValue: null,
      valveState: "closed"
    };
    if (!entry || !live) return state;
    const bindings = entry.runtimeBindings || {};
    const entries = Object.entries(live);

    function matchBinding(spec) {
      if (!spec?.match) return null;
      for (const [k, v] of entries) {
        if (spec.match.test(k)) return v;
      }
      return null;
    }

    if (bindings.running) {
      const v = matchBinding(bindings.running);
      state.running = bindings.running.truthy ? v === true : !!v;
    }
    if (bindings.fault) {
      const v = matchBinding(bindings.fault);
      state.fault = bindings.fault.truthy ? v === true : !!v;
    }
    if (bindings.alarm) {
      const v = matchBinding(bindings.alarm);
      state.alarm = bindings.alarm.truthy ? v === true : !!v;
    }
    if (bindings.active) {
      const v = matchBinding(bindings.active);
      state.active = bindings.active.truthy ? v === true : !!v;
    }
    if (bindings.healthy) {
      const v = matchBinding(bindings.healthy);
      if (v !== null) state.healthy = v === true;
    }
    if (bindings.levelPct) {
      const v = matchBinding(bindings.levelPct);
      if (v != null && Number.isFinite(Number(v))) state.levelPct = Number(v);
    }
    if (bindings.displayValue) {
      const v = matchBinding(bindings.displayValue);
      if (v != null && Number.isFinite(Number(v))) state.displayValue = Number(v).toFixed(1);
      else if (v != null) state.displayValue = String(v);
    }
    if (bindings.valveOpen || bindings.valveCmd) {
      const opened = bindings.valveOpen ? matchBinding(bindings.valveOpen) === true : false;
      const cmd = bindings.valveCmd ? matchBinding(bindings.valveCmd) === true : false;
      state.valveState = opened ? "open" : cmd ? "opening" : "closed";
    }
    return state;
  }

  function renderSymbol(type, mode, live) {
    const entry = resolve(type);
    const m = mode === "scada" ? "scada" : "pid";
    const state = bindLive(entry, live || {});
    const key = entry?.svgKey || "generic";
    const pack = svg()[key] || svg().generic;
    const fn = pack?.[m] || pack?.pid || svg().generic?.pid;
    return {
      entry,
      state,
      mode: m,
      html: typeof fn === "function" ? fn(state) : ""
    };
  }

  /** Port world position from node box + port def (u/v 0..1) */
  function portWorld(node, port) {
    const w = node.w || 140;
    const h = node.h || 80;
    return {
      x: node.x + (port.u != null ? port.u : 0.5) * w,
      y: node.y + (port.v != null ? port.v : 0.5) * h,
      id: port.id,
      kinds: port.kinds || [],
      role: port.role,
      label: port.label
    };
  }

  function portsFor(type) {
    return (resolve(type)?.ports || []).slice();
  }

  /**
   * Pick best ports for a connection kind between two nodes.
   * Returns { fromPortId, toPortId, valid, reason }
   */
  function pickPorts(fromNode, toNode, connectionType) {
    const kind = String(connectionType || "process").toLowerCase();
    const kindAliases = {
      process: ["process"],
      instrument: ["instrument", "signal"],
      signal: ["signal", "instrument", "control"],
      control: ["control", "signal"],
      mechanical: ["mechanical"],
      electrical: ["electrical"],
      communication: ["signal", "control"]
    };
    const want = kindAliases[kind] || [kind];
    const fromPorts = portsFor(fromNode.type);
    const toPorts = portsFor(toNode.type);

    function compatible(p, asFrom) {
      const kinds = p.kinds || [];
      if (!want.some((k) => kinds.includes(k))) return false;
      if (asFrom && p.role === "in") return false;
      if (!asFrom && p.role === "out") return false;
      return true;
    }

    const candidatesFrom = fromPorts.filter((p) => compatible(p, true));
    const candidatesTo = toPorts.filter((p) => compatible(p, false));
    const fList = candidatesFrom.length ? candidatesFrom : fromPorts;
    const tList = candidatesTo.length ? candidatesTo : toPorts;

    let best = null;
    let bestDist = Infinity;
    for (const fp of fList) {
      const a = portWorld(fromNode, fp);
      for (const tp of tList) {
        const b = portWorld(toNode, tp);
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = { fromPortId: fp.id, toPortId: tp.id, fromPort: fp, toPort: tp };
        }
      }
    }

    const valid =
      !!best &&
      candidatesFrom.some((p) => p.id === best.fromPortId) &&
      candidatesTo.some((p) => p.id === best.toPortId);

    return {
      fromPortId: best?.fromPortId || null,
      toPortId: best?.toPortId || null,
      valid,
      reason: valid
        ? null
        : `No compatible ${kind} ports between ${fromNode.tag || fromNode.type} and ${toNode.tag || toNode.type}`
    };
  }

  function linkEndpoints(link, fromNode, toNode) {
    const fromPorts = portsFor(fromNode.type);
    const toPorts = portsFor(toNode.type);
    const fp = fromPorts.find((p) => p.id === link.fromPort) || fromPorts.find((p) => p.id === link.fromPortId);
    const tp = toPorts.find((p) => p.id === link.toPort) || toPorts.find((p) => p.id === link.toPortId);
    const a = fp
      ? portWorld(fromNode, fp)
      : { x: fromNode.x + (fromNode.w || 140) / 2, y: fromNode.y + (fromNode.h || 80) / 2 };
    const b = tp
      ? portWorld(toNode, tp)
      : { x: toNode.x + (toNode.w || 140) / 2, y: toNode.y + (toNode.h || 80) / 2 };
    const kind = String(link.type || "process").toLowerCase();
    let invalid = !!link.invalid;
    if (fp && tp) {
      const pick = pickPorts(fromNode, toNode, kind);
      // Re-validate stored ports against kind
      const fOk = (fp.kinds || []).some((k) =>
        kind === "process"
          ? k === "process"
          : kind === "mechanical"
            ? k === "mechanical"
            : kind === "electrical"
              ? k === "electrical"
              : ["instrument", "signal", "control"].includes(k)
      );
      const tOk = (tp.kinds || []).some((k) =>
        kind === "process"
          ? k === "process"
          : kind === "mechanical"
            ? k === "mechanical"
            : kind === "electrical"
              ? k === "electrical"
              : ["instrument", "signal", "control"].includes(k)
      );
      invalid = !(fOk && tOk);
      if (!invalid && pick.reason && (!pick.valid)) {
        /* keep stored if kinds match */
      }
    }
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, invalid };
  }

  P6.registry = REGISTRY;
  P6.resolve = resolve;
  P6.libraryTypes = libraryTypes;
  P6.bindLive = bindLive;
  P6.renderSymbol = renderSymbol;
  P6.portWorld = portWorld;
  P6.portsFor = portsFor;
  P6.pickPorts = pickPorts;
  P6.linkEndpoints = linkEndpoints;
})(typeof window !== "undefined" ? window : globalThis);
