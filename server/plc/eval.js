export function resolveVar(name, ctx) {
  const bank = name[0];
  if (bank === "I") return !!ctx.I[name];
  if (bank === "Q") return !!ctx.Q[name];
  if (bank === "M") return !!ctx.M[name];
  if (bank === "A") return Number(ctx.A?.[name]) ?? 0;
  if (bank === "B") return Number(ctx.B?.[name]) ?? 0;
  throw new Error(`Unknown var ${name}`);
}

/** Numeric term: { var: "A0" } or { const: 50 } */
export function evalNumTerm(term, ctx) {
  if (!term) return 0;
  if (term.const !== undefined) return Number(term.const);
  if (term.var) return Number(resolveVar(term.var, ctx));
  return 0;
}

export async function evalBoolExpr(expr, ctx, pyCache) {
  if (!expr) return false;

  if (expr.var) {
    const bank = expr.var[0];
    if (bank === "A" || bank === "B") return Number(resolveVar(expr.var, ctx)) !== 0;
    return !!resolveVar(expr.var, ctx);
  }

  if (expr.op === "NOT") return !(await evalBoolExpr(expr.x, ctx, pyCache));
  if (expr.op === "AND") return (await evalBoolExpr(expr.a, ctx, pyCache)) && (await evalBoolExpr(expr.b, ctx, pyCache));
  if (expr.op === "OR") return (await evalBoolExpr(expr.a, ctx, pyCache)) || (await evalBoolExpr(expr.b, ctx, pyCache));

  // Comparators (analog-lite): GT, GE, LT, LE, EQ, NE
  if (["GT", "GE", "LT", "LE", "EQ", "NE"].includes(expr.op)) {
    const a = evalNumTerm(expr.a || expr.left, ctx);
    const b = evalNumTerm(expr.b || expr.right || expr.const, ctx);
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

  // Python nodes are intentionally unsupported unless you wire pyworker.
  if (expr.op === "PY_CALL" || expr.op === "PY_FB") {
    if (!ctx.FEATURES?.python) return false;
    throw new Error("Python is enabled but python execution is not wired in this build.");
  }

  throw new Error(`Unknown expr: ${JSON.stringify(expr)}`);
}
