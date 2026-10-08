import { evalBoolExpr } from "./eval.js";

function writeVar(name, val, ctx) {
  const bank = name[0];
  if (bank === "Q") ctx.Q[name] = !!val;
  else if (bank === "M") ctx.M[name] = !!val;
  else throw new Error(`Write not allowed: ${name}`);
}

export async function execLadder(ir, ctx, pyCache) {
  for (const net of ir.networks ?? []) {
    for (const rung of net.rungs ?? []) {
      const power = await evalBoolExpr(rung.cond, ctx, pyCache);

      for (const act of rung.actions ?? []) {
        if (act.type === "COIL") {
          writeVar(act.target, power, ctx);
        } else if (act.type === "SET") {
          if (power) writeVar(act.target, true, ctx);
        } else if (act.type === "RESET") {
          if (power) writeVar(act.target, false, ctx);
        } else if (act.type === "TON") {
          const t = ctx.TON(act.name, act.presetMs, power);
          if (act.doneTarget) writeVar(act.doneTarget, t.done, ctx);
        } else {
          throw new Error(`Unknown action ${act.type}`);
        }
      }
    }
  }
}
