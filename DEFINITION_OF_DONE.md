# Definition of Done

Before considering a feature or change complete, verify all items below.

## Core Requirements

- [ ] **Deterministic Evaluator**: All logic evaluation uses the pure evaluator module. No UI-side logic decisions.
- [ ] **Reason Panel Always Populated**: Every output state has at least one explanation reason. Never show blank Reason Panel.
- [ ] **Visual Breakpoint Accuracy**: Visual highlighting in wiring diagram matches the causal chain in Reason Panel.
- [ ] **Golden Workflow Completion**: "First Motor" template works end-to-end without editing logic.
- [ ] **No Unexplained UI State**: All visual changes are backed by evaluator output or real state change. No "refresh fixes it" behavior.

## Product Validation

**Validation Test**: Give this tool to a licensed electrician with no PLC experience. If they can explain why a motor does not run in under 5 minutes, the product passes.

- [ ] Validation test passed before major changes
- [ ] Validation test passed after changes

## Code Quality

- [ ] Follows PRODUCT_CONSTRAINTS.md
- [ ] Feature registered in feature_gates.js (if new feature)
- [ ] Unit tests added for evaluator changes
- [ ] No hardcoded logic in UI components
- [ ] Mode separation enforced (Build/Test/Deploy)

## Documentation

- [ ] README updated if needed
- [ ] API changes documented
- [ ] User-facing changes have guidance text

## Testing

- [ ] Manual testing completed
- [ ] "First Motor" template tested end-to-end
- [ ] Reason Panel verified for all output states
- [ ] Visual breakpoint highlighting verified
- [ ] Export functionality tested (if changed)

## Before Release

- [ ] All items above checked
- [ ] Product validation test passed
- [ ] No experimental or unfinished elements visible
- [ ] Consistency pass completed (spacing, colors, terminology)
