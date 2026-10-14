# Phase 00 — Architecture and Codebase Audit

**Milestone:** 00  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Done (documentation complete 2026-10-13)

## Goal

Establish an honest inventory of what exists, works, is broken, and is missing — without rewriting application functionality.

## Required functionality

- Stack, frontend, backend, model, ingest, graphics, runtime, codegen, verify, integrations, persistence, tests inventoried
- Preserve list for working systems
- Master plan + status docs published

## Existing to preserve

- VirtualPLC + Water/Tank Transfer equipment sims
- Canonical model store + CEM 2.0 foundation
- OPC UA / MQTT / FAT runner
- Studio five-workspace shell + landing page
- Compose `core` profile

## Tasks

- [x] Read `AGENTS.md` and existing architecture / status docs
- [x] Inspect `server/`, `web/`, `scripts/`, `compose.yaml`
- [x] Classify working / partial / missing / broken
- [x] Create `docs/MASTER_DEVELOPMENT_PLAN.md`
- [x] Create / update `docs/ARCHITECTURE.md` as north-star
- [x] Create `docs/IMPLEMENTATION_STATUS.md`
- [x] Create `docs/ENGINEERING_STANDARDS.md`
- [x] Point `docs/BUILD_STATUS.md`, `KNOWN_ISSUES.md`, `TEST_RESULTS.md` at master plan
- [x] Create `development/phase-00` … `phase-11` trackers
- [x] Document recommended order, dependencies, first five tasks

## Technical dependencies

None (foundation).

## Integration requirements

None.

## Testing requirements

- Cross-check claims against last `regression_all.mjs` results and `/api/readiness` knownLimits
- Do not mark incomplete product features done in later phases based on this audit alone

## Acceptance criteria

- [x] Master plan lists milestones 00–11 with required sections
- [x] Architecture and implementation status reflect codebase honesty
- [x] Phase files use checkboxes; `[x]` only when verified

## Known limitations

- Audit is point-in-time; update when major topology changes
- Legacy docs may conflict — master plan is authority for this initiative
