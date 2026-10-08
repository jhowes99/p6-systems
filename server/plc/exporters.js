import { ladderIRToST } from "./st_export.js";

export function exportCodesysST(ir) {
  // IEC ST is close enough; reuse existing exporter.
  return ladderIRToST(ir);
}

export function exportPython(ir) {
  // MVP: Export a pure-Python scan() function from Ladder IR.
  // Notes:
  // - Uses the IR variable names (I0, Q0, M0, ...) as keys.
  // - Keeps PY_CALL / PY_FB as placeholders so projects that used them still export.
  const ioMap = ir?.ioMap || {};
  const tags = ir?.metadata?.tags || {};

  const rungs = [];
  for (const net of ir?.networks ?? []) for (const rung of net?.rungs ?? []) rungs.push(rung);

  const lines = [];
  lines.push(`# Generated from Ladder IR by Axiom Control`);
  lines.push(`#`);
  lines.push(`# Tag -> Address mapping (from the builder):`);
  for (const [tag, addr] of Object.entries(ioMap)) {
    const label = tags?.[tag]?.label ? ` (${tags[tag].label})` : "";
    lines.push(`# - ${tag} -> ${addr}${label}`);
  }
  lines.push(`#`);
  lines.push(`from __future__ import annotations`);
  lines.push(`from typing import Dict, Any`);
  lines.push(``);
  lines.push(`def _b(v: Any) -> bool:`);
  lines.push(`    return bool(v)`);
  lines.push(``);
  lines.push(`def scan(inputs: Dict[str, Any], memory: Dict[str, Any] | None = None) -> Dict[str, bool]:`);
  lines.push(`    """`);
  lines.push(`    One PLC scan.`);
  lines.push(``);
  lines.push(`    - inputs: dict keyed by addresses like "I0", "I1" ...`);
  lines.push(`    - memory: optional dict for M bits/timers (reserved for future)`);
  lines.push(`    Returns outputs dict keyed by "Q0", "Q1" ...`);
  lines.push(`    """`);
  lines.push(`    if memory is None:`);
  lines.push(`        memory = {}`);
  lines.push(``);
  lines.push(`    # Read inputs/memory with safe defaults`);
  lines.push(`    def V(name: str) -> bool:`);
  lines.push(`        if name.startswith("I"):`);
  lines.push(`            return _b(inputs.get(name, False))`);
  lines.push(`        return _b(memory.get(name, False))`);
  lines.push(``);
  lines.push(`    outputs: Dict[str, bool] = {}`);
  lines.push(``);

  rungs.forEach((rung, idx) => {
    const cond = exprToPy(rung.cond);
    const actions = rung.actions || [];
    lines.push(`    # Rung ${idx + 1}`);
    for (const act of actions) {
      if (act.type === "COIL") {
        lines.push(`    outputs["${act.target}"] = (${cond})`);
      } else if (act.type === "SET") {
        lines.push(`    if (${cond}):`);
        lines.push(`        outputs["${act.target}"] = True`);
      } else if (act.type === "RESET") {
        lines.push(`    if (${cond}):`);
        lines.push(`        outputs["${act.target}"] = False`);
      } else if (act.type === "TON") {
        // Placeholder (timers require scan time + state)
        lines.push(`    # TON ${act.name} preset ${act.presetMs}ms enable: (${cond})`);
        if (act.doneTarget) {
          lines.push(`    # outputs["${act.doneTarget}"] = (${cond})  # wire ${act.name}.Q in your target runtime`);
        }
      } else {
        lines.push(`    # Unsupported action type: ${String(act.type)}`);
      }
    }
    lines.push(``);
  });

  lines.push(`    return outputs`);
  lines.push(``);
  return lines.join("\n");
}

export function exportSiemensSCL(ir) {
  // Siemens SCL-like wrapper around ST-style assignments.
  const st = ladderIRToST(ir);
  const lines = [];
  lines.push("(* Siemens SCL export (MVP) *)");
  lines.push("FUNCTION_BLOCK FB_Axiom");
  lines.push("VAR");
  lines.push("  (* Map tags/IO in TIA Portal as needed *)");
  lines.push("END_VAR");
  lines.push("");
  lines.push("BEGIN");
  lines.push("  (* Logic generated from Ladder IR *)");
  for (const l of st.split("\n")) {
    if (l.startsWith("PROGRAM ") || l.startsWith("END_PROGRAM")) continue;
    if (l.trim() === "") continue;
    lines.push("  " + l);
  }
  lines.push("END_FUNCTION_BLOCK");
  return lines.join("\n");
}

export function exportAllenBradleyPlaceholder(ir) {
  // Full L5X generation is non-trivial; provide an MVP export bundle:
  // - Tag list from ioMap
  // - Human-readable rung summaries
  const ioMap = ir?.ioMap || {};
  const tagLines = ["Tag,Address"];
  for (const [tag, addr] of Object.entries(ioMap)) {
    tagLines.push(`${csv(tag)},${csv(addr)}`);
  }

  const rungs = [];
  for (const net of ir?.networks ?? []) for (const rung of net?.rungs ?? []) rungs.push(rung);
  const rungLines = ["Rung,Condition,Actions"];
  rungs.forEach((r, idx) => {
    rungLines.push(`${idx + 1},${csv(exprToText(r.cond))},${csv((r.actions || []).map(a => `${a.type}:${a.target || ""}`).join(" "))}`);
  });

  return {
    type: "ab_placeholder",
    files: [
      { name: "tags.csv", contentType: "text/csv", content: tagLines.join("\n") },
      { name: "rungs.csv", contentType: "text/csv", content: rungLines.join("\n") }
    ]
  };
}

function csv(s) {
  const t = String(s ?? "");
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function exprToText(expr) {
  if (!expr) return "FALSE";
  if (typeof expr === "boolean") return expr ? "TRUE" : "FALSE";
  if (expr.var) return expr.var;
  if (expr.op === "NOT") return `NOT(${exprToText(expr.x)})`;
  if (expr.op === "AND") return `(${exprToText(expr.a)}) AND (${exprToText(expr.b)})`;
  if (expr.op === "OR") return `(${exprToText(expr.a)}) OR (${exprToText(expr.b)})`;
  return "FALSE";
}

function exprToPy(expr) {
  if (!expr) return "False";
  if (typeof expr === "boolean") return expr ? "True" : "False";
  if (expr.var) return `V("${expr.var}")`;
  if (expr.op === "NOT") return `(not (${exprToPy(expr.x)}))`;
  if (expr.op === "AND") return `((${exprToPy(expr.a)}) and (${exprToPy(expr.b)}))`;
  if (expr.op === "OR") return `((${exprToPy(expr.a)}) or (${exprToPy(expr.b)}))`;
  if (expr.op === "PY_CALL") return `False  # PY_CALL('${expr.fn}', ...) placeholder`;
  if (expr.op === "PY_FB") return `False  # PY_FB('${expr.fb}', '${expr.inst}').${expr.out} placeholder`;
  return "False";
}

