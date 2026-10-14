/**
 * Reason tree: trace boolean expression to show which branch is true/false (AND/OR/NOT).
 * node = { type, value, text, children? }
 */

import { evalBoolExprLocal } from "./ir_eval.js";

function resolveVarSnap(name, snap) {
  const bank = name?.[0];
  if (bank === "I") return !!snap.inputs?.[name];
  if (bank === "Q") return !!snap.outputs?.[name];
  if (bank === "M") return !!snap.mem?.[name];
  if (bank === "A") return Number(snap.analogInputs?.[name]) ?? 0;
  return false;
}

function evalNumTerm(term, snap) {
  if (!term) return 0;
  if (term.const !== undefined) return Number(term.const);
  if (term.var) return resolveVarSnap(term.var, snap);
  return 0;
}

/**
 * Trace a boolean expression into a tree node (for explanation UI).
 * Supports VAR, AND, OR, NOT, CONST, and comparator nodes (GT, GE, LT, LE, EQ, NE).
 * @param {object} expr - IR expression node
 * @param {object} snap - Snapshot { inputs, outputs, mem, analogInputs? }
 * @returns {{ type: string, value: boolean, text: string, children?: array }}
 */
export function traceBoolExpr(expr, snap) {
  if (!expr) {
    return { type: "CONST", value: false, text: "FALSE" };
  }
  if (typeof expr === "boolean") {
    return { type: "CONST", value: !!expr, text: expr ? "TRUE" : "FALSE" };
  }
  if (expr.var) {
    const v = expr.var;
    const val = v[0] === "A" ? !!resolveVarSnap(v, snap) : !!resolveVarSnap(v, snap);
    // For analog we still treat as boolean in ladder context (comparator result)
    const numVal = v[0] === "A" ? resolveVarSnap(v, snap) : null;
    const text = numVal != null && v[0] === "A" ? `${v}=${numVal}` : v;
    return { type: "VAR", value: !!resolveVarSnap(v, snap), text: String(text) };
  }
  if (expr.op === "NOT") {
    const child = traceBoolExpr(expr.x, snap);
    const value = !child.value;
    return {
      type: "NOT",
      value,
      text: value ? "NOT (satisfied)" : "NOT (blocking)",
      children: [child]
    };
  }
  if (expr.op === "AND") {
    const a = traceBoolExpr(expr.a, snap);
    const b = traceBoolExpr(expr.b, snap);
    const value = a.value && b.value;
    const firstFalse = !a.value ? a : !b.value ? b : null;
    return {
      type: "AND",
      value,
      text: value ? "AND (all true)" : (firstFalse ? `AND blocked by: ${firstFalse.text}` : "AND (false)"),
      children: [a, b]
    };
  }
  if (expr.op === "OR") {
    const a = traceBoolExpr(expr.a, snap);
    const b = traceBoolExpr(expr.b, snap);
    const value = a.value || b.value;
    const which = a.value ? "left branch true" : b.value ? "right branch true" : "all branches false";
    return {
      type: "OR",
      value,
      text: value ? `OR (${which})` : "OR (all branches false)",
      children: [a, b]
    };
  }
  if (["GT", "GE", "LT", "LE", "EQ", "NE"].includes(expr.op)) {
    const left = evalNumTerm(expr.a || expr.left, snap);
    const right = evalNumTerm(expr.b || expr.right || expr.const, snap);
    let value = false;
    switch (expr.op) {
      case "GT": value = left > right; break;
      case "GE": value = left >= right; break;
      case "LT": value = left < right; break;
      case "LE": value = left <= right; break;
      case "EQ": value = left === right; break;
      case "NE": value = left !== right; break;
      default: break;
    }
    const text = `${left} ${expr.op} ${right} = ${value}`;
    return { type: "CMP", value, text, children: [] };
  }
  return { type: "CONST", value: false, text: "unknown" };
}
