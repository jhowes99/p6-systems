/**
 * Control strategy suggestions from topology, templates, and specs.
 * Flags missing operating requirements — does not auto-approve strategies.
 */

import { DataClass } from "../model/schema.js";
import { emptyEngineerState } from "./apply_template.js";
import { getTemplate } from "./templates.js";

function hasSignal(project, tag) {
  return (project.signals || []).some((s) => s.tag === tag);
}

function eqByType(project, type) {
  return (project.equipment || []).filter((e) => String(e.type).toLowerCase() === type);
}

/**
 * Suggest strategies and list missing operating requirements.
 */
export function suggestStrategies(project) {
  if (!project) throw new Error("Project required");
  const suggestions = [];
  const missingRequirements = [];
  const types = new Set((project.equipment || []).map((e) => String(e.type).toLowerCase()));

  const pumps = eqByType(project, "pump");
  const motors = eqByType(project, "motor");
  const valves = eqByType(project, "valve");
  const tanks = eqByType(project, "tank");
  const levelSwitches = eqByType(project, "level_switch");
  const estops = eqByType(project, "emergency_stop_input");

  // Transfer sequence
  if (pumps.length && valves.length && (tanks.length || levelSwitches.length)) {
    const pump = pumps[0];
    const valve = valves[0];
    const motor = motors[0];
    const gaps = [];
    if (!estops.length) gaps.push("Missing emergency_stop_input equipment for transfer permissive");
    if (levelSwitches.length === 0 && tanks.every((t) => !hasSignal(project, `${t.tag}.HighAlarm`))) {
      gaps.push("No high-level inhibit source (level switch or tank HighAlarm)");
    }
    if (valve && !hasSignal(project, `${valve.tag}.OpenedFeedback`)) {
      gaps.push(`${valve.tag}.OpenedFeedback missing — valve path permissive incomplete`);
    }
    if (pump && !hasSignal(project, `${pump.tag}.RunCommand`)) {
      gaps.push(`${pump.tag}.RunCommand missing`);
    }
    if (motor && !hasSignal(project, `${motor.tag}.Energize`)) {
      gaps.push(`${motor.tag}.Energize missing`);
    }
    for (const g of gaps) missingRequirements.push({ strategy: "transfer", message: g });

    suggestions.push({
      id: "strategy_transfer",
      kind: "transfer",
      title: "Transfer sequence (valve → pump/motor)",
      confidence: gaps.length ? "partial" : "high",
      equipmentTags: [pump?.tag, valve?.tag, motor?.tag, tanks[0]?.tag, levelSwitches[0]?.tag].filter(Boolean),
      rationale:
        "Topology includes pump + isolation valve + tank/level — classic transfer train suitable for Permissive→Run→Inhibit pattern.",
      missingRequirements: gaps,
      templateHint: "transfer_sequence"
    });
  }

  // Duty / standby & alternation
  if (pumps.length >= 2) {
    suggestions.push({
      id: "strategy_duty_standby",
      kind: "duty_standby",
      title: "Duty / standby pump pair",
      confidence: "medium",
      equipmentTags: pumps.map((p) => p.tag),
      rationale: `${pumps.length} pumps present — consider duty/standby with auto-failover on fault.`,
      missingRequirements: [
        "Operating requirement: which pump is primary duty?",
        "Operating requirement: auto-failover enabled? cool-down / interlock between starts?"
      ].map((message) => ({ strategy: "duty_standby", message })),
      templateHint: "pump"
    });
    suggestions.push({
      id: "strategy_alternation",
      kind: "alternation",
      title: "Pump alternation",
      confidence: "low",
      equipmentTags: pumps.map((p) => p.tag),
      rationale: "Multiple pumps can alternate starts for equal wear — requires site preference.",
      missingRequirements: [
        { strategy: "alternation", message: "Operating requirement: alternation enabled vs fixed duty?" }
      ],
      templateHint: "pump"
    });
    for (const s of suggestions.filter((x) => x.kind === "duty_standby" || x.kind === "alternation")) {
      missingRequirements.push(...s.missingRequirements);
    }
  }

  // Valve sequence
  if (valves.length) {
    const gaps = [];
    for (const v of valves) {
      if (!hasSignal(project, `${v.tag}.OpenedFeedback`) || !hasSignal(project, `${v.tag}.ClosedFeedback`)) {
        gaps.push(`${v.tag} dual feedback incomplete for sequenced travel`);
      }
    }
    suggestions.push({
      id: "strategy_valve_seq",
      kind: "valve_sequence",
      title: "Valve open/close sequence with travel timers",
      confidence: gaps.length ? "partial" : "high",
      equipmentTags: valves.map((v) => v.tag),
      rationale: "Discrete valves support open→confirm→close sequences with fail-to-position alarms.",
      missingRequirements: gaps.map((message) => ({ strategy: "valve_sequence", message })),
      templateHint: "valve"
    });
    missingRequirements.push(...gaps.map((message) => ({ strategy: "valve_sequence", message })));
  }

  // Level control / PID
  const hasLevelAi = (project.signals || []).some(
    (s) => /Level|LT/i.test(s.tag) && (s.dataType === "REAL" || s.ioClass === "AI")
  );
  if (tanks.length || hasLevelAi || levelSwitches.length) {
    const gaps = [];
    if (!hasLevelAi) {
      gaps.push("No analog level PV — only discrete high/low possible; PID level not available");
    }
    const ao = (project.signals || []).some((s) => s.ioClass === "AO" || s.direction === "OUTPUT" && s.dataType === "REAL");
    if (hasLevelAi && !ao) {
      gaps.push("Level PV present but no AO / modulating CV for PID level control");
    }
    suggestions.push({
      id: "strategy_level",
      kind: "level_control",
      title: hasLevelAi && ao ? "PID level control" : "Level interlock / discrete control",
      confidence: gaps.length ? "partial" : "medium",
      equipmentTags: [...tanks, ...levelSwitches].map((e) => e.tag),
      rationale: "Tank / level equipment present — suggest discrete inhibit and/or PID if PV+CV exist.",
      missingRequirements: gaps.map((message) => ({ strategy: "level_control", message })),
      templateHint: hasLevelAi ? "pid_loop" : "tank"
    });
    missingRequirements.push(...gaps.map((message) => ({ strategy: "level_control", message })));
  }

  // Generic missing operating requirements from templates
  for (const eq of project.equipment || []) {
    const tid = eq.properties?.controlTemplateId;
    if (!tid) {
      missingRequirements.push({
        strategy: "template",
        message: `Equipment ${eq.tag} has no control template association`
      });
      continue;
    }
    const tmpl = getTemplate(tid);
    const fields = eq.properties?.controlTemplateFields || {};
    if (tmpl?.fields) {
      for (const [key, def] of Object.entries(tmpl.fields)) {
        if (def.required && (fields[key] === undefined || fields[key] === null || fields[key] === "")) {
          missingRequirements.push({
            strategy: "operating_requirement",
            message: `${eq.tag}: template field "${key}" required but not set`
          });
        }
      }
    }
    if (!eq.properties?.controlTemplateApproved && eq.dataClass !== DataClass.ENGINEER_APPROVED) {
      missingRequirements.push({
        strategy: "approval",
        message: `${eq.tag}: template association not engineer-approved`
      });
    }
  }

  // De-dupe missing messages
  const seen = new Set();
  const missingUnique = [];
  for (const m of missingRequirements) {
    const k = `${m.strategy}|${m.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    missingUnique.push(m);
  }

  const payload = {
    ok: true,
    projectId: project.id,
    modelVersion: project.modelVersion,
    generatedAt: new Date().toISOString(),
    suggestions,
    missingRequirements: missingUnique,
    topology: {
      pumps: pumps.map((p) => p.tag),
      motors: motors.map((m) => m.tag),
      valves: valves.map((v) => v.tag),
      tanks: tanks.map((t) => t.tag),
      levelSwitches: levelSwitches.map((l) => l.tag),
      estops: estops.map((e) => e.tag),
      types: [...types]
    },
    note: "Suggestions are ENGINEERING_INFERENCE — engineer must select and approve before code generation is treated as approved."
  };

  return payload;
}

export function persistStrategySuggestions(project, payload) {
  project.engineer = project.engineer || emptyEngineerState();
  project.engineer.strategySuggestions = payload.suggestions || [];
  project.engineer.lastStrategy = {
    generatedAt: payload.generatedAt,
    missingCount: (payload.missingRequirements || []).length
  };
  return payload;
}
