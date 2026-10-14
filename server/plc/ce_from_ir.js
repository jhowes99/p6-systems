/**
 * Derive Cause & Effect rules from ladder IR.
 * Scans each rung: condition inputs (I*, M*) → causes, coil targets (Q*, M*) → effects.
 * Uses ioMap (tag -> address) to map addresses back to tag names for fluid C&E.
 */

/**
 * Collect all variable names referenced in a condition expression.
 * @param {object} expr - Boolean expression tree { var, op, a, b, x }
 * @returns {string[]}
 */
function varsInExpr(expr) {
  if (!expr) return [];
  if (expr.var) return [expr.var];
  if (expr.op === "NOT" && expr.x) return varsInExpr(expr.x);
  if (expr.op === "AND" || expr.op === "OR") {
    return [...varsInExpr(expr.a), ...varsInExpr(expr.b)];
  }
  return [];
}

/**
 * Derive C&E rules from ladder IR.
 * One rule per rung: causes = input vars (I*, M*) in condition, effects = output vars (Q*, M*) in COIL/SET/RESET.
 * @param {{ ir: { networks?: Array<{ rungs?: Array }>, ioMap?: Record<string,string> }, ioMap?: Record<string,string> }} opts
 * @returns {{ causeEffectRules: Array<{ causes: string[], effects: string[] }>, skipped: number }}
 */
export function deriveCauseEffectFromIR({ ir, ioMap: ioMapIn }) {
  const ioMap = ioMapIn || ir?.ioMap || {};
  const addrToTag = {};
  for (const [tag, addr] of Object.entries(ioMap)) {
    if (tag && addr) addrToTag[String(addr)] = tag;
  }

  const causeEffectRules = [];
  let skipped = 0;

  for (const net of ir?.networks ?? []) {
    for (const rung of net.rungs ?? []) {
      const condVars = varsInExpr(rung.cond);
      const inputVars = condVars.filter((v) => v.startsWith("I") || v.startsWith("M"));
      const effectAddrs = [];
      for (const act of rung.actions ?? []) {
        if ((act.type === "COIL" || act.type === "SET" || act.type === "RESET") && act.target) {
          if (act.target.startsWith("Q") || act.target.startsWith("M")) effectAddrs.push(act.target);
        }
      }

      const causes = [...new Set(inputVars.map((addr) => addrToTag[addr]).filter(Boolean))];
      const effects = [...new Set(effectAddrs.map((addr) => addrToTag[addr]).filter(Boolean))];

      if (causes.length && effects.length) {
        causeEffectRules.push({ causes, effects });
      } else {
        skipped += 1;
      }
    }
  }

  return { causeEffectRules, skipped };
}
