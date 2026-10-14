/**
 * Live Interlocks view for Studio — conditions, inhibits, and active state.
 * Simulated analysis only; not a certified safety assessment.
 */

import { getActiveProject, loadProject } from "./store.js";

/** Healthy/Ok style signals trip when FALSE; High/Fault style trip when TRUE. */
export function conditionPolarity(signalTag = "") {
  const t = String(signalTag || "");
  if (/Healthy|OK|Ok|Permissive|Ready|Enable/i.test(t)) return "fail_low";
  if (/High|Low|Fault|Trip|Alarm|Estop|ESD|Stop|Inhibit/i.test(t)) return "fail_high";
  return "fail_high";
}

export function evaluateCondition(signal) {
  if (!signal) {
    return { active: false, status: "missing", detail: "Signal not in model" };
  }
  const polarity = conditionPolarity(signal.tag);
  const raw = signal.currentValue;
  const truthy = raw === true || raw === 1 || raw === "1" || raw === "true";
  const falsy = raw === false || raw === 0 || raw === "0" || raw === "false" || raw == null;
  let active = false;
  if (polarity === "fail_low") active = falsy && !truthy;
  else active = truthy;
  return {
    active,
    status: active ? "TRIP" : "CLEAR",
    polarity,
    value: raw,
    detail:
      polarity === "fail_low"
        ? active
          ? `${signal.tag} is FALSE — trip / not healthy`
          : `${signal.tag} is TRUE — healthy`
        : active
          ? `${signal.tag} is TRUE — trip condition`
          : `${signal.tag} is FALSE — clear`
  };
}

/**
 * Enrich project interlocks with live Runtime signal values.
 */
export function buildInterlocksView({ projectId = null, signals = [], equipmentId = null } = {}) {
  const project = projectId ? loadProject(projectId) : getActiveProject();
  if (!project) throw new Error("No active project");

  const sigById = new Map((signals || []).map((s) => [s.id, s]));
  // Fallback to project signal defs merged with live values by tag
  for (const s of project.signals || []) {
    if (!sigById.has(s.id)) {
      const live = (signals || []).find((x) => x.tag === s.tag);
      sigById.set(s.id, live ? { ...s, currentValue: live.currentValue, address: live.address || s.address } : s);
    }
  }
  const eqById = new Map((project.equipment || []).map((e) => [e.id, e]));

  let items = (project.interlocks || []).map((ilk) => {
    const conditions = (ilk.conditionSignalIds || []).map((sid) => {
      const sig = sigById.get(sid) || (project.signals || []).find((s) => s.id === sid);
      const ev = evaluateCondition(sig);
      const eq = sig?.equipmentId ? eqById.get(sig.equipmentId) : null;
      return {
        signalId: sid,
        signalTag: sig?.tag || sid,
        address: sig?.address || null,
        equipmentId: sig?.equipmentId || null,
        equipmentTag: eq?.tag || null,
        ...ev
      };
    });
    const inhibits = (ilk.inhibitsEquipmentIds || []).map((eid) => {
      const eq = eqById.get(eid);
      return {
        equipmentId: eid,
        tag: eq?.tag || eid,
        type: eq?.type || "equipment",
        operatingState: eq?.operatingState || null
      };
    });
    const active = conditions.some((c) => c.active);
    const highlightEquipmentIds = [
      ...new Set([
        ...conditions.map((c) => c.equipmentId).filter(Boolean),
        ...inhibits.map((i) => i.equipmentId)
      ])
    ];
    const highlightTags = [
      ...new Set([
        ...conditions.map((c) => c.equipmentTag || c.signalTag?.split(".")[0]).filter(Boolean),
        ...inhibits.map((i) => i.tag)
      ])
    ];
    return {
      id: ilk.id,
      name: ilk.name,
      actionDescription: ilk.actionDescription || "",
      dataClass: ilk.dataClass || "ENGINEERING_INFERENCE",
      active,
      status: active ? "ACTIVE" : "CLEAR",
      conditions,
      inhibits,
      highlightEquipmentIds,
      highlightTags,
      chain: [
        ...conditions.map((c) => ({
          step: "CONDITION",
          tag: c.signalTag,
          value: c.value,
          status: c.status,
          detail: c.detail
        })),
        {
          step: "ACTION",
          tag: ilk.name,
          value: active ? "INHIBIT" : "ALLOW",
          status: active ? "ACTIVE" : "CLEAR",
          detail: ilk.actionDescription || "Inhibit listed equipment when condition trips"
        },
        ...inhibits.map((i) => ({
          step: "INHIBITS",
          tag: i.tag,
          value: i.operatingState,
          status: active ? "BLOCKED" : "FREE",
          detail: `${i.tag} (${i.type})`
        }))
      ]
    };
  });

  if (equipmentId) {
    items = items.filter(
      (i) =>
        i.highlightEquipmentIds.includes(equipmentId) ||
        i.inhibits.some((x) => x.equipmentId === equipmentId)
    );
  }

  const activeCount = items.filter((i) => i.active).length;
  return {
    ok: true,
    projectId: project.id,
    projectName: project.name,
    count: items.length,
    activeCount,
    interlocks: items,
    note: "Simulated interlock view from the P6 model + live Runtime signals — not a certified physical safety function."
  };
}

export function buildInterlockDetail(interlockId, opts = {}) {
  const view = buildInterlocksView(opts);
  const item = view.interlocks.find((i) => i.id === interlockId);
  if (!item) throw new Error(`Interlock not found: ${interlockId}`);
  return { ok: true, ...view, interlock: item, interlocks: view.interlocks };
}
