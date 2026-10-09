/**
 * Runtime signal history ring buffer — authoritative frames for Studio playback.
 * Records compact tag→value snapshots; does not invent intermediate process events.
 */

const DEFAULT_MAX = 180;
const DEFAULT_EVERY_N = 2;

export class SignalHistoryBuffer {
  constructor({ maxFrames = DEFAULT_MAX, everyN = DEFAULT_EVERY_N } = {}) {
    this.maxFrames = Math.max(2, Number(maxFrames) || DEFAULT_MAX);
    this.everyN = Math.max(1, Number(everyN) || DEFAULT_EVERY_N);
    this.recording = true;
    this.frames = [];
    this._tick = 0;
  }

  clear() {
    this.frames = [];
    this._tick = 0;
  }

  setRecording(on) {
    this.recording = !!on;
  }

  /**
   * @param {{ scanCount:number, simTimeMs:number, signals:Array<{tag:string,currentValue:any}>, mem?:object }} frame
   */
  record(frame) {
    if (!this.recording) return null;
    this._tick += 1;
    if (this._tick % this.everyN !== 0) return null;
    const signals = {};
    for (const s of frame.signals || []) {
      if (!s?.tag) continue;
      signals[s.tag] = s.currentValue;
    }
    const entry = {
      scanCount: frame.scanCount,
      simTimeMs: frame.simTimeMs,
      wallTime: new Date().toISOString(),
      signals,
      mem: frame.mem ? { M0: !!frame.mem.M0, M1: !!frame.mem.M1 } : undefined
    };
    this.frames.push(entry);
    if (this.frames.length > this.maxFrames) {
      this.frames.splice(0, this.frames.length - this.maxFrames);
    }
    return entry;
  }

  meta() {
    return {
      recording: this.recording,
      count: this.frames.length,
      maxFrames: this.maxFrames,
      everyN: this.everyN,
      oldestScan: this.frames[0]?.scanCount ?? null,
      newestScan: this.frames[this.frames.length - 1]?.scanCount ?? null
    };
  }

  list() {
    return this.frames.map((f, index) => ({
      index,
      scanCount: f.scanCount,
      simTimeMs: f.simTimeMs,
      wallTime: f.wallTime
    }));
  }

  get(index) {
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= this.frames.length) return null;
    return { index: i, ...this.frames[i] };
  }
}
