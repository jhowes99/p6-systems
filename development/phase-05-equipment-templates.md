# Phase 05 — Equipment Identification and Templates

**Milestone:** 05  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial (configurable control templates + apply/approve shipped; auto P&ID→template matching open)

## Goal

Identify tanks/pumps/valves/instruments; instantiate executable / controls templates; engineer approval of associations. No parallel models.

## Required functionality

- Configurable templates: pumps, motors, valves, tanks, level/pressure/flow, PID, transfer sequences, alarm management
- Pump / valve / tank template fields (duty/standby, fail position, capacity/alarms, etc.)
- Template association with engineer approval
- Runtime plant templates preserved (`water_transfer` / `tank_transfer`)

## Existing to preserve

- `EquipmentLibrary`, `water_transfer.js`, `tank_transfer.js`, `plant_template.js`
- CEM equipment / signals / controlModules
- Seed projects (Water Transfer, Tank Transfer)

## Tasks

- [x] Configurable control templates module (`server/engineer/templates.js`)
- [x] Pump / motor / valve / tank / instrument / PID / transfer / alarm / E-stop templates with fields
- [x] Apply template → create missing signals as ENGINEERING_INFERENCE (no invented PLC addresses)
- [x] Approve template application (explicit gate)
- [x] Suggest templates per equipment type + apply-defaults API
- [x] Thin Studio Engineer hooks (Controls codegen panel)
- [x] Smoke: template apply (`server/engineer/smoke_test_engineer.js`)
- [ ] Auto P&ID candidate → template matching end-to-end (still open)
- [ ] Full Runtime IR bind from arbitrary template instance beyond seeded plants

## Technical dependencies

- M03 CEM schema / validate
- M04 ingest promote for candidate equipment
- M07 Runtime for executable plant IR

## Integration requirements

- Template instance updates canonical equipment.properties + signals
- Does not silently overwrite ENGINEER_APPROVED signals
- Safety-adjacent E-stop template carries honesty disclaimer

## Testing requirements

- `node server/engineer/smoke_test_engineer.js`
- water_transfer + tank_transfer runtime smokes (regression)

## Acceptance criteria

- [x] From approved Water Transfer model, templates can be applied and signals proposed
- [x] Engineer approval gate for template associations
- [ ] Import/OCR → auto-match templates proven end-to-end

## Known limitations

- Auto matching from drawings not proven
- PID gains are placeholders
- Alarm management is a skeleton (not full ISA-18.2)
