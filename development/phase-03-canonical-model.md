# Phase 03 — Canonical Engineering Model

**Milestone:** 03  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Refs:** [docs/CANONICAL_MODEL.md](../docs/CANONICAL_MODEL.md) · [docs/CEM2_INVENTORY.md](../docs/CEM2_INVENTORY.md)  
**Status:** Partial (CEM 2.0 foundation verified; full §23 open)

## Goal

One file-backed system of record driving Studio, Runtime, Verify, and Connect — with migrations, validation, and impact analysis.

## Required functionality

- Project aggregate: equipment, signals, connections, interlocks, tests, documents
- Schema versioning + migrations; data classification; approve path
- Validation + impact APIs; adapters for X-Ray / Runtime joins

## Existing to preserve

- `server/model/*` store, schema v2, migrate, validate, impact, model_adapter
- Water Transfer + Tank Transfer seeds
- `project.legacy` bridge (ladderIR, ioMap)
- Write-path `lastValidation` (non-blocking)
- Vendor mapping stub (proposals only)

## Tasks

- [x] Schema v1 project CRUD + file store under `server/data/canonical/`
- [x] Water Transfer seed on boot (optional disable via env)
- [x] CEM 2.0 schema v2 + additive migration
- [x] `validateProject` + `GET .../validation` + Studio Alarms surfacing
- [x] X-Ray / Runtime adapters prefer model relationships (`model_adapter`)
- [x] Impact API with real `verifyCatalogRefs` only
- [x] Connect vendor mapping stub (proposals)
- [x] `smoke_test_cem2.js` in regression harness
- [ ] Control sequence entities + authoring UX (collection exists; UI unfinished)
- [ ] Clearer immutable definition vs live signal value split documentation/enforcement
- [ ] Richer change journal beyond `modelVersion` bump
- [ ] SQL persistence only if concurrency proven to require it (deferred)

## Technical dependencies

- M00
- Docker volume for `server/data`

## Integration requirements

- All Studio tools write through `/api/model`
- Runtime binds active project; Verify references `modelVersion`
- Connect never silently overwrites ENGINEER_APPROVED data

## Testing requirements

- `server/model/smoke_test.js`
- `server/model/smoke_test_cem2.js`
- Seed reload lossless after migrate

## Acceptance criteria

- [x] Projects persist and reload; schema migrates on load
- [x] Validation and impact APIs return real dependency data
- [ ] Full engineer-facing control-sequence workflow (not yet)

## Known limitations

- `legacy.*` parallel path remains until adapters fully obsolete it
- KI-018: CEM 2.0 partial vs full master-spec §23
