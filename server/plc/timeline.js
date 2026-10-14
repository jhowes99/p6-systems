import { enforceSafetyDefaults } from "./safety.js";

// Timeline model (v0):
// {
//   tags: { [name]: { kind:"DI"|"DO", label?:string } },
//   startTag: string, // DI
//   steps: [
//     { action: { tag: "Motor", state: true } },
//     { delayMs: 5000 },
//     { action: { tag: "Valve", state: true } }
//   ]
// }

export function compileTimelineToIR(model) {
  if (!model || typeof model !== "object") throw new Error("Missing model");
  if (!Array.isArray(model.steps) || model.steps.length === 0) throw new Error("No steps");
  const ioMap = new Map(); // tag -> address
  let iIdx = 0, qIdx = 0, mIdx = 0;
  const allocI = () => `I${iIdx++}`;
  const allocQ = () => `Q${qIdx++}`;
  const allocM = () => `M${mIdx++}`;

  const tagMeta = model.tags || {};
  function addrForTag(tag, defaultKind) {
    const t = String(tag);
    if (ioMap.has(t)) return ioMap.get(t);
    const kind = tagMeta?.[t]?.kind || defaultKind;
    const addr = kind === "DO" ? allocQ() : kind === "DI" ? allocI() : allocM();
    ioMap.set(t, addr);
    return addr;
  }

  const startAddr = addrForTag(model.startTag || "Start", "DI");
  const stepBits = model.steps.map((_, idx) => addrForTag(`STEP_${idx}`, "M"));

  const rungs = [];
  // Step0 latches while start is true (simple MVP)
  rungs.push({ cond: { var: startAddr }, actions: [{ type: "COIL", target: stepBits[0] }] });

  // Delays: for any delay step i, create TON that sets step i+1 bit when done
  for (let i = 0; i < model.steps.length; i++) {
    const s = model.steps[i];
    if (typeof s.delayMs === "number") {
      const tname = `T_STEP_${i}`;
      const doneBit = stepBits[i + 1] || addrForTag(`STEP_${i + 1}`, "M");
      // TON action writes done into next step bit when current step bit is on
      rungs.push({
        cond: { var: stepBits[i] },
        actions: [{ type: "TON", name: tname, presetMs: Math.max(0, Math.floor(s.delayMs)), doneTarget: doneBit }]
      });
    } else if (s.action) {
      // When step i is on, apply output action
      const outAddr = addrForTag(s.action.tag, "DO");
      rungs.push({
        cond: { var: stepBits[i] },
        actions: s.action.state ? [{ type: "COIL", target: outAddr }] : [{ type: "RESET", target: outAddr }]
      });
      // Advance immediately to next step (no delay) by setting next step bit when current is on
      if (i + 1 < model.steps.length) {
        rungs.push({
          cond: { var: stepBits[i] },
          actions: [{ type: "COIL", target: stepBits[i + 1] }]
        });
      }
    }
  }

  const ir = {
    language: "ladder",
    networks: [{ rungs }],
    ioMap: Object.fromEntries(ioMap),
    metadata: { generatedFrom: "timeline", tags: tagMeta }
  };
  const safe = enforceSafetyDefaults(ir);
  safe.ir.metadata = safe.ir.metadata || {};
  safe.ir.metadata.warnings = [...(safe.ir.metadata.warnings || []), ...(safe.warnings || [])];
  return safe.ir;
}

