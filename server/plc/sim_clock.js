/**
 * Deterministic simulation clock — independent of wall-clock time.
 * Spec §6 / §14: simulation time is the source of timer truth.
 */

export class SimClock {
  constructor({ scanMs = 50 } = {}) {
    this.scanMs = Math.max(1, Number(scanMs) || 50);
    this.timeMs = 0;
    this.scanCount = 0;
  }

  setScanMs(ms) {
    this.scanMs = Math.max(1, Number(ms) || 50);
  }

  /** Advance one scan period. Returns new sim time. */
  tick() {
    this.timeMs += this.scanMs;
    this.scanCount += 1;
    return this.timeMs;
  }

  reset() {
    this.timeMs = 0;
    this.scanCount = 0;
  }

  snapshot() {
    return {
      timeMs: this.timeMs,
      scanCount: this.scanCount,
      scanMs: this.scanMs
    };
  }
}
