# Product Validation

## Validation Test

**Primary Validation**: Give this tool to a licensed electrician with no PLC experience. If they can explain why a motor does not run in under 5 minutes, the product passes.

## Test Procedure

1. **Setup**: Load the "First Motor" template
2. **Initial State**: Show the motor is OFF
3. **Task**: Ask the electrician to explain why the motor is not running
4. **Success Criteria**: 
   - Electrician can identify the reason in under 5 minutes
   - Reason Panel provides clear, understandable explanation
   - Visual breakpoint highlighting helps identify the issue
   - No PLC programming knowledge required

## Additional Validation Scenarios

### Scenario 1: E-Stop Blocking
- **Setup**: E-Stop is tripped (OFF)
- **Expected**: Reason Panel shows "E-Stop is OFF" as the blocking condition
- **Visual**: E-Stop device highlighted in wiring diagram

### Scenario 2: Stop Button Pressed
- **Setup**: Stop button is pressed (ON)
- **Expected**: Reason Panel shows "Stop button is ON" as the blocking condition
- **Visual**: Stop button highlighted

### Scenario 3: All Conditions Satisfied
- **Setup**: Start pressed, Stop released, E-Stop normal
- **Expected**: Motor turns ON, Reason Panel shows "All conditions satisfied"
- **Visual**: Energized path highlighted

### Scenario 4: Incomplete Logic
- **Setup**: No logic defined for an output
- **Expected**: Reason Panel shows "No logic defines when this should be ON"
- **Visual**: Output device shown as undefined/incomplete

## Validation Checklist

Before major changes:
- [ ] Run validation test with target user
- [ ] Document any issues found
- [ ] Fix issues before proceeding

After major changes:
- [ ] Re-run validation test
- [ ] Verify all scenarios still pass
- [ ] Update documentation if workflow changed

## Success Metrics

- **Time to Explanation**: < 5 minutes
- **Clarity**: Electrician understands without training
- **Accuracy**: Explanation matches actual logic behavior
- **Completeness**: All blocking conditions identified
