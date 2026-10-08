import { enforceSafetyDefaults } from "./safety.js";

// Panel Builder model (v0):
// {
//   name: string,
//   tags: { [tagName]: { kind: "DI"|"DO", label?: string } },
//   rungs: [
//     // v1 supports parallel branches:
//     // { branches: [ [{tag,type}...], [{tag,type}...] ], coil: { tag, action } }
//     // v0 compatibility: { contacts: [...] } is treated as one branch
//   ]
// }

function andChain(exprs) {
  const xs = exprs.filter(Boolean);
  if (!xs.length) return false;
  return xs.reduce((a, b) => (a ? { op: "AND", a, b } : b), null);
}

function orChain(exprs) {
  const xs = exprs.filter(Boolean);
  if (!xs.length) return false;
  return xs.reduce((a, b) => (a ? { op: "OR", a, b } : b), null);
}

export function validatePanel(panel) {
  const errors = [];
  if (!panel || typeof panel !== "object") return { ok: false, errors: ["Missing panel"] };
  if (!Array.isArray(panel.rungs) || panel.rungs.length === 0) errors.push("No rungs defined.");
  for (const [i, r] of (panel.rungs || []).entries()) {
    if (!r.coil?.tag) errors.push(`Rung ${i + 1}: missing coil tag.`);
    const branches = Array.isArray(r.branches) ? r.branches : (Array.isArray(r.contacts) ? [r.contacts] : []);
    if (!branches.length) errors.push(`Rung ${i + 1}: missing branches/contacts.`);
    branches.forEach((b, bi) => {
      if (!Array.isArray(b) || b.length === 0) errors.push(`Rung ${i + 1} Branch ${bi + 1}: no contacts.`);
      b.forEach((c, ci) => {
        if (!c?.tag) errors.push(`Rung ${i + 1} Branch ${bi + 1} Contact ${ci + 1}: missing tag.`);
        const t = String(c?.type || "").toUpperCase();
        if (t !== "NO" && t !== "NC") errors.push(`Rung ${i + 1} Branch ${bi + 1} Contact ${ci + 1}: type must be NO/NC.`);
      });
    });
  }
  return { ok: errors.length === 0, errors };
}

export function compilePanelToLadderIR(panel) {
  const v = validatePanel(panel);
  if (!v.ok) throw new Error(v.errors.join(" "));

  // Address allocation: tags in UI -> I/Q addresses in runtime
  const ioMap = new Map(); // tag -> address
  let iIdx = 0, qIdx = 0, mIdx = 0;
  const allocI = () => `I${iIdx++}`;
  const allocQ = () => `Q${qIdx++}`;
  const allocM = () => `M${mIdx++}`;

  const tagMeta = panel.tags || {};
  function addrForTag(tag, defaultKind) {
    const t = String(tag);
    if (ioMap.has(t)) return ioMap.get(t);
    const kind = tagMeta?.[t]?.kind || defaultKind;
    const addr = kind === "DO" ? allocQ() : kind === "DI" ? allocI() : allocM();
    ioMap.set(t, addr);
    return addr;
  }

  const rungs = [];
  for (const r of panel.rungs) {
    const branches = Array.isArray(r.branches) ? r.branches : (Array.isArray(r.contacts) ? [r.contacts] : []);
    const branchExprs = branches.map(branch => {
      const condParts = (branch || []).map(c => {
        const addr = addrForTag(c.tag, "DI");
        if (String(c.type).toUpperCase() === "NC") return { op: "NOT", x: { var: addr } };
        return { var: addr };
      });
      return andChain(condParts);
    });
    const cond = orChain(branchExprs);
    const coilAddr = addrForTag(r.coil.tag, "DO");
    rungs.push({ cond, actions: [{ type: "COIL", target: coilAddr }] });
  }

  const ir = {
    language: "ladder",
    networks: [{ rungs }],
    ioMap: Object.fromEntries(ioMap),
    metadata: {
      generatedFrom: "panel_builder",
      tags: tagMeta
    }
  };

  const safe = enforceSafetyDefaults(ir);
  // carry warnings into metadata for UI
  safe.ir.metadata = safe.ir.metadata || {};
  safe.ir.metadata.warnings = [...(safe.ir.metadata.warnings || []), ...(safe.warnings || [])];

  return safe.ir;
}

