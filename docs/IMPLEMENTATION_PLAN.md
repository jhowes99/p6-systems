# Implementation Plan — P6 Systems Platform

Aligned with Master Build Spec §16. Advance one phase at a time; prove each vertical slice before expanding.

---

## Phase 0 — Repository inspection ✅ (this session)

- [x] Inspect frontend, backend, runtime, persistence, Docker, auth, tests  
- [x] Document existing architecture, gaps, ADRs, roadmap  
- [x] Create `AGENTS.md` and status docs  
- [x] Restore application source from installer zip into working tree  

**Exit criteria:** Honest classification of existing vs missing; no unverified “done” claims.

---

## Phase 1 — Docker foundation (next)

**Goal:** Reliable local bring-up without removing existing functionality.

1. Commit restored `server/`, `web/`, `control_narrative_gen/` to the feature branch.  
2. Unify Compose: service `p6-app`, healthcheck, named volume for `server/data`.  
3. Profiles: `core`, `ignition`, `integration-test`.  
4. Optional Ignition Gateway (`inductiveautomation/ignition:8.3.9`), data volume, env-based admin bootstrap via `.env.example` (no committed secrets).  
5. Document start commands in `docs/DOCKER.md`.  
6. Validate: `docker compose --profile core up --build` serves `/api/features` and UI.

**Exit criteria:** Core stack healthy without Ignition; Ignition profile starts independently; integration-test profile verifies HTTP health.

---

## Phase 2 — Canonical model ✅

- [x] Versioned JSON schema (schemaVersion 1) for core entities + signal properties  
- [x] File store under `server/data/canonical/` + `migrate.js`  
- [x] REST `/api/model/*` + Water Transfer seed  
- [x] Legacy bridge (`project.legacy`) for existing IR/ioMap  
- SQL deferred (ADR-009) until concurrency requires it  

**Exit criteria met:** Projects persist; Water Transfer skeleton loadable via API; migrations on load.

---

## Phase 3 — Runtime MVP ✅

- [x] Simulation clock; PAUSE/RESUME/STEP/RESET  
- [x] Scan phases: input → logic → equipment hook → clock → signal sync  
- [x] Signal quality, timestamps, overrides via project binding  
- [x] TON from sim accrual (test runner + runtime)  
- [x] Ladder IR remains execution IR  
- Equipment/process models deferred to Phase 4 (`equipmentStep`)

---

## Phase 4 — Water Transfer reference system ✅

- [x] Equipment + ladder + equipmentStep  
- [x] Acceptance: start/LSH/E-stop/reset (`smoke_test_water_transfer.js`)

---

## Phase 5 — P6 Studio ✅ (MVP)

- [x] Landing page + P6 branding in app shell  
- [x] Simulation / Verify / Connect pages wired to real APIs  
- Auth polish / full workspace IA refinement can continue iteratively

---

## Phase 6 — Ignition integration (P6 Connect) ✅ (OPC UA MVP)

- [x] OPC UA server exposing bound signals (`ENABLE_OPCUA=1`)  
- [x] Connect status API; Ignition remains optional compose profile  
- [x] Tag mapping UI (`/tags.html`); Perspective template `ignition/perspective/P6_WaterTransfer/`  
- Live Ignition Designer prove-out: operator step when Gateway licensed

---

## Phase 7 — P6 Verify ✅

- [x] `P101_ESTOP_SHUTDOWN` FAT + PDF download  
- Regression harness can expand with more cases

---

## Phase 8 — Document ingestion ✅ (promote path)

- [x] Explicit `/api/model/ingest/promote` into canonical model  
- [x] OCR path Phase 18 (`/ingest.html`, tesseract / pdf-parse)

---

## Phase 9 — Live logic editing ✅ (API)

- [x] validate → stage → apply (scan boundary) → rollback  

---

## Phase 10–20 — Extended MVP ✅

See [PHASES_10_20.md](./PHASES_10_20.md) and the clickable [BUILD_LIST.md](./BUILD_LIST.md).

- [x] MQTT JSON telemetry + Mosquitto on core  
- [x] Tag map, canvas, trace, RBAC, regression, library, logic UI, OCR, reports, readiness  
- Sparkplug B / custom Ignition module still deferred

---

## Session checklist (every session)

1. Read `AGENTS.md` + `docs/BUILD_STATUS.md`  
2. Inspect git status  
3. Continue from next verified step  
4. Run relevant tests; update BUILD_STATUS / KNOWN_ISSUES / TEST_RESULTS  
5. Never mark complete without demonstrated behavior
