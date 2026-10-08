export class IOModel {
  constructor() {
    // Dynamic IO banks (we seed a few for demo convenience)
    this.inputs = { I0:false, I1:false, I2:false, I3:false };
    this.outputs = { Q0:false, Q1:false, Q2:false, Q3:false };
    this.mem = { M0:false, M1:false, M2:false, M3:false };
    this.timers = {}; // e.g. { T0: { startMs, presetMs, done, elapsedMs } }
    // Analog-lite: A = analog inputs, B = analog outputs (numeric)
    this.analogInputs = { A0: 0, A1: 0, A2: 0, A3: 0 };
    this.analogOutputs = { B0: 0, B1: 0, B2: 0, B3: 0 };

    // Fault injection (OT commissioning helpers)
    // Map varName -> { var, mode:"force"|"stuck", value:boolean, at:number }
    this.faults = {};

    // Strict PLC mode: disallow dynamic IO growth during runtime.
    this.strict = false;
  }

  setStrict(on) {
    this.strict = !!on;
  }

  _normVar(name) {
    return String(name || "").trim().toUpperCase();
  }
  _isVarName(name) {
    return /^[IQMAB]\d+$/.test(String(name || "").trim().toUpperCase());
  }
  _bankFor(name) {
    const v = this._normVar(name);
    const bank = v[0];
    if (bank === "I") return { bank, obj: this.inputs, ensure: () => this.ensureInput(v) };
    if (bank === "Q") return { bank, obj: this.outputs, ensure: () => this.ensureOutput(v) };
    if (bank === "M") return { bank, obj: this.mem, ensure: () => this.ensureMem(v) };
    if (bank === "A") return { bank, obj: this.analogInputs, ensure: () => this.ensureAnalogInput(v) };
    if (bank === "B") return { bank, obj: this.analogOutputs, ensure: () => this.ensureAnalogOutput(v) };
    return { bank: null, obj: null, ensure: () => {} };
  }

  ensureInput(name) {
    if (!(name in this.inputs)) {
      if (this.strict) throw new Error(`Strict PLC mode: input ${name} is not declared.`);
      this.inputs[name] = false;
    }
  }
  ensureOutput(name) {
    if (!(name in this.outputs)) {
      if (this.strict) throw new Error(`Strict PLC mode: output ${name} is not declared.`);
      this.outputs[name] = false;
    }
  }
  ensureMem(name) {
    if (!(name in this.mem)) {
      if (this.strict) throw new Error(`Strict PLC mode: memory bit ${name} is not declared.`);
      this.mem[name] = false;
    }
  }
  ensureAnalogInput(name) {
    if (!(name in this.analogInputs)) {
      if (this.strict) throw new Error(`Strict PLC mode: analog input ${name} is not declared.`);
      this.analogInputs[name] = 0;
    }
  }
  ensureAnalogOutput(name) {
    if (!(name in this.analogOutputs)) {
      if (this.strict) throw new Error(`Strict PLC mode: analog output ${name} is not declared.`);
      this.analogOutputs[name] = 0;
    }
  }
  setAnalog(name, value) {
    const v = this._normVar(name);
    if (!/^[AB]\d+$/.test(v)) throw new Error(`Invalid analog '${name}'. Expected A# or B# (e.g. A0, B1).`);
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error(`Analog value must be a number.`);
    if (v[0] === "A") {
      this.ensureAnalogInput(v);
      this.analogInputs[v] = num;
    } else {
      this.ensureAnalogOutput(v);
      this.analogOutputs[v] = num;
    }
  }

  listFaults() {
    return Object.values(this.faults).sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  getFault(name) {
    const v = this._normVar(name);
    return this.faults[v] || null;
  }
  setFault({ var: name, mode, value }) {
    const v = this._normVar(name);
    if (!this._isVarName(v)) throw new Error(`Invalid var '${name}'. Expected I#, Q#, or M# (e.g. I0, Q3, M12).`);
    const m = String(mode || "").trim().toLowerCase();
    if (m !== "force" && m !== "stuck") throw new Error(`Invalid mode '${mode}'. Use 'force' or 'stuck'.`);

    const bank = this._bankFor(v);
    if (!bank.bank) throw new Error(`Unsupported var '${v}'.`);
    bank.ensure();

    this.faults[v] = { var: v, mode: m, value: !!value, at: Date.now() };
    return this.faults[v];
  }
  clearFault(name) {
    const v = this._normVar(name);
    if (this.faults[v]) delete this.faults[v];
  }

  effectiveValue(name) {
    const v = this._normVar(name);
    const f = this.faults[v];
    if (f) return !!f.value;
    const bank = this._bankFor(v);
    if (!bank.bank) return false;
    bank.ensure();
    return !!bank.obj[v];
  }

  // Input image (I) used for a scan: apply any forced/stuck faults.
  inputImage() {
    const out = {};
    const keys = new Set(Object.keys(this.inputs));
    for (const f of Object.values(this.faults)) if (f.var?.startsWith("I")) keys.add(f.var);
    for (const k of keys) out[k] = this.effectiveValue(k);
    return out;
  }

  // Proxies for runtime writes so we can block forced/stuck variables.
  bankProxy(bankLetter) {
    const B = String(bankLetter || "").toUpperCase();
    const bankObj = B === "Q" ? this.outputs : (B === "M" ? this.mem : null);
    if (!bankObj) throw new Error(`Unsupported bank '${bankLetter}'`);

    return new Proxy(bankObj, {
      get: (target, prop) => {
        if (typeof prop !== "string") return target[prop];
        if (!/^[QM]\d+$/.test(prop)) return target[prop];
        return this.effectiveValue(prop);
      },
      set: (target, prop, val) => {
        if (typeof prop !== "string") { target[prop] = val; return true; }
        if (!/^[QM]\d+$/.test(prop)) { target[prop] = val; return true; }

        const f = this.getFault(prop);
        // Forced/stuck: do not allow program writes to change it.
        if (f && (f.mode === "force" || f.mode === "stuck")) return true;

        // Ensure slot exists and write raw
        if (B === "Q") this.ensureOutput(prop);
        if (B === "M") this.ensureMem(prop);
        target[prop] = !!val;
        return true;
      }
    });
  }

  snapshot() {
    // Snapshot shows effective values (with faults applied), plus the active faults list.
    const inputs = {};
    const outputs = {};
    const mem = {};

    const inKeys = new Set(Object.keys(this.inputs));
    const outKeys = new Set(Object.keys(this.outputs));
    const memKeys = new Set(Object.keys(this.mem));
    for (const f of Object.values(this.faults)) {
      if (f.var?.startsWith("I")) inKeys.add(f.var);
      if (f.var?.startsWith("Q")) outKeys.add(f.var);
      if (f.var?.startsWith("M")) memKeys.add(f.var);
    }

    for (const k of inKeys) inputs[k] = this.effectiveValue(k);
    for (const k of outKeys) outputs[k] = this.effectiveValue(k);
    for (const k of memKeys) mem[k] = this.effectiveValue(k);

    return {
      inputs,
      outputs,
      mem,
      analogInputs: { ...this.analogInputs },
      analogOutputs: { ...this.analogOutputs },
      timers: JSON.parse(JSON.stringify(this.timers)),
      faults: this.listFaults()
    };
  }

  setInput(name, value) {
    // Allow dynamic inputs (I0..In) for generated programs
    const v = this._normVar(name);
    if (!this._isVarName(v) || !v.startsWith("I")) throw new Error(`Invalid input '${name}'. Expected I#. Example: I0.`);

    const f = this.getFault(v);
    // Stuck inputs cannot be changed by API toggles.
    if (f && f.mode === "stuck") return;

    this.ensureInput(v);
    this.inputs[v] = !!value;
  }

  setOutput(name, value) {
    const v = this._normVar(name);
    if (!this._isVarName(v) || !v.startsWith("Q")) throw new Error(`Invalid output '${name}'. Expected Q#. Example: Q0.`);
    const f = this.getFault(v);
    if (f && (f.mode === "force" || f.mode === "stuck")) return;
    this.ensureOutput(v);
    this.outputs[v] = !!value;
  }

  ensureTimer(name, presetMs) {
    if (!this.timers[name]) {
      this.timers[name] = { startMs: null, presetMs, done: false, elapsedMs: 0 };
    }
    this.timers[name].presetMs = presetMs;
    return this.timers[name];
  }

  reset({ retainMem = true, clearFaults = false } = {}) {
    // Inputs represent the physical world; keep them by default.
    // Outputs drop on power-cycle; analog outputs zero.
    for (const k of Object.keys(this.outputs)) this.outputs[k] = false;
    for (const k of Object.keys(this.analogOutputs)) this.analogOutputs[k] = 0;
    // Timers reset.
    this.timers = {};
    // Retentive memory optionally cleared.
    if (!retainMem) {
      for (const k of Object.keys(this.mem)) this.mem[k] = false;
    }
    // Commissioning faults/forces optionally cleared.
    if (clearFaults) this.faults = {};
  }
}
