# Phase 09 — Automated Verification and FAT

**Milestone:** 09  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial (multi-FAT catalog + honest statuses; Tank Transfer FATs still open)

## Goal

Generate, execute, and document verification against **actual P6 Runtime**. Never invent PASS. Label all evidence **VIRTUAL**.

## Required functionality

- Test generation from approved requirements / interlocks
- Structured results: id, equipment, requirement ref, ICs, actions, expected, actual, criteria, timestamp, modelVersion
- Status vocabulary: PASS | FAIL | BLOCKED | NOT RUN + engineer-language failure explain
- Impact-linked regression re-run
- FAT docs: procedures, expected/observed, logs, outstanding — VIRTUAL label

## Existing to preserve

- `server/verify/fat_runner.js` (compat shim)
- Water Transfer VirtualPLC + equipment
- Verify workspace / `verify_ui.js` / Studio catalog hooks
- `limits[]` honesty on catalog API

## Tasks

- [x] Expand Verify catalog (7 entries; 6 executable vs WT Runtime)
- [x] `P101_START_VALID`, `P101_START_BLOCKED_LSH`, `P101_INTERLOCK_STOP_LSH`
- [x] `XV101_VALVE_TRAVEL_FAIL` (stuck feedback fault injection)
- [x] `P101_MOTOR_FAULT_ALARM` retained as **BLOCKED** (no invent PASS)
- [x] `LSH101_BLOCKS_TRANSFER` + legacy `P101_ESTOP_SHUTDOWN`
- [x] Generalized runner (`server/verify/runner.js`) with FAULT / CLEAR_FAULT
- [x] `POST /api/verify/generate` from approved requirements
- [x] Suite run + results store + FAT docs API
- [x] Impact regression `POST /api/verify/regression`
- [x] Acceptance path (inject fault → FAIL evidence → correct → rerun)
- [x] `scripts/smoke_verify_phase6.mjs` in regression harness
- [ ] Tank Transfer dedicated FATs (when assertions exist)
- [ ] Motor / pump fault → alarm coil path in WT Runtime (unblocks BLOCKED test)

## APIs

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/verify/tests` | Catalog + limits + statuses |
| POST | `/api/verify/generate` | From approved interlocks / testCases |
| POST | `/api/verify/run` | Single or `{ suite:true }` / `testIds` |
| POST | `/api/verify/run.pdf` | VIRTUAL FAT PDF |
| POST | `/api/verify/regression` | Impact-linked re-run |
| GET | `/api/verify/results` | Last suite / acceptance |
| GET | `/api/verify/fat-docs` | Procedures + observed |
| POST | `/api/verify/acceptance` | Full acceptance path |

## Honesty labels

- Evidence class: **VIRTUAL**
- Simulated E-stop / faults ≠ certified physical safety
- Never claim physical FAT complete

## Acceptance (this milestone)

- ≥6 Water Transfer executable FATs green against Runtime
- 1 BLOCKED catalog entry with engineer reason
- Acceptance path records deliberate FAIL then corrected PASS
- Smoke: `node scripts/smoke_verify_phase6.mjs`

## Limitations

- Single plant template (Water Transfer) for automated FATs
- Motor fault alarm BLOCKED
- Tank Transfer Studio demo still Runtime-bridge only for Verify
