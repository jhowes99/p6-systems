import { execLadderOneScan } from "./ir_eval.js";

function bin(i, n) {
  return i.toString(2).padStart(n, "0");
}

export function generateTruthTable(ir, { inputVars = [], outputVars = [] }, baseSnap) {
  const inputs = [...inputVars];
  const outputs = [...outputVars];
  const n = inputs.length;
  const rows = [];

  const base = baseSnap || { inputs: {}, outputs: {}, mem: {} };

  for (let i = 0; i < (1 << n); i++) {
    const bits = bin(i, n);
    const snap = {
      inputs: { ...(base.inputs || {}) },
      outputs: { ...(base.outputs || {}) },
      mem: { ...(base.mem || {}) }
    };
    inputs.forEach((v, idx) => { snap.inputs[v] = bits[idx] === "1"; });
    const outSnap = execLadderOneScan(ir, snap);
    rows.push({
      inputs: Object.fromEntries(inputs.map(v => [v, !!snap.inputs[v]])),
      outputs: Object.fromEntries(outputs.map(v => [v, !!outSnap.outputs?.[v] || !!outSnap.mem?.[v]]))
    });
  }

  return { inputs, outputs, rows };
}

