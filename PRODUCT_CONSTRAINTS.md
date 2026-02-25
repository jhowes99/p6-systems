# Product Constraints

**This document defines what Axiom Control IS and IS NOT. All contributors must follow these constraints.**

## IS

Axiom Control is:

- **A visual reasoning engine for industrial control behavior** - It explains why outputs energize or do not energize in plain, deterministic terms
- **Beginner-first and physical-first** - Designed for electricians and automation technicians who think in physical devices, not ladder logic
- **Deterministic explanation system** - Every output state MUST have at least one explanation reason. The Reason Panel must never be empty

## IS NOT

Axiom Control is NOT:

- **A full PLC IDE** - We do not provide comprehensive ladder editing, debugging tools, or full PLC development environments
- **A ladder editor** - While we may display ladder-like representations, we are not building a ladder programming tool
- **A SCADA replacement** - We are not building a full SCADA system with historical trending, alarms, or complex HMI screens
- **A digital twin platform** - We do not simulate entire physical systems or provide 3D visualizations
- **An AI auto-programmer** - While we may use AI for P&ID import, we are not an AI code generation tool

## Core Principles

1. **Deterministic Evaluation**: All logic evaluation must be pure and deterministic. UI components never decide logic.
2. **Always Explain**: Every output state change must have a reason. If logic is incomplete, return "Incomplete definition".
3. **Physical-First**: Users think in devices (motors, buttons, sensors), not addresses (Q0, I1).
4. **Beginner-Friendly**: A licensed electrician with no PLC experience should be able to use this tool effectively.

## Scope Boundaries

- ✅ Visual representation of control logic
- ✅ Explanation of why outputs are ON or OFF
- ✅ Safety chain visualization
- ✅ Basic device placement and wiring
- ✅ Testing and commissioning workflows
- ✅ Simple export to real PLC platforms

- ❌ Advanced ladder editing
- ❌ Complex HMI screen building
- ❌ Full SCADA functionality
- ❌ Multi-PLC coordination
- ❌ Advanced scripting or custom code

## Validation Test

**Product Validation**: Give this tool to a licensed electrician with no PLC experience. If they can explain why a motor does not run in under 5 minutes, the product passes.

This validation must be run before major changes.
