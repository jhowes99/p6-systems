# Phase 07 — Virtual PLC and Process Runtime

**Milestone:** 07  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial → MVP strengthened 2026-10-13 (physics + command layers)

## Goal

Deterministic virtual controller + water-transfer process test bench: control behavior vs simulated equipment/process, with honest fidelity limits.

## Required functionality

- VirtualPLC scan: DI/DO/AI/AO, TON timers, equipment hooks, sequences/permissives/interlocks/alarms
- Water-transfer process: source/dest tanks, pump, isolation valve, LT/FT/PT
- Mass balance (geometry → volume → flow × timestep) with documented tolerances
- Sim controls (Start/Pause/Resume/Stop/Reset/speed) separate from equipment commands
- Structured command rejects with engineer-language reasons
- Observability: process snapshot, events, signal history

## Existing to preserve

- `server/plc/runtime.js`, `sim_clock.js`, `ladder.js`, `io.js`
- CEM bind via `project_binding.js` + `plant_template.js`
- Water Transfer energize path (KI-025) and Tank Transfer §40 template
- `/api/runtime/*` start/pause/step/reset/speed/command/events/history

## Tasks

- [x] Reuse VirtualPLC ladder scan (COIL/SET/RESET/TON); document unsupported (CTU/CTD/PID/ST)
- [x] Water-transfer two-tank path TANK101→XV101→P101/M101→TANK102 with LT/FT/PT analogs
- [x] Lumped mass balance (`process_physics.js`) + conservation check tolerances
- [x] Pump: start/stop, rated flow (demo-accelerated), dry-run low-source shutdown + reason
- [x] Valve: open/closed/transitioning, travel time (sim ms), feedback, fail-closed fault
- [x] Blocked path → flow 0, levels hold (no unsupported hydraulics)
- [x] Sim layer APIs labeled separately from `POST /api/runtime/command`
- [x] Command validation rejects with reasons (E-stop, LSH, trip, pump fault, low source)
- [x] `GET /api/runtime/process` observability + event emit on command accept/reject
- [x] Extend `smoke_test_water_transfer` + `smoke_test_runtime` (mass balance, dry-run, reset)
- [x] Studio E2E markers for process endpoint + level transfer + low_source fault
- [ ] Full hydraulic/NPSH/pipe network (explicitly out of scope — see KI-027)
- [ ] Ladder counters (CTU/CTD) and PID — unsupported constructs remain documented

## Technical dependencies

- M03 canonical model + Water Transfer seed
- M05/M06 plant IR templates

## Integration requirements

- Commands → Runtime evaluate permissives → structured result
- Studio Simulate bar: sim controls ≠ START TRANSFER equipment pulse
- Preserve CEM bind / plant_template attach on project activate

## Testing requirements

- `node server/plc/smoke_test_runtime.js`
- `node server/plc/equipment/smoke_test_water_transfer.js`
- `node server/plc/equipment/smoke_test_tank_transfer.js`
- `scripts/smoke_studio_e2e.mjs` (water transfer process checks)
- `scripts/regression_all.mjs`

## Acceptance criteria

- [x] Start pump → source falls / dest rises / FT > 0
- [x] Low source → pump shutdown with engineer-readable reason; reset; repeat consistent
- [x] Sim pause freezes SimClock; equipment Start is separate API
- [x] Mass balance residual within documented tolerance in smoke

## Known limitations

- Demo-accelerated `pumpRatedGpm` (not a real pump curve)
- No pipe friction, NPSH, multi-phase, or CFD
- E-stop is simulated model behavior only (KI-017)
- History playback does not rewind plant physics (KI-012)
- Ladder: no CTU/CTD/PID/ST
