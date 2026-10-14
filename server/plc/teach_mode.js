import { compilePlainLanguageToIR } from "./plain_language.js";

// Teach Mode (MVP):
// Provide examples of desired behavior; we infer a simple rule-per-example (DNF-like).
// model:
// {
//   tags: { [tag]: { kind:"DI"|"DO", label?:string } },
//   inputs: [tagName...],
//   output: tagName,
//   examples: [{ inputs: { [tagName]: true/false }, outputOn: true/false }]
// }

export function inferRulesFromExamples(model) {
  if (!model || typeof model !== "object") throw new Error("Missing model");
  const inputs = model.inputs || [];
  const output = model.output;
  const pos = (model.examples || []).filter(e => e.outputOn);
  const neg = (model.examples || []).filter(e => !e.outputOn);

  if (!output) throw new Error("Missing output tag");
  if (!inputs.length) throw new Error("Select at least one input");
  if (!pos.length) throw new Error("Need at least one ON example");

  // MVP inference:
  // Each ON example becomes a WHEN clause using only inputs that are TRUE in that example.
  // This keeps it electrician-simple and avoids incorrect generalization.
  const rules = pos.map((ex) => ({
    whenAll: inputs.filter(t => !!ex.inputs?.[t]),
    then: [{ tag: output, action: "ON" }]
  }));

  const clarifying = [];
  if (neg.length === 0) clarifying.push("Teach Mode: No OFF examples provided. Add OFF cases to avoid unsafe generalization.");
  if (rules.some(r => r.whenAll.length === 0)) clarifying.push("Teach Mode: One ON example had no inputs ON. Confirm if output should always be ON.");

  return { rules, clarifying };
}

export function compileTeachModeToIR(model) {
  const inferred = inferRulesFromExamples(model);
  const ir = compilePlainLanguageToIR({ tags: model.tags || {}, rules: inferred.rules });
  ir.metadata = ir.metadata || {};
  ir.metadata.teachMode = { clarifying: inferred.clarifying };
  return ir;
}

