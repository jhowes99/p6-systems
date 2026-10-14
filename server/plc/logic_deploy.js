/**
 * Phase 9 — staged logic deployment (validate → stage → apply at scan boundary → rollback).
 */

export class LogicDeployer {
  constructor(plc) {
    this.plc = plc;
    this.staged = null;
    this.history = []; // { ir, at, note }
    this.currentVersion = 1;
  }

  validate(ir) {
    const errors = [];
    if (!ir || typeof ir !== "object") errors.push("IR must be an object");
    if (ir && ir.language && ir.language !== "ladder") {
      errors.push(`Unsupported language: ${ir.language}`);
    }
    if (ir && !Array.isArray(ir.networks)) errors.push("networks[] required");
    const refs = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.var) refs.add(String(node.var).toUpperCase());
      if (node.x) walk(node.x);
      if (node.a) walk(node.a);
      if (node.b) walk(node.b);
    };
    for (const net of ir?.networks || []) {
      for (const rung of net.rungs || []) {
        walk(rung.cond);
        for (const act of rung.actions || []) {
          if (act.target) refs.add(String(act.target).toUpperCase());
          if (!["COIL", "SET", "RESET", "TON"].includes(act.type)) {
            errors.push(`Unsupported action: ${act.type}`);
          }
        }
      }
    }
    for (const r of refs) {
      if (!/^[IQMAB]\d+$/.test(r) && !/^M\d+$/.test(r)) {
        // allow I/Q/M/A/B only
        if (!/^[IQM]\d+$/.test(r)) errors.push(`Invalid signal reference: ${r}`);
      }
    }
    return { ok: errors.length === 0, errors, refs: [...refs] };
  }

  stage(ir, note = "") {
    const v = this.validate(ir);
    if (!v.ok) return { ok: false, errors: v.errors };
    this.staged = {
      ir: JSON.parse(JSON.stringify(ir)),
      note,
      stagedAt: new Date().toISOString(),
      version: this.currentVersion + 1
    };
    this.plc._emit?.("logic.staged", { version: this.staged.version });
    return { ok: true, staged: { version: this.staged.version, note, stagedAt: this.staged.stagedAt } };
  }

  /** Apply staged IR at a safe boundary (between scans). */
  apply() {
    if (!this.staged) return { ok: false, error: "Nothing staged" };
    const prev = this.plc.programIR;
    this.history.push({
      ir: JSON.parse(JSON.stringify(prev)),
      version: this.currentVersion,
      at: new Date().toISOString()
    });
    if (this.history.length > 20) this.history.shift();
    this.plc.setProgramIR(this.staged.ir);
    this.currentVersion = this.staged.version;
    const applied = this.staged;
    this.staged = null;
    this.plc._emit?.("logic.applied", { version: applied.version });
    return { ok: true, version: applied.version };
  }

  rollback() {
    const prev = this.history.pop();
    if (!prev) return { ok: false, error: "No rollback history" };
    this.plc.setProgramIR(prev.ir);
    this.currentVersion = prev.version;
    this.plc._emit?.("logic.rollback", { version: prev.version });
    return { ok: true, version: prev.version };
  }

  status() {
    return {
      currentVersion: this.currentVersion,
      staged: this.staged
        ? { version: this.staged.version, note: this.staged.note, stagedAt: this.staged.stagedAt }
        : null,
      historyCount: this.history.length
    };
  }
}
