// Pure-ish evaluator for Ladder IR in a single scan (boolean-only model).
// Used by truth tables, fault explanations, and UI previews.

function resolveVar(name, snap) {
  const bank = name?.[0];
  if (bank === "I") return !!snap.inputs?.[name];
  if (bank === "Q") return !!snap.outputs?.[name];
  if (bank === "M") return !!snap.mem?.[name];
  if (bank === "A") return Number(snap.analogInputs?.[name]) ?? 0;
  if (bank === "B") return Number(snap.analogOutputs?.[name]) ?? 0;
  return false;
}

function evalNumTermLocal(term, snap) {
  if (!term) return 0;
  if (term.const !== undefined) return Number(term.const);
  if (term.var) return Number(resolveVar(term.var, snap));
  return 0;
}

export function evalBoolExprLocal(expr, snap) {
  if (!expr) return false;
  if (typeof expr === "boolean") return !!expr;
  if (expr.var) {
    const v = resolveVar(expr.var, snap);
    return typeof v === "number" ? v !== 0 : !!v;
  }
  if (expr.op === "NOT") return !evalBoolExprLocal(expr.x, snap);
  if (expr.op === "AND") return evalBoolExprLocal(expr.a, snap) && evalBoolExprLocal(expr.b, snap);
  if (expr.op === "OR") return evalBoolExprLocal(expr.a, snap) || evalBoolExprLocal(expr.b, snap);
  if (["GT", "GE", "LT", "LE", "EQ", "NE"].includes(expr.op)) {
    const a = evalNumTermLocal(expr.a || expr.left, snap);
    const b = evalNumTermLocal(expr.b || expr.right || expr.const, snap);
    switch (expr.op) {
      case "GT": return a > b;
      case "GE": return a >= b;
      case "LT": return a < b;
      case "LE": return a <= b;
      case "EQ": return a === b;
      case "NE": return a !== b;
      default: return false;
    }
  }
  return false;
}

export function execLadderOneScan(ir, snap) {
  // Shallow clone so we can mutate Q/M during evaluation like a scan.
  const s = {
    inputs: { ...(snap.inputs || {}) },
    outputs: { ...(snap.outputs || {}) },
    mem: { ...(snap.mem || {}) }
  };

  for (const net of ir?.networks ?? []) {
    for (const rung of net?.rungs ?? []) {
      const power = evalBoolExprLocal(rung.cond, s);
      for (const act of rung.actions ?? []) {
        if (act.type === "COIL") {
          if (act.target?.[0] === "Q") s.outputs[act.target] = !!power;
          else if (act.target?.[0] === "M") s.mem[act.target] = !!power;
        } else if (act.type === "SET") {
          if (power) {
            if (act.target?.[0] === "Q") s.outputs[act.target] = true;
            else if (act.target?.[0] === "M") s.mem[act.target] = true;
          }
        } else if (act.type === "RESET") {
          if (power) {
            if (act.target?.[0] === "Q") s.outputs[act.target] = false;
            else if (act.target?.[0] === "M") s.mem[act.target] = false;
          }
        } else if (act.type === "TON") {
          // Skip TON timing in truth tables (treat as immediate false) — timeline compiler emits M bits anyway.
          if (act.doneTarget) {
            if (act.doneTarget?.[0] === "Q") s.outputs[act.doneTarget] = false;
            else if (act.doneTarget?.[0] === "M") s.mem[act.doneTarget] = false;
          }
        }
      }
    }
  }

  return s;
}

