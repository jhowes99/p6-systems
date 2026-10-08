// Canonical workflow state machine for Axiom Control
// Tracks: Import/Place → Safety → Behavior → Test → Deploy

export const WORKFLOW_STEPS = {
  IMPORT_OR_PLACE: "import_or_place",
  DEFINE_SAFETY: "define_safety",
  DEFINE_BEHAVIOR: "define_behavior",
  TEST: "test",
  DEPLOY: "deploy"
};

export const STEP_LABELS = {
  [WORKFLOW_STEPS.IMPORT_OR_PLACE]: "Import P&ID or Place Devices",
  [WORKFLOW_STEPS.DEFINE_SAFETY]: "Define Safety",
  [WORKFLOW_STEPS.DEFINE_BEHAVIOR]: "Define Behavior",
  [WORKFLOW_STEPS.TEST]: "Test",
  [WORKFLOW_STEPS.DEPLOY]: "Deploy"
};

export const STEP_DESCRIPTIONS = {
  [WORKFLOW_STEPS.IMPORT_OR_PLACE]: "Import a P&ID document or manually place devices in the panel.",
  [WORKFLOW_STEPS.DEFINE_SAFETY]: "Configure safety interlocks, E-Stops, and safety chain requirements.",
  [WORKFLOW_STEPS.DEFINE_BEHAVIOR]: "Define how devices should behave (start/stop logic, sequences, etc.).",
  [WORKFLOW_STEPS.TEST]: "Test the logic with simulated inputs and verify outputs behave correctly.",
  [WORKFLOW_STEPS.DEPLOY]: "Export the program to your PLC platform for deployment."
};

/**
 * Determine the current workflow step based on project state
 */
export function getCurrentStep(projectState) {
  const ir = projectState?.ir || { networks: [], ioMap: {} };
  const hasDevices = Object.keys(ir.ioMap || {}).length > 0;
  const hasLogic = (ir.networks || []).some(net => (net.rungs || []).length > 0);
  const hasSafety = checkHasSafety(ir);
  const hasBehavior = checkHasBehavior(ir);
  
  if (!hasDevices) {
    return WORKFLOW_STEPS.IMPORT_OR_PLACE;
  }
  
  if (!hasSafety) {
    return WORKFLOW_STEPS.DEFINE_SAFETY;
  }
  
  if (!hasBehavior) {
    return WORKFLOW_STEPS.DEFINE_BEHAVIOR;
  }
  
  // If we have devices, safety, and behavior, we're ready for test
  // User can manually advance to deploy
  return WORKFLOW_STEPS.TEST;
}

/**
 * Check if project has safety configuration
 */
function checkHasSafety(ir) {
  const ioMap = ir?.ioMap || {};
  for (const [tag, addr] of Object.entries(ioMap)) {
    const tagUpper = String(tag).toUpperCase();
    if (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
        tagUpper.includes("EMERGENCY") || tagUpper.includes("SAFETY")) {
      return true;
    }
  }
  return false;
}

/**
 * Check if project has behavior logic (rungs that write outputs)
 */
function checkHasBehavior(ir) {
  for (const net of ir?.networks || []) {
    for (const rung of net?.rungs || []) {
      for (const act of rung?.actions || []) {
        if ((act.type === "COIL" || act.type === "SET" || act.type === "RESET") && 
            String(act.target || "").match(/^[QM]\d+$/)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Get warnings for skipped steps
 */
export function getStepWarnings(currentStep, projectState) {
  const warnings = [];
  const ir = projectState?.ir || { networks: [], ioMap: {} };
  
  if (currentStep === WORKFLOW_STEPS.TEST || currentStep === WORKFLOW_STEPS.DEPLOY) {
    if (!checkHasSafety(ir)) {
      warnings.push("Safety has not been defined. E-Stop and safety interlocks should be configured before testing.");
    }
    if (!checkHasBehavior(ir)) {
      warnings.push("Behavior logic is incomplete. No outputs are defined.");
    }
  }
  
  return warnings;
}

/**
 * Get guidance text for the current step
 */
export function getStepGuidance(currentStep) {
  return STEP_DESCRIPTIONS[currentStep] || "Continue with the workflow.";
}
