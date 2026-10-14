/**
 * Runtime command validation — engineer-language rejects before/after writes.
 * Sim controls (Start/Pause/Resume/Stop/Reset/speed on /api/runtime/*) are separate;
 * this module validates equipment / process signal commands only.
 */

function findSignal(byTag, ...names) {
  for (const n of names) {
    if (byTag[n]) return byTag[n];
  }
  return null;
}

function findByRegex(byTag, re) {
  for (const [tag, s] of Object.entries(byTag)) {
    if (re.test(tag)) return s;
  }
  return null;
}

function num(sig) {
  if (!sig) return null;
  const n = Number(sig.currentValue);
  return Number.isFinite(n) ? n : null;
}

export function evaluateStartPermissives(signals = [], opts = {}) {
  const byTag = Object.fromEntries(signals.map((s) => [s.tag, s]));
  const reasons = [];
  const dryRunPct = Number(opts.dryRunLevelPct) || 5;

  const esd =
    findSignal(byTag, "ESTOP101.Healthy", "ESD-101.Healthy") ||
    findByRegex(byTag, /ESD.*Healthy|ESTOP.*Healthy/i);
  if (esd && esd.currentValue === false) {
    reasons.push("START REJECTED — ESD/E-STOP ACTIVE (sim)");
  }

  const high =
    findSignal(byTag, "LSH101.High", "LT-101.High", "LT-102.High") ||
    findByRegex(byTag, /LSH.*High|LT-10[12]\.High/i);
  if (high && high.currentValue === true) {
    reasons.push("START REJECTED — DESTINATION LEVEL HIGH");
  }

  const trip = findSignal(byTag, "TripLatched");
  if (trip && trip.currentValue === true) {
    reasons.push("START REJECTED — TRIP LATCHED — USE SYSTEM.RESET");
  }

  const pumpFault =
    findSignal(byTag, "P101.Fault", "PUMP-101.Fault") || findByRegex(byTag, /P(UMP)?-?101\.Fault/i);
  if (pumpFault && pumpFault.currentValue === true) {
    reasons.push("START REJECTED — PUMP FAULT ACTIVE — RESET REQUIRED");
  }

  const srcLevel =
    findSignal(byTag, "TANK101.LevelPct", "TANK-101.LevelPct", "LT101.LevelPct") ||
    findByRegex(byTag, /TANK-?101\.Level/i);
  const srcPct = num(srcLevel);
  if (srcPct != null && srcPct <= dryRunPct) {
    reasons.push(`START REJECTED — SOURCE LEVEL LOW (${srcPct.toFixed(1)}% ≤ ${dryRunPct}% DRY-RUN)`);
  }

  // Tank-transfer (§40): operator must open VALVE-101 before Start.
  // Water-transfer (§15): Start seals M0 which commands XV101 open — do NOT require open feedback first.
  const tankValveFb = findSignal(byTag, "VALVE-101.OpenedFeedback");
  const waterOnly =
    !!findSignal(byTag, "XV101.OpenedFeedback", "LSH101.High", "ESTOP101.Healthy") && !tankValveFb;

  const xv102 =
    findSignal(byTag, "XV-102.OpenedFeedback") || findByRegex(byTag, /XV-?102\.Opened/i);

  if (xv102) {
    const xv101 =
      findSignal(byTag, "XV-101.OpenedFeedback") || findByRegex(byTag, /XV-?101\.Opened/i);
    if (xv101 && xv101.currentValue !== true) reasons.push("START REJECTED — XV-101 NOT OPEN");
    if (xv102.currentValue !== true) reasons.push("START REJECTED — XV-102 NOT OPEN");
  } else if (!waterOnly && tankValveFb && tankValveFb.currentValue !== true) {
    reasons.push("START REJECTED — VALVE-101 NOT OPEN");
  }

  return {
    ok: reasons.length === 0,
    action: "System.Start",
    reasons,
    note: reasons.length
      ? "Permissives failed — Runtime will not treat start as successful"
      : "Permissives OK for start pulse",
    layer: "equipment_command"
  };
}

export function validateSignalCommand(tag, value, signals = [], opts = {}) {
  const t = String(tag || "");
  if ((t === "System.Start" || /RunCommand$/i.test(t)) && (value === true || value === 1)) {
    return evaluateStartPermissives(signals, opts);
  }
  if (/(ESD|ESTOP).*Healthy/i.test(t) && value === false) {
    return {
      ok: true,
      action: t,
      reasons: [],
      warnings: ["Simulated E-stop only — not a certified physical safety function"],
      layer: "equipment_command"
    };
  }
  if (t === "System.Reset" && (value === true || value === 1)) {
    return {
      ok: true,
      action: t,
      reasons: [],
      note: "Reset clears trip latch when E-stop healthy and transfer not requested",
      layer: "equipment_command"
    };
  }
  return { ok: true, action: t, reasons: [], warnings: [], layer: "equipment_command" };
}

/** Documented separation: sim clock vs equipment commands. */
export const CONTROL_LAYERS = Object.freeze({
  sim: {
    apis: [
      "POST /api/runtime/start",
      "POST /api/runtime/pause",
      "POST /api/runtime/resume",
      "POST /api/runtime/stop",
      "POST /api/runtime/reset",
      "POST /api/runtime/step",
      "POST /api/runtime/speed"
    ],
    meaning: "Controls VirtualPLC scan / SimClock only — does not start the pump"
  },
  equipment: {
    apis: ["POST /api/runtime/command", "POST /api/runtime/signal"],
    meaning: "Writes process/equipment signals (System.Start, valves, E-stop) with permissive checks"
  }
});
