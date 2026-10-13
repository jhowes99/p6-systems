# CEM 2.0 — Architecture Inventory & Compatibility Plan

**Initiative:** Canonical Engineering Model 2.0  
**Last updated:** 2026-10-12  
**Branch:** `p6/phase0-phase1-foundation`

This document satisfies **Phase A** of the CEM 2.0 rollout: map data flow, duplication, ID strategy, and safe extension points without breaking Studio / Runtime / X-Ray / Verify / Connect.

## North star

One **engineering model** (file-backed SoR under `server/data/canonical/`) drives all surfaces. **Live runtime values** stay in `ProjectRuntimeBridge.live` and the PLC IO image — not rewritten every scan.

## Data flow (current)

```text
Studio (web/studio.js)
  ├─ GET/PATCH /api/model/*          → store.js → project.json
  ├─ POST /api/model/ingest/promote  → ingest_promote.js → store (ENGINEERING_INFERENCE)
  ├─ GET /api/runtime/canvas         → equipment + live signals (bridge)
  ├─ GET /api/runtime/xray           → xray.js (model + live signals)
  ├─ GET /api/runtime/interlocks     → interlocks_view.js
  └─ POST /api/verify/run            → fat_runner.js + active project modelVersion

Runtime (server/plc/)
  ├─ project_binding.js              bindProject(project) → IO addresses + live Map
  ├─ runtime.js / equipment sim      ladder IR + legacy.ioMap (parallel bridge)
  └─ onModelChange (server.js)       auto-rebind after model mutations

X-Ray (server/model/xray.js)
  ├─ Reads project.equipment, interlocks, signals (defs)
  └─ Evaluates live signal snapshots from bridge (no fabricated blockers)

Verify (server/verify/)
  ├─ P101_ESTOP_SHUTDOWN catalog + fat_runner
  └─ traceability.js                 failure chain from model entities

Connect (server/connect/)
  ├─ tag_mapping.js                  P6 tag → Ignition path proposals (sidecar JSON)
  ├─ ignition_udt.js                 UDT package from approved equipment
  └─ vendor_mapping.js (CEM2)        stub: project.vendorMappings ↔ sidecar export

Persistence
  meta.json                          schemaVersion (store meta + project.schemaVersion)
  projects/<id>/project.json         full aggregate + legacy.* bridge
```

## ID strategy

| Layer | Key | Join rule |
|-------|-----|-----------|
| Project | `project.id` (`prj_*`) | Active pointer in `meta.json` |
| Equipment | `equipment.id` (`eq_*`), **tag** (uppercase) | Canvas node id = equipment id |
| Signal | `signal.id` (`sig_*`), **tag** (e.g. `P101.RunningFeedback`) | Runtime bridge, OPC, Verify, Ignition |
| Interlock | `interlock.id` (`ilk_*`) | `conditionSignalIds[]`, `inhibitsEquipmentIds[]` |
| Test case | `testCase.id`, **name** (FAT id) | Verify catalog + JSON refs in test body |
| Revision | `modelVersion` (monotonic on save) | FAT evidence + impact API |
| Schema | `schemaVersion` | `migrate.js` only — never manual bump in seeds |

**Stable join key for integrators:** `signal.tag` and `equipment.tag`.

## Duplication / parallel paths (honest)

| Area | Duplication | CEM 2.0 direction |
|------|-------------|-------------------|
| Ladder / IO | `project.legacy.ladderIR`, `ioMap`, `causeEffectRules` | Keep bridge; adapters read canonical signals first |
| LAST_PROJECT | In-memory import bundle (server.js) | `import-legacy-bundle` → canonical only |
| Tag maps | Sidecar `tag_maps/*.json` | `vendorMappings` in model = intent; sidecar = export artifact |
| Verify catalog | Hardcoded `P101_ESTOP_SHUTDOWN` + project testCases | Impact API links model testCases to catalog ids |
| X-Ray heuristics | Tag regex fallbacks (ESD-101 vs ESTOP101) | Incremental: interlocks from model relationships via `model_adapter.js` |

## Schema extension (Phase B — v2)

- **Optional collections:** `controlSequences[]`, `vendorMappings[]`
- **Optional entity fields:** `validationStatus`, `sourceDocumentRefs` (alias-friendly alongside `sourceDocumentIds`)
- **Project:** `lastValidation` snapshot (from validate pass, not authoritative SoR)
- **Migration:** v1 → v2 additive only; unknown top-level and entity fields preserved via spread in `normalizeProject`

## Validation layer (Phase C)

- Module: `server/model/validate.js` → `validateProject(project)`
- API: `GET /api/model/projects/:id/validation`
- Studio: Alarms tab shows engineering **warnings/errors** (does not block sim)

## Adapters (Phase D)

- `server/model/model_adapter.js` — equipment/signal/interlock/test relationships + `findRoleSignals` / connection walks
- X-Ray: prefers model interlocks + neighborhood signals for conditions; live values from runtime; tag-regex fallback only; Phase 1 UI (`health`, `groups`, `path`, `narrative`, `verifyHints`) preserved; `modelGraph` included
- Write-path: `attachLastValidation` / `project.lastValidation` after promote, equipment, signal, connection, approve (non-blocking)

## Connect (Phase E — minimal)

- `server/connect/vendor_mapping.js` — propose/sync vendor mapping records (stub; no live Ignition write)
- Core model stays vendor-neutral; Ignition paths remain proposals

## Revision & impact (Phase F — minimal)

- Existing: `modelVersion`, per-entity `updatedAt`
- `GET /api/model/projects/:id/impact?entityType=&entityId=` lists affected equipment, signals, interlocks, testCases, `verifyCatalogRefs` (real catalog ids only), connections, tag bindings

## Regression (Phase G)

- `server/model/smoke_test_cem2.js` — migration v2, validation, impact, adapter, water-transfer + demo reload
- Wired in `scripts/regression_all.mjs`

## Compatibility commitments

1. Water Transfer + §40 Tank Transfer demo projects load without data loss after schema bump.
2. `node scripts/regression_all.mjs` must stay green before claiming phase complete.
3. No silent overwrite of approved data; Connect remains proposal-only.

## Section 23 deliverables (tracking)

See `docs/BUILD_STATUS.md` CEM 2.0 table — partial phases marked ◐ until regression and doc evidence exist.
