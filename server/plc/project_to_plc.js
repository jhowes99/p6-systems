import { normalizeTag } from "./doc_normalize.js";

function andExpr(exprs) {
  const xs = exprs.filter(Boolean);
  if (xs.length === 0) return false;
  return xs.reduce((a, b) => (a ? { op: "AND", a, b } : b), null);
}

function orExpr(exprs) {
  const xs = exprs.filter(Boolean);
  if (xs.length === 0) return false;
  return xs.reduce((a, b) => (a ? { op: "OR", a, b } : b), null);
}

export function generatePLCFromProject({ pidElements, ioListEntries = [], causeEffectRules = [] }) {
  const rungs = [];
  const ioMap = new Map(); // signalName -> I/Q/M address
  const warnings = [];

  let inIdx = 0;
  let outIdx = 0;
  let memIdx = 0;
  let aiIdx = 0;
  let aoIdx = 0;

  const allocI = () => `I${inIdx++}`;
  const allocQ = () => `Q${outIdx++}`;
  const allocM = () => `M${memIdx++}`;
  const allocA = () => `A${aiIdx++}`;
  const allocB = () => `B${aoIdx++}`;

  function mapSignal(signal, preferredBank) {
    const key = String(signal);
    if (ioMap.has(key)) return ioMap.get(key);
    let addr;
    if (preferredBank === "Q") addr = allocQ();
    else if (preferredBank === "I") addr = allocI();
    else if (preferredBank === "A") addr = allocA();
    else if (preferredBank === "B") addr = allocB();
    else addr = allocM();
    ioMap.set(key, addr);
    return addr;
  }

  // 1) Use I/O list to map physical tags to addresses.
  for (const e of ioListEntries) {
    const tag = normalizeTag(e.tag);
    if (!tag) continue;
    const ioType = String(e.ioType || "").toUpperCase().replace(/\s/g, "");

    if (ioType === "DI") mapSignal(tag, "I");
    else if (ioType === "DO") mapSignal(tag, "Q");
    else if (ioType === "AI") mapSignal(tag, "A");
    else if (ioType === "AO") mapSignal(tag, "B");
  }

  // Helper: resolve tag to an expression var
  function varForTag(tag) {
    const t = normalizeTag(tag);
    // If not present in IO list, default to DI-like input for causes, DO-like output for effects later.
    return ioMap.get(t) || mapSignal(t, "I");
  }

  function outputForTag(tag) {
    const t = normalizeTag(tag);
    return ioMap.get(t) || mapSignal(t, "Q");
  }

  // 2) Cause & Effect rules: causes -> effects (supports causeGroups for OR-of-ANDs when merging same effect)
  for (const rule of causeEffectRules) {
    let cond;
    if (Array.isArray(rule.causeGroups) && rule.causeGroups.length > 0) {
      const andGroups = rule.causeGroups.map((group) => andExpr((group || []).map(varForTag).map((v) => ({ var: v }))));
      cond = orExpr(andGroups);
    } else {
      const causes = (rule.causes || []).map(varForTag).map((v) => ({ var: v }));
      cond = andExpr(causes);
    }
    if (!cond) continue;
    for (const effRaw of rule.effects || []) {
      const effAddr = outputForTag(effRaw);
      rungs.push({
        cond,
        actions: [{ type: "COIL", target: effAddr }]
      });
    }
  }

  // 3) Optional: generate simple valve/pump scaffolding from P&ID, but prefer IO list tags if present.
  for (const valve of pidElements?.valves || []) {
    const tag = normalizeTag(valve.tag);
    if (!tag) continue;
    // If we already have a DO for the valve tag, we can generate simple "command" inputs.
    const out = outputForTag(tag);
    const openCmd = mapSignal(`${tag}_OPEN`, "I");
    const closeCmd = mapSignal(`${tag}_CLOSE`, "I");
    const state = mapSignal(`${tag}_STATE`, "M");

    rungs.push({
      cond: { op: "OR", a: { var: openCmd }, b: { op: "AND", a: { var: state }, b: { op: "NOT", x: { var: closeCmd } } } },
      actions: [{ type: "COIL", target: state }, { type: "COIL", target: out }]
    });
    rungs.push({
      cond: { var: closeCmd },
      actions: [{ type: "RESET", target: state }, { type: "RESET", target: out }]
    });
  }

  for (const pump of pidElements?.pumps || []) {
    const tag = normalizeTag(pump.tag);
    if (!tag) continue;
    const out = outputForTag(tag);
    const start = mapSignal(`${tag}_START`, "I");
    const stop = mapSignal(`${tag}_STOP`, "I");
    const state = mapSignal(`${tag}_STATE`, "M");

    rungs.push({
      cond: { op: "OR", a: { var: start }, b: { op: "AND", a: { var: state }, b: { op: "NOT", x: { var: stop } } } },
      actions: [{ type: "COIL", target: state }, { type: "COIL", target: out }]
    });
    rungs.push({
      cond: { var: stop },
      actions: [{ type: "RESET", target: state }, { type: "RESET", target: out }]
    });
  }

  return {
    ir: {
      language: "ladder",
      networks: [{ rungs }],
      ioMap: Object.fromEntries(ioMap),
      metadata: {
        generatedFrom: "pid+io+cause_effect",
        warnings
      }
    },
    ioMap: Object.fromEntries(ioMap),
    warnings
  };
}

