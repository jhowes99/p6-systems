/**
 * Panel-facing exports: terminal plan, wire schedule, I/O checkout.
 * Uses best-effort assumptions when fields are missing.
 */

function escCsv(s) {
  const t = String(s ?? "").replace(/"/g, '""');
  return t.includes(",") || t.includes('"') || t.includes("\n") ? `"${t}"` : t;
}

/**
 * Terminal plan grouped by DI/DO/AI/AO.
 * @param {Array<{ tag, ioType, description?, location?, terminal?, device? }>} ioListEntries
 * @returns {string} CSV
 */
export function exportTerminalPlan(ioListEntries = []) {
  const groups = { DI: [], DO: [], AI: [], AO: [] };
  for (const e of ioListEntries) {
    const t = String(e.ioType || "").toUpperCase().replace(/\s/g, "");
    if (groups[t]) groups[t].push(e);
  }
  const headers = "Group,Terminal,Tag,IO Type,Description,Location,Device";
  const rows = [];
  for (const [grp, entries] of Object.entries(groups)) {
    let termIdx = 1;
    for (const e of entries) {
      const terminal = e.terminal || e.loopNumber || `${grp}-${termIdx++}`;
      rows.push([
        grp,
        terminal,
        e.tag || "",
        e.ioType || "",
        e.description || e.tag || "",
        e.location || e.pidNo || "",
        e.device || e.instrumentType || ""
      ].map(escCsv).join(","));
    }
  }
  return [headers, ...rows].join("\n");
}

/**
 * Wire schedule: From/To, wire number, signal name.
 * @param {Array<{ tag, ioType, description?, location? }>} ioListEntries
 * @returns {string} CSV
 */
export function exportWireSchedule(ioListEntries = []) {
  const headers = "Wire Number,Signal Name,From,To,IO Type";
  let wireNum = 1;
  const rows = ioListEntries.map((e) => {
    const wireId = e.wireNumber || `W${wireNum++}`;
    const from = e.location || "Field";
    const to = e.terminal ? `TB-${e.terminal}` : "PLC";
    return [wireId, e.tag || "", from, to, e.ioType || ""].map(escCsv).join(",");
  });
  return [headers, ...rows].join("\n");
}

/**
 * I/O checkout: steps to force/toggle and expected response (best-effort from IR).
 * @param {Array} ioListEntries
 * @param {object} ir - Ladder IR
 * @param {object} ioMap - tag -> address
 * @returns {string} CSV
 */
export function exportIOCheckout(ioListEntries = [], ir = {}, ioMap = {}) {
  const headers = "Step,Tag,Address,Action,Expected Response,Notes";
  const rows = [];
  let step = 1;
  for (const e of ioListEntries) {
    const tag = e.tag || "";
    const addr = ioMap[tag] || ioMap[tag?.toUpperCase()];
    if (!addr) continue;
    const ioType = String(e.ioType || "").toUpperCase().replace(/\s/g, "");
    let action = "Verify";
    let expected = "As per logic";
    if (ioType === "DI" || ioType === "AI") {
      action = "Force ON / set value";
      expected = "Downstream logic responds";
    } else if (ioType === "DO" || ioType === "AO") {
      action = "Observe when cause conditions met";
      expected = "Output follows C&E";
    }
    rows.push([step++, tag, addr || "", action, expected, e.remark || ""].map(escCsv).join(","));
  }
  return [headers, ...rows].join("\n");
}
