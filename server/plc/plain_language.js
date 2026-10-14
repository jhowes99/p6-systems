import { enforceSafetyDefaults } from "./safety.js";

// Plain language rules model (v0):
// {
//   tags: { [tagName]: { kind: "DI"|"DO", label?: string } },
//   rules: [
//     { whenAll: ["Start Button", "E-Stop OK", "Overload OK"], then: [{ tag: "Motor", action: "ON" }] }
//   ]
// }

function andChain(exprs) {
  const xs = exprs.filter(Boolean);
  if (!xs.length) return false;
  return xs.reduce((a, b) => (a ? { op: "AND", a, b } : b), null);
}

export function compilePlainLanguageToIR(model) {
  if (!model || typeof model !== "object") throw new Error("Missing model");
  if (!Array.isArray(model.rules) || model.rules.length === 0) throw new Error("No rules provided");

  const ioMap = new Map(); // tag -> address
  let iIdx = 0, qIdx = 0, mIdx = 0;
  const allocI = () => `I${iIdx++}`;
  const allocQ = () => `Q${qIdx++}`;
  const allocM = () => `M${mIdx++}`;

  const tagMeta = model.tags || {};
  function addrForTag(tag, defaultKind) {
    const t = String(tag);
    if (ioMap.has(t)) return ioMap.get(t);
    const kind = tagMeta?.[t]?.kind || defaultKind;
    const addr = kind === "DO" ? allocQ() : kind === "DI" ? allocI() : allocM();
    ioMap.set(t, addr);
    return addr;
  }

  const rungs = [];
  for (const rule of model.rules) {
    const cond = andChain((rule.whenAll || []).map(t => ({ var: addrForTag(t, "DI") })));
    for (const eff of rule.then || []) {
      const outAddr = addrForTag(eff.tag, "DO");
      rungs.push({ cond, actions: [{ type: "COIL", target: outAddr }] });
    }
  }

  const ir = {
    language: "ladder",
    networks: [{ rungs }],
    ioMap: Object.fromEntries(ioMap),
    metadata: { generatedFrom: "plain_language", tags: tagMeta }
  };

  const safe = enforceSafetyDefaults(ir);
  safe.ir.metadata = safe.ir.metadata || {};
  safe.ir.metadata.warnings = [...(safe.ir.metadata.warnings || []), ...(safe.warnings || [])];
  return safe.ir;
}

