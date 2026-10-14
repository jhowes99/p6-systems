/**
 * Preliminary operator HMI screen config from canonical model.
 * Extensible Ignition path — no live-proven claim.
 */

const SYMBOL_BY_TYPE = {
  pump: "pump",
  motor: "motor",
  valve: "valve",
  tank: "tank",
  sensor: "instrument",
  switch: "switch",
  estop: "estop",
  transmitter: "instrument"
};

function symbolForEquipment(eq) {
  const t = String(eq.type || "").toLowerCase();
  if (SYMBOL_BY_TYPE[t]) return SYMBOL_BY_TYPE[t];
  if (/pump/i.test(eq.tag)) return "pump";
  if (/motor|^M\d/i.test(eq.tag)) return "motor";
  if (/valve|^XV/i.test(eq.tag)) return "valve";
  if (/tank/i.test(eq.tag)) return "tank";
  if (/estop/i.test(eq.tag)) return "estop";
  if (/LSH|LT|FIT|PIT/i.test(eq.tag)) return "instrument";
  return "generic";
}

/**
 * @param {object} project
 * @returns {object} preliminary HMI config
 */
export function generatePreliminaryHmiConfig(project) {
  const signals = project?.signals || [];
  const equipment = project?.equipment || [];
  const interlocks = project?.interlocks || [];

  const byEq = new Map();
  for (const s of signals) {
    if (!s.equipmentId) continue;
    if (!byEq.has(s.equipmentId)) byEq.set(s.equipmentId, []);
    byEq.get(s.equipmentId).push(s);
  }

  const symbols = equipment.map((eq, idx) => {
    const eqSignals = byEq.get(eq.id) || [];
    const levelSig = eqSignals.find((s) => /level|pct/i.test(s.tag) || s.role === "level");
    const statusSigs = eqSignals.filter((s) =>
      /running|energize|opened|healthy|fault|high/i.test(s.tag)
    );
    return {
      id: `sym_${eq.tag || eq.id}`,
      equipmentId: eq.id,
      tag: eq.tag,
      symbol: symbolForEquipment(eq),
      layout: { x: 80 + (idx % 4) * 160, y: 80 + Math.floor(idx / 4) * 120 },
      bindings: {
        statusTags: statusSigs.map((s) => s.tag),
        levelTag: levelSig?.tag || null,
        commandTags: eqSignals
          .filter((s) => /command|start|open/i.test(s.tag))
          .map((s) => s.tag)
      }
    };
  });

  const alarms = signals
    .filter((s) => /fault|alarm|high|trip|estop/i.test(s.tag))
    .map((s) => ({
      tag: s.tag,
      priority: /estop|trip/i.test(s.tag) ? "high" : "medium",
      text: s.description || s.tag
    }));

  const levels = symbols
    .filter((s) => s.bindings.levelTag)
    .map((s) => ({ equipmentTag: s.tag, tag: s.bindings.levelTag }));

  const valves = symbols.filter((s) => s.symbol === "valve").map((s) => ({
    tag: s.tag,
    openCommand: s.bindings.commandTags[0] || null,
    openedFeedback: s.bindings.statusTags.find((t) => /opened/i.test(t)) || null
  }));

  return {
    ok: true,
    kind: "preliminary_hmi_config",
    version: 1,
    projectId: project?.id || null,
    modelVersion: project?.modelVersion ?? null,
    screen: {
      name: `${project?.name || "P6"} Operator Overview`,
      type: "overview",
      symbols,
      tags: signals.map((s) => ({ tag: s.tag, address: s.address || null })),
      status: symbols.map((s) => ({
        equipmentTag: s.tag,
        statusTags: s.bindings.statusTags
      })),
      alarms,
      levels,
      valves,
      interlockCallouts: interlocks.map((i) => ({
        name: i.name,
        action: i.actionDescription || ""
      }))
    },
    ignitionPath: {
      status: "extensible_stub",
      liveProven: false,
      note:
        "Preliminary config only. Ignition Perspective / UDT binding is proposal-path via Connect — not live-proven (KI-019).",
      suggestedUdtExport: "/api/connect/engineering/udt"
    },
    honestyLabel:
      "Preliminary operator screen config from model — not a commissioned HMI and not live Ignition."
  };
}
