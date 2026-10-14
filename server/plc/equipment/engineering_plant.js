/**
 * Generic engineering plant for imported / non-demo projects.
 * Valve travel + pump run feedback from model signals so Simulate works
 * without Tank/Water Transfer demo ladders.
 */

import { DataClass, DataType, SignalDirection, createSignal } from "../../model/schema.js";
import { EquipmentLibrary } from "./library.js";

function libForType(type) {
  const t = String(type || "").toLowerCase();
  if (/valve/.test(t)) return EquipmentLibrary.Valve;
  if (/pump/.test(t)) return EquipmentLibrary.Pump;
  if (/motor/.test(t)) return EquipmentLibrary.Motor;
  if (/tank|vessel/.test(t)) return EquipmentLibrary.Tank;
  if (/estop|emergency/.test(t)) return EquipmentLibrary.EmergencyStopInput;
  if (/level_switch|lsh|lsl/.test(t)) return EquipmentLibrary.LevelSwitch;
  if (/level/.test(t)) return EquipmentLibrary.LevelTransmitter;
  if (/flow/.test(t)) return EquipmentLibrary.FlowTransmitter;
  if (/pressure/.test(t)) return EquipmentLibrary.PressureTransmitter;
  return null;
}

function defaultDirection(sigName) {
  if (/Command|RunCommand|OpenCommand|CloseCommand|Energize$/i.test(sigName) && !/Feedback/i.test(sigName)) {
    return SignalDirection.INPUT;
  }
  return SignalDirection.OUTPUT;
}

function defaultInitial(sigName) {
  if (/Healthy/i.test(sigName)) return true;
  if (/LevelPct/i.test(sigName)) return 50;
  if (/ClosedFeedback/i.test(sigName)) return true;
  return false;
}

function preferredAddrPrefix(sigName, direction) {
  if (/LevelPct|FlowGpm|Pv/i.test(sigName)) return "A";
  if (direction === SignalDirection.INPUT || /Command/i.test(sigName)) return "I";
  return "Q";
}

function nextAddr(used, prefix) {
  let n = 0;
  while (used.has(`${prefix}${n}`)) n += 1;
  used.add(`${prefix}${n}`);
  return `${prefix}${n}`;
}

/**
 * Ensure actuated equipment has library signals + PLC addresses.
 */
export function ensureEngineeringSignals(project) {
  if (!project) return { addedSignals: 0, addressed: 0 };
  if (!project.signals) project.signals = [];
  const used = new Set(
    (project.signals || []).map((s) => String(s.address || "").toUpperCase()).filter(Boolean)
  );
  let addedSignals = 0;
  let addressed = 0;

  for (const eq of project.equipment || []) {
    const lib = libForType(eq.type);
    if (!lib?.signals?.length) continue;
    for (const leaf of lib.signals) {
      const tag = `${eq.tag}.${leaf}`;
      let sig = project.signals.find((s) => s.tag === tag);
      if (!sig) {
        const direction = defaultDirection(leaf);
        sig = createSignal({
          projectId: project.id,
          tag,
          dataType: /LevelPct|FlowGpm|Pv/i.test(leaf) ? DataType.REAL : DataType.BOOL,
          direction,
          initialValue: defaultInitial(leaf),
          equipmentId: eq.id,
          dataClass: DataClass.ENGINEERING_INFERENCE,
          source: "p6.engineering_plant"
        });
        project.signals.push(sig);
        addedSignals += 1;
      }
      if (!sig.address) {
        sig.address = nextAddr(used, preferredAddrPrefix(leaf, sig.direction));
        addressed += 1;
      } else {
        used.add(String(sig.address).toUpperCase());
      }
    }
  }

  for (const leaf of ["System.Start", "System.Reset"]) {
    let sig = project.signals.find((s) => s.tag === leaf);
    if (!sig) {
      sig = createSignal({
        projectId: project.id,
        tag: leaf,
        dataType: DataType.BOOL,
        direction: SignalDirection.INPUT,
        initialValue: false,
        dataClass: DataClass.ENGINEERING_INFERENCE,
        source: "p6.engineering_plant"
      });
      project.signals.push(sig);
      addedSignals += 1;
    }
    if (!sig.address) {
      sig.address = nextAddr(used, "I");
      addressed += 1;
    }
  }

  project.meta = {
    ...(project.meta || {}),
    plantTemplate: "engineering",
    samplePlant: false
  };
  return { addedSignals, addressed };
}

function addrMap(project) {
  const map = new Map();
  for (const s of project.signals || []) {
    if (s.tag && s.address) map.set(s.tag, String(s.address).toUpperCase());
  }
  return map;
}

function readBool(io, addr) {
  if (!addr) return false;
  return !!io.effectiveValue?.(addr);
}

function readAnalog(io, addr) {
  if (!addr) return 0;
  if (addr.startsWith("A")) return Number(io.analogInputs?.[addr] ?? 0);
  if (addr.startsWith("B")) return Number(io.analogOutputs?.[addr] ?? 0);
  return 0;
}

function writeBool(io, addr, value) {
  if (!addr) return;
  if (addr.startsWith("Q")) {
    io.ensureOutput?.(addr);
    io.outputs[addr] = !!value;
  } else if (addr.startsWith("I")) {
    io.ensureInput?.(addr);
    io.inputs[addr] = !!value;
  } else if (addr.startsWith("M")) {
    io.ensureMem?.(addr);
    io.mem[addr] = !!value;
  }
}

function writeAnalog(io, addr, value) {
  if (!addr) return;
  const n = Number(value) || 0;
  if (addr.startsWith("A")) {
    io.ensureAnalogInput?.(addr);
    io.analogInputs[addr] = n;
  } else if (addr.startsWith("B")) {
    io.ensureAnalogOutput?.(addr);
    io.analogOutputs[addr] = n;
  }
}

/**
 * Attach generic equipment behavior for a non-demo project.
 */
export function attachEngineeringPlant(plc, io, project) {
  ensureEngineeringSignals(project);
  const amap = addrMap(project);

  const valves = (project.equipment || []).filter((e) => /valve/i.test(e.type));
  const pumps = (project.equipment || []).filter((e) => /pump/i.test(e.type));
  const motors = (project.equipment || []).filter((e) => /motor/i.test(e.type));
  const tanks = (project.equipment || []).filter((e) => /tank|vessel/i.test(e.type));

  /** Remaining travel scans before open/close completes (0 = steady). */
  const travel = new Map();
  /** Plant-owned valve position — do not trust Q bits (ladder may clear them). */
  const valveOpen = new Map();
  const TRAVEL = 3;

  // Always replace any leftover demo ladder IR — engineering plant owns Q feedbacks.
  plc.setProgramIR?.({ language: "ladder", networks: [{ rungs: [] }] });

  plc.equipmentStep = ({ io: scanIo }) => {
    const bus = scanIo || io;

    for (const v of valves) {
      const cmdA = amap.get(`${v.tag}.OpenCommand`);
      const openA = amap.get(`${v.tag}.OpenedFeedback`);
      const closeA = amap.get(`${v.tag}.ClosedFeedback`);
      const cmd = readBool(bus, cmdA);
      let isOpen = valveOpen.has(v.id) ? valveOpen.get(v.id) : false;
      let rem = travel.get(v.id) || 0;

      if (cmd && !isOpen) {
        // Opening travel: rem counts down; feedback stays closed until done
        if (rem <= 0) rem = TRAVEL;
        rem -= 1;
        travel.set(v.id, rem);
        if (rem <= 0) {
          isOpen = true;
          valveOpen.set(v.id, true);
          travel.set(v.id, 0);
          v.operatingState = "open";
        } else {
          v.operatingState = "opening";
        }
      } else if (!cmd && isOpen) {
        // Closing travel: rem counts down; feedback stays open until done
        if (rem <= 0) rem = TRAVEL;
        rem -= 1;
        travel.set(v.id, rem);
        if (rem <= 0) {
          isOpen = false;
          valveOpen.set(v.id, false);
          travel.set(v.id, 0);
          v.operatingState = "closed";
        } else {
          v.operatingState = "closing";
        }
      } else {
        // Steady: rem stays 0; keep asserted position while cmd / !cmd holds
        travel.set(v.id, 0);
        valveOpen.set(v.id, isOpen);
        v.operatingState = isOpen ? "open" : "closed";
      }

      // Assert every scan so Q feedbacks never float (empty IR or leftover clears)
      writeBool(bus, openA, isOpen);
      writeBool(bus, closeA, !isOpen);
    }

    const systemStart = readBool(bus, amap.get("System.Start"));
    const systemReset = readBool(bus, amap.get("System.Reset"));
    const pathOpen =
      valves.length === 0 || valves.some((v) => valveOpen.get(v.id) === true);

    // System.Start is a pulse in Studio — latch RunCommand so RunningFeedback holds after the pulse.
    // System.Reset clears the latch (same idea as demo plants).
    if (systemStart || systemReset) {
      for (const p of pumps) {
        const runA = amap.get(`${p.tag}.RunCommand`);
        if (systemStart) writeBool(bus, runA, true);
        if (systemReset) writeBool(bus, runA, false);
      }
    }

    for (const p of pumps) {
      const runA = amap.get(`${p.tag}.RunCommand`);
      const fbA = amap.get(`${p.tag}.RunningFeedback`);
      const faultA = amap.get(`${p.tag}.Fault`);
      const runCmd = readBool(bus, runA);
      const fault = readBool(bus, faultA);
      const canRun = runCmd && !fault && pathOpen;
      writeBool(bus, fbA, canRun);
      p.operatingState = canRun ? "running" : fault ? "fault" : "stopped";

      for (const m of motors) {
        const related =
          motors.length === 1 ||
          m.tag.replace(/^M[-_]?/i, "") === p.tag.replace(/^P(UMP)?[-_]?/i, "");
        if (!related && motors.length > 1) continue;
        writeBool(bus, amap.get(`${m.tag}.Energize`), canRun);
        writeBool(bus, amap.get(`${m.tag}.RunningFeedback`), canRun);
        m.operatingState = canRun ? "energized" : "deenergized";
      }
    }

    if (tanks.length >= 2) {
      const srcA = amap.get(`${tanks[0].tag}.LevelPct`);
      const dstA = amap.get(`${tanks[1].tag}.LevelPct`);
      if (srcA && dstA) {
        const pumpRunning = pumps.some((p) => readBool(bus, amap.get(`${p.tag}.RunningFeedback`)));
        if (pumpRunning && pathOpen) {
          let s = readAnalog(bus, srcA);
          let d = readAnalog(bus, dstA);
          const move = Math.min(0.4, Math.max(0, s - 5));
          writeAnalog(bus, srcA, s - move);
          writeAnalog(bus, dstA, Math.min(100, d + move));
        }
      }
    }
  };

  plc.onReset = () => {
    travel.clear();
    valveOpen.clear();
  };

  plc._plantTemplate = "engineering";
  return { ok: true, template: "engineering", attached: true, signalMapSize: amap.size };
}
