import { execLadder } from "./ladder.js";
import { SimClock } from "./sim_clock.js";

const EVENT_MAX = 500;

/**
 * P6 Runtime — deterministic virtual PLC scan engine.
 * Wall-clock setInterval only schedules scans when mode===running;
 * timers and evidence use SimClock (not Date.now).
 */
export class VirtualPLC {
  constructor({ io, scanMs = 50, features = { python: false } }) {
    this.io = io;
    this.scanMs = scanMs;
    this.features = features;
    this.clock = new SimClock({ scanMs });

    this.programIR = { language: "ladder", networks: [] };

    /** @type {'stopped'|'running'|'paused'} */
    this.mode = "stopped";
    this.running = false; // legacy alias: mode === 'running'
    this._interval = null;
    this._inScan = false;
    this._stepOnce = false;

    this.lastError = null;
    this.lastDiag = { pyErrors: [] };
    this.strict = false;

    /** @type {Array<object>} */
    this.events = [];

    /** Optional Phase 4 hook: (ctx) => void after logic, before signal sync */
    this.equipmentStep = null;

    /** Optional: () => void after each completed scan (e.g. bind signals) */
    this.afterScan = null;

    this.boundProjectId = null;
    /** Monotonic per-scan index for once-per-scan timer accrual (before clock.tick). */
    this._scanIndex = 0;

    this.scanStats = {
      intervalMs: this.scanMs,
      lastMs: 0,
      avgMs: 0,
      p95Ms: 0,
      maxMs: 0,
      overruns: 0,
      samples: 0
    };
    this._scanHist = [];
    this._scanHistMax = 240;

    this.phaseTimings = {
      last: { inputMs: 0, logicMs: 0, equipmentMs: 0, persistMs: 0, housekeepingMs: 0 },
      avg: { inputMs: 0, logicMs: 0, equipmentMs: 0, persistMs: 0, housekeepingMs: 0 }
    };
  }

  setProgramIR(ir) {
    this.programIR = ir;
    this._emit("program.loaded", { language: ir?.language || null });
  }

  setStrict(on) {
    this.strict = !!on;
    if (this.io?.setStrict) this.io.setStrict(this.strict);
  }

  setScanMs(ms) {
    this.scanMs = Math.max(1, Number(ms) || 50);
    this.clock.setScanMs(this.scanMs);
    this.scanStats.intervalMs = this.scanMs;
    if (this.mode === "running") {
      this.stop();
      this.start();
    }
  }

  _emit(type, detail = {}) {
    const ev = {
      id: `evt_${this.clock.scanCount}_${this.events.length}`,
      type,
      simTimeMs: this.clock.timeMs,
      scanCount: this.clock.scanCount,
      wallTime: new Date().toISOString(),
      detail
    };
    this.events.push(ev);
    if (this.events.length > EVENT_MAX) this.events.splice(0, this.events.length - EVENT_MAX);
    return ev;
  }

  getEvents({ limit = 100, sinceScan = null } = {}) {
    let list = this.events;
    if (sinceScan != null) list = list.filter((e) => e.scanCount > Number(sinceScan));
    return list.slice(-Math.max(1, Math.min(EVENT_MAX, Number(limit) || 100)));
  }

  start() {
    if (this.mode === "running") return;
    this.mode = "running";
    this.running = true;
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => {
      this.scan().catch(() => {});
    }, this.scanMs);
    this._emit("runtime.start", {});
  }

  stop() {
    const was = this.mode;
    this.mode = "stopped";
    this.running = false;
    this._stepOnce = false;
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    if (was !== "stopped") this._emit("runtime.stop", {});
  }

  pause() {
    if (this.mode !== "running") return;
    this.mode = "paused";
    this.running = false;
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    this._emit("runtime.pause", { simTimeMs: this.clock.timeMs });
  }

  resume() {
    if (this.mode !== "paused") {
      if (this.mode === "stopped") this.start();
      return;
    }
    this.start();
    this._emit("runtime.resume", { simTimeMs: this.clock.timeMs });
  }

  /**
   * Execute exactly one scan at a safe boundary (even when paused/stopped).
   */
  async step() {
    this._stepOnce = true;
    await this.scan({ force: true });
    this._emit("runtime.step", { simTimeMs: this.clock.timeMs, scanCount: this.clock.scanCount });
    return this.status();
  }

  /**
   * Reset simulation time, timers, outputs; restore bound signal initials.
   * Does not clear physical-style inputs unless clearInputs=true.
   */
  reset({ clearInputs = false, clearFaults = true, retainMem = false } = {}) {
    const wasRunning = this.mode === "running";
    this.stop();
    this.clock.reset();
    this._scanIndex = 0;
    if (this.io?.reset) {
      this.io.reset({ retainMem, clearFaults });
      if (clearInputs) {
        for (const k of Object.keys(this.io.inputs || {})) this.io.inputs[k] = false;
        for (const k of Object.keys(this.io.analogInputs || {})) this.io.analogInputs[k] = 0;
      }
    }
    this.lastError = null;
    this.lastDiag = { pyErrors: [] };
    this._emit("runtime.reset", { clearInputs, clearFaults, retainMem });
    if (typeof this.onReset === "function") {
      try { this.onReset(); } catch (_) { /* ignore */ }
    }
    if (wasRunning) this.start();
    return this.status();
  }

  powerCycle({ retainMem = true, clearFaults = false } = {}) {
    const wasRunning = this.mode === "running";
    this.stop();
    if (this.io?.reset) this.io.reset({ retainMem, clearFaults });
    this.lastError = null;
    this.lastDiag = { pyErrors: [] };
    this._emit("runtime.power_cycle", { retainMem, clearFaults });
    if (wasRunning) this.start();
  }

  status() {
    return {
      mode: this.mode,
      running: this.mode === "running",
      paused: this.mode === "paused",
      stopped: this.mode === "stopped",
      scanMs: this.scanMs,
      strict: !!this.strict,
      sim: this.clock.snapshot(),
      boundProjectId: this.boundProjectId,
      lastError: this.lastError,
      diag: this.lastDiag,
      scanStats: this.scanStats,
      phases: this.phaseTimings
    };
  }

  async scan({ force = false } = {}) {
    if (this._inScan) return;
    if (!force && this.mode !== "running" && !this._stepOnce) return;
    this._stepOnce = false;
    this._inScan = true;

    const wall0 = process.hrtime.bigint();
    let tInputMs = 0;
    let tLogicMs = 0;
    let tEquipMs = 0;
    let tPersistMs = 0;

    const tInput0 = process.hrtime.bigint();
    const I = this.io.inputImage();
    const Q = this.io.bankProxy("Q");
    const M = this.io.bankProxy("M");
    const A = { ...(this.io.analogInputs || {}) };
    const B = this.io.analogOutputs || {};
    tInputMs = Number(process.hrtime.bigint() - tInput0) / 1e6;

    const pyCache = new Map();
    const DIAG = { pyErrors: [] };
    this._scanIndex += 1;
    const scanIndex = this._scanIndex;
    const scanMs = this.scanMs;

    const ctx = {
      I, Q, M, A, B, DIAG,
      FEATURES: this.features,
      SIM_TIME_MS: this.clock.timeMs + scanMs, // projected time after this scan
      TON: (name, presetMs, enable) => {
        const t = this.io.ensureTimer(name, presetMs);
        if (!enable) {
          t.startMs = null;
          t.done = false;
          t.elapsedMs = 0;
          t._accruedScan = null;
          return { done: false, elapsedMs: 0 };
        }
        // Accrue exactly one scan period per scan (deterministic; not wall-clock)
        if (t._accruedScan !== scanIndex) {
          t.elapsedMs = (Number(t.elapsedMs) || 0) + scanMs;
          t._accruedScan = scanIndex;
          if (t.startMs === null) t.startMs = this.clock.timeMs;
        }
        t.done = t.elapsedMs >= t.presetMs;
        return { done: t.done, elapsedMs: t.elapsedMs };
      }
    };

    try {
      // --- Control-logic evaluation ---
      if (this.programIR.language === "ladder") {
        const tLogic0 = process.hrtime.bigint();
        await execLadder(this.programIR, ctx, pyCache);
        tLogicMs = Number(process.hrtime.bigint() - tLogic0) / 1e6;
      } else {
        throw new Error(`Unsupported language '${this.programIR.language}' in runtime.`);
      }
      this.lastError = null;
      this.lastDiag = DIAG;

      // --- Equipment / process simulation hook (Phase 4 fills in) ---
      if (typeof this.equipmentStep === "function") {
        const tE0 = process.hrtime.bigint();
        await this.equipmentStep({
          io: this.io,
          simTimeMs: this.clock.timeMs,
          scanCount: this.clock.scanCount,
          I, Q, M, A, B
        });
        tEquipMs = Number(process.hrtime.bigint() - tE0) / 1e6;
      }

      // Advance simulation clock after logic+equipment for this scan
      this.clock.tick();

      // --- Visualization / model sync ---
      if (typeof this.afterScan === "function") {
        const tP0 = process.hrtime.bigint();
        await this.afterScan({
          io: this.io,
          simTimeMs: this.clock.timeMs,
          scanCount: this.clock.scanCount
        });
        tPersistMs = Number(process.hrtime.bigint() - tP0) / 1e6;
      }
    } catch (e) {
      this.lastError = String(e?.stack || e);
      this.lastDiag = DIAG;
      this._emit("runtime.error", { error: String(e?.message || e) });
    } finally {
      const durMs = Number(process.hrtime.bigint() - wall0) / 1e6;
      this.scanStats.intervalMs = this.scanMs;
      this.scanStats.lastMs = durMs;
      this.scanStats.samples++;
      const n = this.scanStats.samples;
      this.scanStats.avgMs = n === 1 ? durMs : (this.scanStats.avgMs + (durMs - this.scanStats.avgMs) / n);
      this.scanStats.maxMs = Math.max(this.scanStats.maxMs || 0, durMs);
      if (durMs > this.scanMs) this.scanStats.overruns++;

      this._scanHist.push(durMs);
      if (this._scanHist.length > this._scanHistMax) this._scanHist.shift();
      const sorted = [...this._scanHist].sort((a, b) => a - b);
      const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
      this.scanStats.p95Ms = sorted.length ? sorted[idx] : 0;

      const houseMs = Math.max(0, durMs - tInputMs - tLogicMs - tEquipMs - tPersistMs);
      this.phaseTimings.last = {
        inputMs: tInputMs,
        logicMs: tLogicMs,
        equipmentMs: tEquipMs,
        persistMs: tPersistMs,
        housekeepingMs: houseMs
      };
      const a = this.phaseTimings.avg;
      const n2 = this.scanStats.samples || 1;
      for (const [k, v] of Object.entries(this.phaseTimings.last)) {
        a[k] = n2 === 1 ? v : (a[k] + (v - a[k]) / n2);
      }
      if (!this.scanStats.phases) this.scanStats.phases = this.phaseTimings;
      else this.scanStats.phases = this.phaseTimings;

      this._inScan = false;
    }
  }
}
