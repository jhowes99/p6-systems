# Phase 08 — Fault Injection and Commissioning

**Milestone:** 08  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial (named process faults + IO force/stuck; commissioning packet incomplete)

## Goal

Inject process/IO faults that propagate through real Runtime logic and equipment simulation; observe interlocks and shutdown reasons honestly.

## Required functionality

- Sensor fail, low source, high dest, pump fault, valve fail, comm loss, instrument loss
- Faults affect IO image and/or equipment state machines → ladder/permissives respond
- Clear faults / reset path for repeatable commissioning
- Event history for fault inject/clear

## Existing to preserve

- `IOModel.setFault` force/stuck on I/Q/M
- Studio scenarios (`pump_fault`, stuck valve) and X-Ray stuck-valve demo
- `/api/fault`, `/api/faults`

## Tasks

- [x] Extend IO faults to analog A/B (numeric force/stuck)
- [x] Named process faults on water-transfer equipment (`WT_PROCESS_FAULTS`)
- [x] `POST /api/runtime/process-fault` + `DELETE` clear (maps to equipment + IO)
- [x] Propagate: valve_fail → no open FB → motor off; low_source → dry-run fault + reason; high_dest → LSH
- [x] `pump_fault` / `instrument_loss` / `sensor_fail` / `comm_loss` hooks
- [x] Emit `fault.process` / `fault.io` / `command.rejected` into Runtime event ring
- [x] Smoke coverage in `smoke_test_water_transfer` + studio_e2e low_source
- [ ] Full commissioning evidence packet completeness (still partial — see packet APIs)
- [ ] Tank-transfer named process-fault catalog (IO force still works)

## Technical dependencies

- M07 Virtual Runtime plant equipment

## Integration requirements

- Faults must not invent Verify pass; Verify asserts against Runtime after faults
- Simulated E-stop remains labeled non-certified

## Testing requirements

- Water transfer smoke: dry-run + valve_fail
- Studio E2E: process-fault low_source
- X-Ray stuck-valve path (existing)

## Acceptance criteria

- [x] Engineer can inject pump/valve/level (source/dest) faults and see Runtime response
- [x] Clear + reset restores runnable plant
- [ ] Commissioning packet includes full fault timeline export (partial)

## Known limitations

- Not plant safety certification
- Comm loss = equipment write suppress (simplified)
- Commissioning packet completeness varies
