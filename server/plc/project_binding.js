/**
 * Bind Canonical P6 Model signals to VirtualPLC IO image.
 * Live values live in the bridge (updated each scan); model file not rewritten every scan.
 */

import { SignalQuality, SignalDirection, DataType } from "../model/schema.js";
import { getActiveProject, loadProject, saveProject } from "../model/store.js";

function isAnalogAddr(addr) {
  return /^[AB]\d+$/i.test(String(addr || ""));
}

function isDigitalAddr(addr) {
  return /^[IQM]\d+$/i.test(String(addr || ""));
}

function coerceValue(dataType, value) {
  if (dataType === DataType.REAL || dataType === DataType.INT) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (dataType === DataType.STRING) return String(value ?? "");
  return !!value;
}

export class ProjectRuntimeBridge {
  constructor({ io, plc }) {
    this.io = io;
    this.plc = plc;
    /** @type {object|null} */
    this.project = null;
    /** @type {Map<string, object>} tag -> live signal state */
    this.live = new Map();
    /** address -> tag */
    this.addressToTag = new Map();
  }

  clear() {
    this.project = null;
    this.live.clear();
    this.addressToTag.clear();
    if (this.plc) this.plc.boundProjectId = null;
  }

  /**
   * Bind a project (or active). Declares IO, applies initial values.
   */
  bindProject(projectOrId = null) {
    let project = null;
    if (!projectOrId) project = getActiveProject();
    else if (typeof projectOrId === "string") project = loadProject(projectOrId);
    else project = projectOrId;

    if (!project) {
      this.clear();
      return { ok: false, error: "No project to bind" };
    }

    this.project = project;
    this.live.clear();
    this.addressToTag.clear();
    this.plc.boundProjectId = project.id;

    // Temporarily leave strict off so we can declare addresses
    const wasStrict = !!this.io.strict;
    this.io.setStrict(false);

    for (const sig of project.signals || []) {
      const live = {
        id: sig.id,
        tag: sig.tag,
        dataType: sig.dataType,
        units: sig.units || "",
        direction: sig.direction,
        initialValue: sig.initialValue,
        currentValue: sig.initialValue,
        quality: SignalQuality.GOOD,
        source: sig.source || "p6.runtime",
        timestamp: 0,
        simulationOverride: !!sig.simulationOverride,
        overrideValue: sig.overrideValue ?? null,
        address: sig.address || null,
        equipmentId: sig.equipmentId || null,
        dataClass: sig.dataClass
      };
      this.live.set(sig.tag, live);

      if (sig.address && (isDigitalAddr(sig.address) || isAnalogAddr(sig.address))) {
        const addr = String(sig.address).toUpperCase();
        this.addressToTag.set(addr, sig.tag);
        this._applyToIo(addr, live.simulationOverride ? live.overrideValue : live.initialValue, live.dataType);
      }
    }

    this.io.setStrict(wasStrict);
    this.plc._emit?.("project.bound", {
      projectId: project.id,
      name: project.name,
      signalCount: this.live.size
    });

    return {
      ok: true,
      projectId: project.id,
      name: project.name,
      signalCount: this.live.size,
      addresses: [...this.addressToTag.keys()]
    };
  }

  _applyToIo(addr, value, dataType) {
    const a = String(addr).toUpperCase();
    if (a.startsWith("I")) {
      this.io.ensureInput(a);
      this.io.inputs[a] = coerceValue(DataType.BOOL, value);
    } else if (a.startsWith("Q")) {
      this.io.ensureOutput(a);
      this.io.outputs[a] = coerceValue(DataType.BOOL, value);
    } else if (a.startsWith("M")) {
      this.io.ensureMem(a);
      this.io.mem[a] = coerceValue(DataType.BOOL, value);
    } else if (a.startsWith("A")) {
      this.io.ensureAnalogInput(a);
      this.io.analogInputs[a] = coerceValue(dataType || DataType.REAL, value);
    } else if (a.startsWith("B")) {
      this.io.ensureAnalogOutput(a);
      this.io.analogOutputs[a] = coerceValue(dataType || DataType.REAL, value);
    }
  }

  _readFromIo(addr, dataType) {
    const a = String(addr).toUpperCase();
    if (a.startsWith("I")) return !!this.io.effectiveValue(a);
    if (a.startsWith("Q")) return !!this.io.effectiveValue(a);
    if (a.startsWith("M")) return !!this.io.effectiveValue(a);
    if (a.startsWith("A")) return Number(this.io.analogInputs[a] ?? 0);
    if (a.startsWith("B")) return Number(this.io.analogOutputs[a] ?? 0);
    return coerceValue(dataType, false);
  }

  /**
   * Called after each scan — refresh live signal values from IO.
   */
  syncFromIo({ simTimeMs = 0 } = {}) {
    for (const live of this.live.values()) {
      if (live.simulationOverride) {
        live.currentValue = live.overrideValue;
        live.quality = SignalQuality.GOOD;
        live.source = "p6.override";
      } else if (live.address) {
        live.currentValue = this._readFromIo(live.address, live.dataType);
        live.quality = SignalQuality.GOOD;
        live.source = "p6.runtime";
      } else {
        live.quality = SignalQuality.NOT_CONNECTED;
        live.source = "p6.unmapped";
      }
      live.timestamp = simTimeMs;
    }
  }

  /**
   * Restore initials after runtime reset.
   */
  restoreInitials() {
    for (const live of this.live.values()) {
      live.simulationOverride = false;
      live.overrideValue = null;
      live.currentValue = live.initialValue;
      live.quality = live.address ? SignalQuality.GOOD : SignalQuality.NOT_CONNECTED;
      if (live.address) this._applyToIo(live.address, live.initialValue, live.dataType);
    }
  }

  listSignals() {
    return [...this.live.values()].map((s) => ({ ...s }));
  }

  getSignal(tag) {
    const s = this.live.get(tag);
    return s ? { ...s } : null;
  }

  /**
   * Change an input / set override. For INPUT direction writes to IO;
   * simulationOverride forces value regardless of logic until cleared.
   */
  setSignal(tag, value, { override = false } = {}) {
    const live = this.live.get(tag);
    if (!live) throw new Error(`Unknown signal tag: ${tag}`);

    const coerced = coerceValue(live.dataType, value);

    if (override) {
      live.simulationOverride = true;
      live.overrideValue = coerced;
      live.currentValue = coerced;
      live.source = "p6.override";
      if (live.address) this._applyToIo(live.address, coerced, live.dataType);
      this.plc._emit?.("signal.override", { tag, value: coerced });
      return { ...live };
    }

    // Normal write: only for input-direction or analog inputs
    const dir = live.direction;
    if (dir === SignalDirection.OUTPUT) {
      throw new Error(`Cannot write OUTPUT signal ${tag} without override=true`);
    }
    live.simulationOverride = false;
    live.overrideValue = null;
    live.currentValue = coerced;
    if (live.address) {
      const a = String(live.address).toUpperCase();
      if (a.startsWith("I") || a.startsWith("A")) {
        this._applyToIo(a, coerced, live.dataType);
      } else if (a.startsWith("M")) {
        this._applyToIo(a, coerced, live.dataType);
      } else {
        throw new Error(`Signal ${tag} address ${a} is not writable as input`);
      }
    }
    this.plc._emit?.("signal.write", { tag, value: coerced, address: live.address });
    return { ...live };
  }

  clearOverride(tag) {
    const live = this.live.get(tag);
    if (!live) throw new Error(`Unknown signal tag: ${tag}`);
    live.simulationOverride = false;
    live.overrideValue = null;
    if (live.address) {
      live.currentValue = this._readFromIo(live.address, live.dataType);
    }
    this.plc._emit?.("signal.override_clear", { tag });
    return { ...live };
  }

  /**
   * Persist current live values into project.json (explicit, not every scan).
   */
  persistLiveToModel() {
    if (!this.project?.id) throw new Error("No bound project");
    const project = loadProject(this.project.id);
    if (!project) throw new Error("Project not found");
    for (const sig of project.signals) {
      const live = this.live.get(sig.tag);
      if (!live) continue;
      sig.currentValue = live.currentValue;
      sig.quality = live.quality;
      sig.source = live.source;
      sig.timestamp = live.timestamp;
      sig.simulationOverride = live.simulationOverride;
      sig.overrideValue = live.overrideValue;
      sig.updatedAt = new Date().toISOString();
    }
    const saved = saveProject(project, { bumpVersion: true });
    this.project = saved;
    return saved;
  }
}

/**
 * Wire bridge callbacks onto VirtualPLC.
 * @param {object} [opts.history] optional SignalHistoryBuffer
 */
export function attachBridge(plc, bridge, opts = {}) {
  const history = opts.history || null;
  plc.afterScan = async ({ simTimeMs, scanCount, io: scanIo }) => {
    bridge.syncFromIo({ simTimeMs });
    if (history) {
      const memSrc = scanIo?.mem || bridge.io?.mem || {};
      history.record({
        scanCount,
        simTimeMs,
        signals: bridge.listSignals(),
        mem: { M0: !!memSrc.M0, M1: !!memSrc.M1 }
      });
    }
  };
  plc.onReset = () => {
    bridge.restoreInitials();
    bridge.syncFromIo({ simTimeMs: 0 });
    history?.clear();
  };
  return bridge;
}
