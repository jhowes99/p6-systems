/**
 * P6 X-Ray — visual engineering intelligence (§18–§19).
 * Builds dependency chains and start-inhibit root cause from live signals + model.
 * No fabricated blockers — only evaluated conditions.
 */

import { loadProject, getActiveProject } from "./store.js";
import {
  buildModelGraph,
  findRoleSignals,
  getConnectedEquipmentIds,
  getInterlocksForEquipment,
  getRelatedTestCases
} from "./model_adapter.js";
import { evaluateCondition } from "./interlocks_view.js";

function sigVal(signals, ...tags) {
  const byTag = Object.fromEntries((signals || []).map((s) => [s.tag, s]));
  for (const t of tags) {
    if (byTag[t]) return byTag[t];
  }
  return null;
}

/** Prefer tags that exist on the project model so a mismatched Runtime cannot pick foreign demo tags. */
function sigValPreferProject(project, signals, ...tags) {
  const projectTags = new Set((project?.signals || []).map((s) => s.tag));
  const preferred = tags.filter((t) => projectTags.has(t));
  const order = preferred.length ? [...preferred, ...tags.filter((t) => !projectTags.has(t))] : tags;
  return sigVal(signals, ...order);
}

function findByRe(signals, re) {
  return (signals || []).find((s) => re.test(s.tag)) || null;
}

function findByRePreferProject(project, signals, re) {
  const projectTags = new Set((project?.signals || []).map((s) => s.tag));
  const inProject = (signals || []).find((s) => projectTags.has(s.tag) && re.test(s.tag));
  return inProject || findByRe(signals, re);
}

/** Real Verify catalog entries that may apply (ids/names only — no fake results). */
const VERIFY_CATALOG = [
  {
    id: "P101_ESTOP_SHUTDOWN",
    name: "P101 E-Stop Shutdown",
    description: "Verify pump stops and trip latch sets when ESD is not healthy (sim FAT)."
  }
];

function matchVerifyHints(equipment, conditions, interlocks, modelTests = []) {
  const hints = [];
  const seen = new Set();
  for (const tc of modelTests || []) {
    const id = tc.name || tc.id;
    const cat = VERIFY_CATALOG.find((t) => t.id === id || t.name === id);
    if (cat && !seen.has(cat.id)) {
      seen.add(cat.id);
      hints.push({ id: cat.id, name: cat.name, description: cat.description });
    }
  }
  const tags = [
    equipment?.tag,
    ...(conditions || []).map((c) => c.signalTag),
    ...(conditions || []).map((c) => c.equipmentTag)
  ]
    .filter(Boolean)
    .join(" ");
  const text = `${tags} ${(interlocks || []).map((i) => i.name || "").join(" ")}`;
  for (const t of VERIFY_CATALOG) {
    if (seen.has(t.id)) continue;
    if (/PUMP|P-?101|ESD|ESTOP|E-?STOP/i.test(text) && /ESTOP|ESD|SHUTDOWN/i.test(t.id + t.name)) {
      hints.push({ id: t.id, name: t.name, description: t.description });
    }
  }
  return hints;
}

function classifyConditionGroup(c) {
  if (c.blocking) return "blockers";
  if (c.interlockId || /esd|level_high|interlock/i.test(c.id || "") || /interlock/i.test(c.label || "")) {
    return "interlocks";
  }
  if (/running|motor|flow/i.test(c.id || "")) return "feedback";
  if (/valve|trip_latch|ready|permissive/i.test(c.id || "")) return "permissives";
  return "permissives";
}

function buildWarnings(conditions) {
  const warnings = [];
  const running = conditions.find((c) => c.id === "running");
  const flow = conditions.find((c) => c.id === "flow");
  const motor = conditions.find((c) => c.id === "motor");
  if (running?.value === true && flow && Number(flow.value) <= 1) {
    warnings.push({
      id: "warn_no_flow_while_running",
      label: "No flow while pump claims running",
      status: "WARNING",
      detail: `${running.signalTag || "Running"} is true but ${flow.signalTag || "flow"} ≤ 1 (diagnostic classification only).`,
      signalTag: flow.signalTag,
      equipmentId: flow.equipmentId,
      equipmentTag: flow.equipmentTag,
      value: flow.value
    });
  }
  if (motor?.value === true && running && running.value !== true) {
    warnings.push({
      id: "warn_motor_no_run_fb",
      label: "Motor energized without running feedback",
      status: "WARNING",
      detail: `${motor.signalTag || "Motor"} energized but running feedback is false (diagnostic classification only).`,
      signalTag: running.signalTag,
      equipmentId: running.equipmentId,
      equipmentTag: running.equipmentTag,
      value: running.value
    });
  }
  return warnings;
}

function buildPath(chain, conditions) {
  const byStep = Object.fromEntries((chain || []).map((s) => [s.step, s]));
  const order = ["INPUT", "INTERLOCK", "PERMISSIVE", "LOGIC", "OUTPUT", "EQUIPMENT"];
  const roleOf = {
    INPUT: "INPUT",
    INTERLOCK: "INTERLOCK",
    PERMISSIVE: "PERMISSIVE",
    LOGIC: "LOGIC",
    OUTPUT: "OUTPUT",
    EQUIPMENT: "EQUIPMENT"
  };
  const path = [];
  for (const step of order) {
    const c = byStep[step];
    if (!c) continue;
    const matchedCond = (conditions || []).find(
      (cond) =>
        (cond.signalTag && cond.signalTag === c.tag) ||
        (step === "LOGIC" && cond.id === "trip_latch") ||
        (step === "OUTPUT" && cond.id === "motor") ||
        (step === "EQUIPMENT" && cond.id === "running") ||
        (step === "PERMISSIVE" && cond.id === "valve") ||
        (step === "INPUT" && cond.id === "esd") ||
        (step === "INTERLOCK" && cond.id === "level_high")
    );
    path.push({
      role: roleOf[step] || step,
      step,
      tag: c.tag,
      value: c.value,
      address: c.address || null,
      status: matchedCond?.status || (step === "LOGIC" ? (c.value?.tripLatched ? "BLOCKING" : "READY") : null),
      blocking: !!matchedCond?.blocking || (step === "LOGIC" && !!c.value?.tripLatched),
      detail: matchedCond?.detail || null,
      equipmentId: c.equipmentId || matchedCond?.equipmentId || null,
      equipmentTag: c.equipmentTag || matchedCond?.equipmentTag || null,
      interlockId: matchedCond?.interlockId || null,
      interlockName: matchedCond?.interlockName || null,
      rootCauseHint: matchedCond?.rootCauseHint || null,
      label: matchedCond?.label || step,
      conditionId: matchedCond?.id || null
    });
  }
  return path;
}

function buildNarrative({ equipment, title, canStart, inhibited, primaryBlocker, conditions, warnings, note }) {
  const paras = [];
  paras.push(`${title}. Operating state on model: ${equipment.operatingState || "unknown"}.`);
  if (inhibited && primaryBlocker) {
    paras.push(
      `Start is inhibited. Primary blocker: ${primaryBlocker.label} — ${primaryBlocker.detail || primaryBlocker.status}.` +
        (primaryBlocker.signalTag ? ` Live: ${primaryBlocker.signalTag} = ${JSON.stringify(primaryBlocker.value)}.` : "")
    );
  } else if (canStart) {
    paras.push("No blocking conditions evaluated — equipment appears ready to start (sim).");
  } else {
    const running = conditions.find((c) => c.id === "running");
    if (running?.value) {
      paras.push("Pump reports running; start is not offered while already running (sim).");
    } else {
      paras.push("No start inhibit blockers; see feedback and permissives below.");
    }
  }
  const clear = conditions.filter((c) => !c.blocking);
  const blocking = conditions.filter((c) => c.blocking);
  if (blocking.length) {
    paras.push(
      `Blocking (${blocking.length}): ` +
        blocking.map((c) => `${c.label} [${c.status}]`).join("; ") +
        "."
    );
  }
  if (clear.length) {
    paras.push(
      `Clear / observe (${clear.length}): ` +
        clear.map((c) => `${c.label} [${c.status}]${c.detail ? ` — ${c.detail}` : ""}`).join("; ") +
        "."
    );
  }
  for (const w of warnings || []) {
    paras.push(`Warning: ${w.detail || w.label}`);
  }
  if (note) paras.push(note);
  return paras;
}

function buildGroups(conditions, interlocks, warnings) {
  const groups = {
    feedback: [],
    permissives: [],
    blockers: [],
    interlocks: [],
    warnings: warnings || []
  };
  for (const c of conditions || []) {
    const g = classifyConditionGroup(c);
    if (g === "blockers") {
      groups.blockers.push(c);
      // Also surface interlock-linked blockers under interlocks for the dashboard
      if (c.interlockId || /esd|level_high/i.test(c.id || "")) {
        groups.interlocks.push(c);
      }
    } else {
      groups[g].push(c);
    }
  }
  // Related model interlocks not already represented as conditions
  const seenIlk = new Set(groups.interlocks.map((c) => c.interlockId).filter(Boolean));
  for (const ilk of interlocks || []) {
    if (seenIlk.has(ilk.id)) continue;
    groups.interlocks.push({
      id: `ilk_${ilk.id}`,
      label: ilk.name || "Interlock",
      status: "RELATED",
      blocking: false,
      detail: ilk.actionDescription || "",
      interlockId: ilk.id,
      interlockName: ilk.name,
      signalTag: null,
      value: null
    });
  }
  return groups;
}

function buildHealth({ equipment, title, canStart, inhibited, primaryBlocker, conditions, warnings }) {
  const blocking = (conditions || []).filter((c) => c.blocking);
  const clear = (conditions || []).filter((c) => !c.blocking);
  let state = "READY";
  if (inhibited) state = "INHIBITED";
  else if (conditions.find((c) => c.id === "running")?.value) state = "RUNNING";
  else if (canStart) state = "READY";
  return {
    title,
    operatingState: equipment.operatingState || null,
    state,
    inhibited: !!inhibited,
    canStart: !!canStart,
    primaryBlocker: primaryBlocker
      ? {
          id: primaryBlocker.id,
          label: primaryBlocker.label,
          status: primaryBlocker.status,
          detail: primaryBlocker.detail,
          signalTag: primaryBlocker.signalTag,
          value: primaryBlocker.value,
          equipmentId: primaryBlocker.equipmentId,
          equipmentTag: primaryBlocker.equipmentTag
        }
      : null,
    blockingCount: blocking.length,
    clearCount: clear.length,
    warningCount: (warnings || []).length
  };
}

/**
 * Evaluate why a pump/motor cannot start (or is inhibited).
 * @param {object} opts
 * @param {string} [opts.projectId]
 * @param {string} opts.equipmentId
 * @param {object[]} opts.signals - live signal snapshots from runtime bridge
 * @param {object} [opts.mem] - { M0, M1 }
 */
export function analyzeEquipmentXRay({ projectId, equipmentId, equipmentTag, signals = [], mem = {} } = {}) {
  const project = projectId ? loadProject(projectId) : getActiveProject();
  if (!project) throw new Error("No project");

  const equipment =
    project.equipment.find((e) => e.id === equipmentId) ||
    project.equipment.find((e) => e.tag === String(equipmentTag || "").toUpperCase());
  if (!equipment) throw new Error("Equipment not found");

  const eqSignals = signals.filter((s) => s.equipmentId === equipment.id);
  const related = [];

  // Prefer canonical relationships (interlocks + connection walks) before tag-regex fallbacks.
  const roleSigs = findRoleSignals(project, equipment.id, signals);
  const esd =
    roleSigs.esd ||
    sigValPreferProject(project, signals, "ESTOP101.Healthy", "ESD-101.Healthy") ||
    findByRePreferProject(project, signals, /ESD|ESTOP.*Healthy/i);
  const high =
    roleSigs.level_high ||
    sigValPreferProject(project, signals, "LSH101.High", "LT-101.High", "LT-102.High") ||
    findByRePreferProject(project, signals, /High$/i);
  const valveOpen =
    roleSigs.valve_open ||
    sigValPreferProject(project, signals, "XV101.OpenedFeedback", "XV-101.OpenedFeedback", "VALVE-101.OpenedFeedback") ||
    findByRePreferProject(project, signals, /VALVE-?101\.Opened|XV-?101\.Opened/i);
  const valveCmd =
    roleSigs.valve_cmd ||
    sigValPreferProject(project, signals, "XV101.OpenCommand", "XV-101.OpenCommand", "VALVE-101.OpenCommand") ||
    findByRePreferProject(project, signals, /VALVE-?101\.OpenCommand|XV-?101\.OpenCommand/i);
  const running =
    roleSigs.running ||
    sigValPreferProject(project, signals, "P101.RunningFeedback", "P-101.RunningFeedback", "PUMP-101.RunningFeedback") ||
    findByRePreferProject(project, signals, /RunningFeedback/i);
  const motor =
    roleSigs.motor ||
    sigValPreferProject(project, signals, "M101.Energize", "M-101.Energize") ||
    findByRePreferProject(project, signals, /Energize/i);
  const flow =
    roleSigs.flow ||
    sigValPreferProject(project, signals, "FIT-101.FlowGpm") ||
    findByRePreferProject(project, signals, /FlowGpm|Flow/i);

  function rootForSignal(sig) {
    if (!sig) return { equipmentId: null, equipmentTag: null };
    let eq = sig.equipmentId ? project.equipment.find((e) => e.id === sig.equipmentId) : null;
    if (!eq && sig.tag) {
      const prefix = String(sig.tag).split(".")[0];
      eq = project.equipment.find((e) => e.tag === prefix);
    }
    return { equipmentId: eq?.id || null, equipmentTag: eq?.tag || null };
  }

  function findInterlockForSignal(sig) {
    if (!sig) return null;
    return (project.interlocks || []).find(
      (ilk) =>
        (ilk.conditionSignalIds || []).includes(sig.id) ||
        (ilk.conditionSignalIds || []).some((sid) => {
          const s = (project.signals || []).find((x) => x.id === sid);
          return s && s.tag === sig.tag;
        })
    );
  }

  const conditions = [];

  if (esd) {
    const ev = evaluateCondition(esd);
    const healthy = !ev.active;
    const root = rootForSignal(esd);
    const ilk = findInterlockForSignal(esd);
    conditions.push({
      id: "esd",
      label: "Emergency stop",
      signalTag: esd.tag,
      value: esd.currentValue,
      address: esd.address || null,
      status: healthy ? "HEALTHY" : "BLOCKING",
      blocking: !healthy,
      detail: healthy ? "ESD healthy (sim)" : "ESD ACTIVE — start inhibited (sim)",
      ...root,
      interlockId: ilk?.id || null,
      interlockName: ilk?.name || null,
      rootCauseHint: healthy
        ? "ESD clear — not the blocker"
        : "Root cause: emergency stop not healthy — open ESD equipment / interlock",
      derivedFrom: roleSigs.esd ? "model" : "heuristic"
    });
  }

  if (high) {
    const ev = evaluateCondition(high);
    const isHigh = ev.active;
    const root = rootForSignal(high);
    const ilk = findInterlockForSignal(high);
    conditions.push({
      id: "level_high",
      label: "Destination high level",
      signalTag: high.tag,
      value: high.currentValue,
      address: high.address || null,
      status: isHigh ? "BLOCKING" : "READY",
      blocking: isHigh,
      detail: isHigh ? "High level interlock active" : "Level interlock clear",
      ...root,
      interlockId: ilk?.id || null,
      interlockName: ilk?.name || null,
      rootCauseHint: isHigh
        ? "Root cause: destination high level — open LT / high-level interlock"
        : "Level clear — not the blocker",
      derivedFrom: roleSigs.level_high ? "model" : "heuristic"
    });
  }

  if (valveOpen) {
    const open = valveOpen.currentValue === true;
    const root = rootForSignal(valveOpen);
    conditions.push({
      id: "valve",
      label: "Discharge valve open",
      signalTag: valveOpen.tag,
      value: valveOpen.currentValue,
      address: valveOpen.address || null,
      status: open ? "READY" : "BLOCKING",
      blocking: !open,
      detail: open ? "Valve opened feedback true" : "VALVE NOT OPEN — start inhibited",
      ...root,
      interlockId: null,
      interlockName: null,
      rootCauseHint: open
        ? "Valve permissive satisfied"
        : "Root cause: discharge valve not open — select valve and issue Open (sim)",
      derivedFrom: roleSigs.valve_open ? "model" : "heuristic"
    });
  }

  const trip = !!mem.M1;
  conditions.push({
    id: "trip_latch",
    label: "Trip latch (M1)",
    signalTag: "TripLatched",
    value: trip,
    address: "M1",
    status: trip ? "BLOCKING" : "READY",
    blocking: trip,
    detail: trip ? "Trip latched — System.Reset required" : "No trip latch",
    equipmentId: equipment.id,
    equipmentTag: equipment.tag,
    interlockId: null,
    interlockName: null,
    rootCauseHint: trip
      ? "Root cause: trip latch M1 — use System.Reset (sim) after clearing faults"
      : "Trip latch clear"
  });

  if (running) {
    const root = rootForSignal(running);
    conditions.push({
      id: "running",
      label: "Pump running feedback",
      signalTag: running.tag,
      value: running.currentValue,
      address: running.address || null,
      status: running.currentValue ? "RUNNING" : "STOPPED",
      blocking: false,
      detail: running.currentValue ? "Pump reports running" : "Pump not running",
      ...root,
      interlockId: null,
      interlockName: null,
      rootCauseHint: "Running feedback — observe pump equipment on canvas"
    });
  }

  if (motor) {
    const root = rootForSignal(motor);
    conditions.push({
      id: "motor",
      label: "Motor energize",
      signalTag: motor.tag,
      value: motor.currentValue,
      address: motor.address || null,
      status: motor.currentValue ? "ENERGIZED" : "DEENERGIZED",
      blocking: false,
      detail: motor.currentValue ? "Motor output energized" : "Motor de-energized",
      ...root,
      interlockId: null,
      interlockName: null,
      rootCauseHint: "Motor output — open motor equipment on canvas"
    });
  }

  if (flow) {
    const root = rootForSignal(flow);
    conditions.push({
      id: "flow",
      label: "Process flow",
      signalTag: flow.tag,
      value: flow.currentValue,
      address: flow.address || null,
      status: Number(flow.currentValue) > 1 ? "FLOWING" : "NO FLOW",
      blocking: false,
      detail: `Flow = ${flow.currentValue} ${flow.units || ""}`.trim(),
      ...root,
      interlockId: null,
      interlockName: null,
      rootCauseHint: "Flow transmitter — observe FIT on canvas"
    });
  }

  if (valveCmd) {
    related.push({
      role: "valve_command",
      signalTag: valveCmd.tag,
      value: valveCmd.currentValue,
      address: valveCmd.address || null
    });
  }

  const blockers = conditions.filter((c) => c.blocking);
  const primary = blockers[0] || null;

  // Highlight equipment along the inhibit path
  const highlightTags = new Set([equipment.tag]);
  const highlightIds = new Set([equipment.id]);
  for (const c of conditions) {
    if (!c.signalTag) continue;
    const s = signals.find((x) => x.tag === c.signalTag);
    if (s?.equipmentId) {
      highlightIds.add(s.equipmentId);
      const eq = project.equipment.find((e) => e.id === s.equipmentId);
      if (eq) highlightTags.add(eq.tag);
    } else if (c.equipmentId) {
      highlightIds.add(c.equipmentId);
      if (c.equipmentTag) highlightTags.add(c.equipmentTag);
    }
  }
  // Connection-walk neighbors from canonical model
  for (const nid of getConnectedEquipmentIds(project, equipment.id)) {
    highlightIds.add(nid);
  }
  for (const conn of project.connections || []) {
    if (highlightIds.has(conn.fromEquipmentId) || highlightIds.has(conn.toEquipmentId)) {
      highlightIds.add(conn.fromEquipmentId);
      highlightIds.add(conn.toEquipmentId);
    }
  }
  for (const id of highlightIds) {
    const eq = project.equipment.find((e) => e.id === id);
    if (eq) highlightTags.add(eq.tag);
  }

  const interlocks = getInterlocksForEquipment(project, equipment.id);

  const chain = [];
  const pushChain = (step, sig, extra = {}) => {
    if (!sig) return;
    const root = rootForSignal(sig);
    chain.push({
      step,
      tag: sig.tag,
      value: sig.currentValue,
      address: sig.address,
      ...root,
      ...extra
    });
  };
  pushChain("INPUT", esd);
  pushChain("INTERLOCK", high);
  pushChain("PERMISSIVE", valveOpen);
  chain.push({
    step: "LOGIC",
    tag: "M0/M1",
    value: { transferRequest: !!mem.M0, tripLatched: !!mem.M1 },
    equipmentId: equipment.id,
    equipmentTag: equipment.tag
  });
  pushChain("OUTPUT", motor);
  pushChain("EQUIPMENT", running);

  const title =
    /pump|motor/i.test(equipment.type) || /PUMP|M-101|P-101|P101/i.test(equipment.tag)
      ? blockers.length
        ? `${equipment.tag} — START INHIBITED`
        : running?.currentValue
          ? `${equipment.tag} — RUNNING`
          : `${equipment.tag} — READY TO START`
      : `${equipment.tag} — X-RAY`;

  const canStart = blockers.length === 0 && !running?.currentValue;
  const inhibited = blockers.length > 0;
  const interlockSummaries = interlocks.map((i) => ({
    id: i.id,
    name: i.name,
    actionDescription: i.actionDescription
  }));
  const warnings = buildWarnings(conditions);
  const health = buildHealth({
    equipment,
    title,
    canStart,
    inhibited,
    primaryBlocker: primary,
    conditions,
    warnings
  });
  const groups = buildGroups(conditions, interlockSummaries, warnings);
  const path = buildPath(chain, conditions);
  const narrative = buildNarrative({
    equipment,
    title,
    canStart,
    inhibited,
    primaryBlocker: primary,
    conditions,
    warnings,
    note: "Simulated analysis only — not a certified physical safety assessment."
  });
  const modelTests = getRelatedTestCases(project, { equipmentId: equipment.id });
  const verifyHints = matchVerifyHints(equipment, conditions, interlockSummaries, modelTests);
  const modelGraph = buildModelGraph(project, { equipmentId: equipment.id });

  return {
    ok: true,
    mode: "xray",
    title,
    relationshipSource: "canonical_model_preferred",
    equipment: {
      id: equipment.id,
      tag: equipment.tag,
      type: equipment.type,
      operatingState: equipment.operatingState
    },
    canStart,
    inhibited,
    primaryBlocker: primary,
    conditions,
    related,
    chain,
    health,
    groups,
    path,
    narrative,
    verifyHints,
    highlightEquipmentIds: [...highlightIds],
    highlightTags: [...highlightTags],
    highlightConnectionIds: (project.connections || [])
      .filter((c) => highlightIds.has(c.fromEquipmentId) && highlightIds.has(c.toEquipmentId))
      .map((c) => c.id),
    interlocks: interlockSummaries,
    modelGraph,
    equipmentSignals: eqSignals.map((s) => ({
      tag: s.tag,
      value: s.currentValue,
      address: s.address,
      direction: s.direction,
      units: s.units || ""
    })),
    note: "Simulated analysis only — not a certified physical safety assessment."
  };
}
