// Deterministic evaluator core for P6 Systems
// 
// IMPORTANT: See PRODUCT_CONSTRAINTS.md (linked from README.md)
// - All logic evaluation must be pure and deterministic
// - UI components never decide logic
// - All UI must render strictly from evaluator output
// - Every output state MUST produce at least one explanation reason
// 
// Contributors: Before modifying this module, ensure changes maintain determinism and
// that every output state produces at least one explanation reason.

import { evalBoolExprLocal } from "./ir_eval.js";
import { explainOutputOff } from "./safety.js";

/**
 * Pure evaluator function that determines output states and explanations.
 * 
 * @param {Object} projectState - The project IR and configuration
 * @param {Object} inputState - Current input state snapshot
 * @returns {Object} Evaluation result with outputs, reasons, firstBlockingNode, energizedPath
 */
export function evaluate(projectState, inputState) {
  const ir = projectState?.ir || { language: "ladder", networks: [] };
  const snap = {
    inputs: { ...(inputState?.inputs || {}) },
    outputs: {},
    mem: { ...(inputState?.mem || {}) }
  };

  // Execute one scan to determine output states
  const result = execLadderOneScan(ir, snap);
  
  // Collect all outputs
  const outputs = {};
  for (const net of ir?.networks || []) {
    for (const rung of net?.rungs || []) {
      for (const act of rung?.actions || []) {
        if ((act.type === "COIL" || act.type === "SET" || act.type === "RESET") && 
            String(act.target || "").match(/^[QM]\d+$/)) {
          outputs[act.target] = result.outputs[act.target] || result.mem[act.target] || false;
        }
      }
    }
  }

  // Generate explanations for all outputs
  const reasons = {};
  let firstBlockingNode = null;
  let energizedPath = [];

  for (const [outputVar, value] of Object.entries(outputs)) {
    if (value) {
      // Output is ON - find the energized path
      const path = findEnergizedPath(ir, snap, outputVar);
      energizedPath.push(...path);
      reasons[outputVar] = [{
        type: "energized",
        message: `${outputVar} is ON because all conditions are satisfied.`,
        priority: 3 // Control condition
      }];
    } else {
      // Output is OFF - explain why
      const expl = explainOutputOff(ir, result, outputVar);
      const offReasons = expl.reasons || [];
      if (offReasons.length === 0) {
        // Incomplete definition - no rungs write to this output
        reasons[outputVar] = [{
          type: "incomplete",
          message: `${outputVar} is OFF because no logic defines when it should be ON.`,
          priority: 0,
          rungIndex: null
        }];
      } else {
        // Rank reasons by priority (Safety > Control > User)
        const ranked = rankReasons(offReasons, result, ir);
        reasons[outputVar] = ranked;
        
        // Set firstBlockingNode to highest priority blocker
        if (!firstBlockingNode && ranked.length > 0) {
          const topReason = ranked[0];
          if (topReason.blockers && topReason.blockers.length > 0) {
            firstBlockingNode = topReason.blockers[0];
          }
        }
      }
    }
  }

  // Enforce invariant: every output must have at least one reason
  for (const outputVar of Object.keys(outputs)) {
    if (!reasons[outputVar] || reasons[outputVar].length === 0) {
      reasons[outputVar] = [{
        type: "unknown",
        message: `${outputVar} state could not be determined.`,
        priority: 0
      }];
    }
  }

  return {
    outputs,
    reasons,
    firstBlockingNode,
    energizedPath,
    mem: result.mem
  };
}

/**
 * Execute one ladder scan (pure function)
 */
function execLadderOneScan(ir, snap) {
  const s = {
    inputs: { ...(snap.inputs || {}) },
    outputs: { ...(snap.outputs || {}) },
    mem: { ...(snap.mem || {}) }
  };

  for (const net of ir?.networks ?? []) {
    for (const rung of net?.rungs ?? []) {
      const power = evalBoolExprLocal(rung.cond, s);
      for (const act of rung.actions ?? []) {
        if (act.type === "COIL") {
          if (act.target?.[0] === "Q") s.outputs[act.target] = !!power;
          else if (act.target?.[0] === "M") s.mem[act.target] = !!power;
        } else if (act.type === "SET") {
          if (power) {
            if (act.target?.[0] === "Q") s.outputs[act.target] = true;
            else if (act.target?.[0] === "M") s.mem[act.target] = true;
          }
        } else if (act.type === "RESET") {
          if (power) {
            if (act.target?.[0] === "Q") s.outputs[act.target] = false;
            else if (act.target?.[0] === "M") s.mem[act.target] = false;
          }
        }
      }
    }
  }

  return s;
}

/**
 * Find the energized path to an output (for visualization)
 */
function findEnergizedPath(ir, snap, outputVar) {
  const path = [];
  for (const net of ir?.networks || []) {
    for (const rung of net?.rungs || []) {
      const writes = (rung.actions || []).some(a => 
        (a.type === "COIL" || a.type === "SET") && a.target === outputVar
      );
      if (writes) {
        const power = evalBoolExprLocal(rung.cond, snap);
        if (power) {
          // Collect all variables in the condition that are ON
          const vars = new Set();
          (function collect(e) {
            if (!e || typeof e === "boolean") return;
            if (e.var) vars.add(e.var);
            else if (e.op === "NOT") collect(e.x);
            else if (e.op === "AND" || e.op === "OR") {
              collect(e.a);
              collect(e.b);
            }
          })(rung.cond);
          
          for (const v of vars) {
            const bank = v[0];
            const val = bank === "I" ? snap.inputs?.[v] : 
                       bank === "Q" ? snap.outputs?.[v] : 
                       bank === "M" ? snap.mem?.[v] : false;
            if (val) path.push(v);
          }
        }
      }
    }
  }
  return path;
}

/**
 * Rank explanation reasons by causality priority:
 * 1) Safety conditions (highest)
 * 2) Control conditions
 * 3) User actions (lowest)
 */
function rankReasons(offReasons, snap, ir) {
  const ioMap = ir?.ioMap || {};
  
  return offReasons.map(reason => {
    let priority = 2; // Default: control condition
    
    // Check if any blocker is a safety-related input
    for (const blocker of reason.blockers || []) {
      const tag = Object.entries(ioMap).find(([_, addr]) => addr === blocker)?.[0] || "";
      const tagUpper = String(tag).toUpperCase();
      
      if (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
          tagUpper.includes("EMERGENCY") || tagUpper.includes("SAFETY")) {
        priority = 1; // Safety condition
        break;
      }
      
      // User actions (pushbuttons) are typically lower priority
      if (tagUpper.includes("START") || tagUpper.includes("STOP") || 
          tagUpper.includes("BUTTON") || tagUpper.includes("PB")) {
        priority = 3; // User action
      }
    }
    
    return {
      ...reason,
      priority
    };
  }).sort((a, b) => a.priority - b.priority); // Lower number = higher priority
}
