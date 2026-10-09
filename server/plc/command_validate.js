/**
 * Runtime command validation — explain rejects before/after writes.
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

export function evaluateStartPermissives(signals = []) {
  const byTag = Object.fromEntries(signals.map((s) => [s.tag, s]));
  const reasons = [];

  const esd =
    findSignal(byTag, "ESD-101.Healthy", "ESTOP101.Healthy") ||
    findByRegex(byTag, /ESD.*Healthy|ESTOP.*Healthy/i);
  if (esd && esd.currentValue === false) {
    reasons.push("START REJECTED — ESD/E-STOP ACTIVE (sim)");
  }

  const high =
    findSignal(byTag, "LT-101.High", "LT-102.High", "LSH101.High") ||
    findByRegex(byTag, /LT-10[12]\.High|LSH.*High/i);
  if (high && high.currentValue === true) {
    reasons.push("START REJECTED — DESTINATION LEVEL HIGH");
  }

  const valve =
    findSignal(byTag, "VALVE-101.OpenedFeedback", "XV-101.OpenedFeedback", "XV101.OpenedFeedback") ||
    findByRegex(byTag, /VALVE-?101\.Opened|XV-?101\.Opened/i);
  // Dual-valve Part-13 plants (if still bound)
  const xv102 =
    findSignal(byTag, "XV-102.OpenedFeedback") || findByRegex(byTag, /XV-?102\.Opened/i);

  if (xv102) {
    const xv101 =
      findSignal(byTag, "XV-101.OpenedFeedback") || findByRegex(byTag, /XV-?101\.Opened/i);
    if (xv101 && xv101.currentValue !== true) reasons.push("START REJECTED — XV-101 NOT OPEN");
    if (xv102.currentValue !== true) reasons.push("START REJECTED — XV-102 NOT OPEN");
  } else if (valve && valve.currentValue !== true) {
    reasons.push("START REJECTED — VALVE-101 NOT OPEN");
  }

  return {
    ok: reasons.length === 0,
    action: "System.Start",
    reasons,
    note: reasons.length
      ? "Permissives failed — Runtime will not treat start as successful"
      : "Permissives OK for start pulse"
  };
}

export function validateSignalCommand(tag, value, signals = []) {
  const t = String(tag || "");
  if ((t === "System.Start" || /RunCommand$/i.test(t)) && (value === true || value === 1)) {
    return evaluateStartPermissives(signals);
  }
  if (/(ESD|ESTOP).*Healthy/i.test(t) && value === false) {
    return {
      ok: true,
      action: t,
      reasons: [],
      warnings: ["Simulated E-stop only — not a certified physical safety function"]
    };
  }
  return { ok: true, action: t, reasons: [], warnings: [] };
}
