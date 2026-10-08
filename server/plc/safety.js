import { evalBoolExprLocal } from "./ir_eval.js";
import { traceBoolExpr } from "./explain_tree.js";

function containsVar(expr, varName) {
  if (!expr || typeof expr === "boolean") return false;
  if (expr.var) return expr.var === varName;
  if (expr.op === "NOT") return containsVar(expr.x, varName);
  if (expr.op === "AND" || expr.op === "OR") return containsVar(expr.a, varName) || containsVar(expr.b, varName);
  return false;
}

export function enforceSafetyDefaults(ir, { eStopVar = null } = {}) {
  const warnings = [];
  if (!ir || ir.language !== "ladder") return { ir, warnings };

  // Auto-detect an E-stop input by common names in ioMap (human tag) or by address existence.
  // We enforce by AND-ing a chosen input var into each rung condition.
  const ioMap = ir.ioMap || {};
  let eStopAddr = null;
  if (eStopVar) eStopAddr = eStopVar;
  else {
    // Find any signal name containing ESTOP / E-STOP / EMERGENCY_STOP mapped to an input address.
    for (const [sig, addr] of Object.entries(ioMap)) {
      const s = String(sig).toUpperCase();
      if ((s.includes("ESTOP") || s.includes("E-STOP") || s.includes("EMERGENCY")) && String(addr).startsWith("I")) {
        eStopAddr = addr;
        break;
      }
    }
  }

  // Warn about potential auto-restart (seal-in) patterns: rung condition references its own output.
  for (const net of ir.networks ?? []) {
    for (const rung of net.rungs ?? []) {
      for (const act of rung.actions ?? []) {
        if (act.type === "COIL" && act.target?.[0] === "Q") {
          if (containsVar(rung.cond, act.target)) {
            warnings.push(
              `Safety: '${act.target}' is referenced in its own condition (seal-in / auto-restart possible). Confirm intended behavior.`
            );
          }
        }
      }
    }
  }

  if (!eStopAddr) return { ir, warnings };

  const out = JSON.parse(JSON.stringify(ir));
  let injected = 0;
  for (const net of out.networks ?? []) {
    for (const rung of net.rungs ?? []) {
      // Avoid double-inject if already present
      if (containsVar(rung.cond, eStopAddr)) continue;
      rung.cond = { op: "AND", a: rung.cond || false, b: { var: eStopAddr } };
      injected++;
    }
  }
  if (injected) warnings.push(`Safety: enforced E-Stop override using ${eStopAddr} on ${injected} rung(s).`);
  return { ir: out, warnings };
}

export function explainOutputOff(ir, snap, outputVar) {
  // Find rungs that write to outputVar and explain why they are not powering.
  const reasons = [];
  const primaryRungs = [];
  let rootCause = null;
  let idx = 0;
  for (const net of ir?.networks ?? []) {
    for (const rung of net?.rungs ?? []) {
      const rungIndex = idx++;
      const writes = (rung.actions || []).some(a => (a.type === "COIL" || a.type === "SET" || a.type === "RESET") && a.target === outputVar);
      if (!writes) continue;
      const power = evalBoolExprLocal(rung.cond, snap);
      const tree = traceBoolExpr(rung.cond, snap);
      const actionsWritingTarget = (rung.actions || []).filter(a => (a.type === "COIL" || a.type === "SET" || a.type === "RESET") && a.target === outputVar);
      primaryRungs.push({
        rungIndex,
        networkIndex: 0,
        power,
        tree,
        actionsWritingTarget
      });
      if (power) continue;
      // For explanation: list all input vars referenced and whether they are blocking
      const vars = new Set();
      (function collect(e){
        if (!e || typeof e === "boolean") return;
        if (e.var) vars.add(e.var);
        else if (e.op === "NOT") collect(e.x);
        else if (e.op === "AND" || e.op === "OR") { collect(e.a); collect(e.b); }
      })(rung.cond);

      const blockers = Array.from(vars).filter(v => {
        // If var is false it might block; but in OR it’s more nuanced—keep it simple for electrician message.
        const bank = v[0];
        if (bank === "I") return !snap.inputs?.[v];
        if (bank === "M") return !snap.mem?.[v];
        if (bank === "Q") return !snap.outputs?.[v];
        return false;
      });
      const msg = blockers.length
        ? `Output ${outputVar} is OFF because ${blockers.join(", ")} is OFF.`
        : `Output ${outputVar} is OFF because its condition is not satisfied.`;
      reasons.push({ rungIndex, rung: rung, blockers, message: msg });
      if (!rootCause && tree.type === "AND" && !tree.value && tree.children?.length) {
        const firstFalse = tree.children.find(c => !c.value);
        rootCause = firstFalse ? firstFalse.text : msg;
      } else if (!rootCause && tree.type === "OR" && !tree.value) {
        rootCause = "all OR branches false";
      } else if (!rootCause && tree.type === "VAR" && !tree.value) {
        rootCause = tree.text;
      } else if (!rootCause && blockers.length) {
        rootCause = blockers[0];
      }
    }
  }
  if (!rootCause && reasons.length) rootCause = reasons[0].message;
  return { reasons, primaryRungs, rootCause };
}

