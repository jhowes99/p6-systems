function exprToST(expr) {
  if (!expr) return "FALSE";
  if (expr.var) return expr.var;
  if (expr.op === "NOT") return `NOT (${exprToST(expr.x)})`;
  if (expr.op === "AND") return `(${exprToST(expr.a)}) AND (${exprToST(expr.b)})`;
  if (expr.op === "OR") return `(${exprToST(expr.a)}) OR (${exprToST(expr.b)})`;
  if (expr.op === "PY_CALL") return `PY_CALL('${expr.fn}', ...)`; // placeholder
  if (expr.op === "PY_FB") return `PY_FB('${expr.fb}', '${expr.inst}').${expr.out}`; // placeholder
  return "FALSE";
}

export function ladderIRToST(ir) {
  const lines = [];
  lines.push("(* Generated from Ladder IR by P6 Systems *)");
  lines.push("");
  lines.push("PROGRAM MAIN");
  lines.push("VAR");
  lines.push("  (* declare vars in your target PLC as needed *)");
  lines.push("END_VAR");
  lines.push("");

  for (const net of ir.networks ?? []) {
    for (const rung of net.rungs ?? []) {
      const cond = exprToST(rung.cond);
      for (const act of rung.actions ?? []) {
        if (act.type === "COIL") {
          lines.push(`${act.target} := ${cond};`);
        } else if (act.type === "SET") {
          lines.push(`IF ${cond} THEN ${act.target} := TRUE; END_IF;`);
        } else if (act.type === "RESET") {
          lines.push(`IF ${cond} THEN ${act.target} := FALSE; END_IF;`);
        } else if (act.type === "TON") {
          // IEC-ish style example
          lines.push(`(* TON ${act.name} preset ${act.presetMs}ms enable: ${cond} *)`);
          if (act.doneTarget) {
            lines.push(`${act.doneTarget} := ${cond}; (* wire ${act.name}.Q in your target PLC *)`);
          }
        }
      }
      lines.push("");
    }
  }

  lines.push("END_PROGRAM");
  return lines.join("\n");
}
