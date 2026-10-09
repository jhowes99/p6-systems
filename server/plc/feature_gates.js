// Feature gate registry for P6 Systems
// See PRODUCT_CONSTRAINTS.md - require new features to be registered before implementation

export const FEATURE_GATES = {
  // Current features (shipped and supported)
  CURRENT: {
    PID_IMPORT: "pid_import",
    PANEL_BUILDER: "panel_builder",
    MONITOR: "monitor",
    INTERLOCKS: "interlocks",
    EXPLAIN_OUTPUT: "explain_output",
    EXPORT_ST: "export_st",
    EXPORT_SCL: "export_scl",
    EXPORT_PYTHON: "export_python",
    FIRST_MOTOR_TEMPLATE: "first_motor_template",
    WORKFLOW_STATE: "workflow_state",
    EVALUATOR: "evaluator",
    CANONICAL_MODEL: "canonical_model",
    RUNTIME_MVP: "runtime_mvp"
  },
  
  // Experimental features (may be removed or changed)
  EXPERIMENTAL: {
    HMI_BUILDER: "hmi_builder",
    TIMELINE: "timeline",
    TEACH_MODE: "teach_mode",
    PLAIN_LANGUAGE: "plain_language"
  },
  
  // Explicitly rejected features (do not implement)
  REJECTED: {
    FULL_LADDER_EDITOR: "full_ladder_editor",
    SCADA_REPLACEMENT: "scada_replacement",
    DIGITAL_TWIN: "digital_twin",
    AI_AUTO_PROGRAMMER: "ai_auto_programmer",
    MULTI_PLC_COORDINATION: "multi_plc_coordination",
    ADVANCED_SCRIPTING: "advanced_scripting"
  }
};

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(featureId) {
  // All current features are enabled by default
  if (Object.values(FEATURE_GATES.CURRENT).includes(featureId)) {
    return true;
  }
  
  // Experimental features require explicit enablement
  if (Object.values(FEATURE_GATES.EXPERIMENTAL).includes(featureId)) {
    return process.env[`FEATURE_${featureId.toUpperCase()}`] === "1";
  }
  
  // Rejected features are never enabled
  if (Object.values(FEATURE_GATES.REJECTED).includes(featureId)) {
    return false;
  }
  
  // Unknown features default to disabled
  return false;
}

/**
 * Get feature registry for API
 */
export function getFeatureRegistry() {
  return {
    current: Object.values(FEATURE_GATES.CURRENT),
    experimental: Object.values(FEATURE_GATES.EXPERIMENTAL),
    rejected: Object.values(FEATURE_GATES.REJECTED)
  };
}
