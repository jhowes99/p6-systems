# Architecture Decisions Record (ADR)

Decisions are append-only. Supersede with a new ADR id rather than rewriting history.

---

## ADR-001 — Preserve Express monolith for Phase 1–5 core

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Spec lists logical components (Frontend, Backend API, Runtime, Document Processing, Database). Existing product is one Node process with working scan cycle and APIs.

**Decision:** Deploy a single `p6-app` container that hosts static Studio UI, HTTP API, virtual runtime, and document-processing modules. Split into independently deployable services only when justified (e.g., OPC UA process isolation, scaling, or language boundaries).

**Consequences:** Faster path to a working Docker stack; clearer later split boundaries once interfaces stabilize. Avoids Kubernetes and premature microservice orchestration.

---

## ADR-002 — File-backed persistence first; SQL later

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Current persistence is JSON under `server/data/`. Spec lists “P6 Database” as a logical component and discourages multiple unnecessary databases.

**Decision:** Phase 1 uses a Docker volume mounted at `/app/server/data`. Introduce Postgres (or SQLite) in Phase 2 when the canonical engineering model needs migrations, concurrency, and queryability.

**Consequences:** Simple restore/backup via volume; schema work deferred until model design exists.

---

## ADR-003 — Ignition optional via Compose profile

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Ignition is first-class for P6 Connect but must not block core development or licensing.

**Decision:** `core` profile runs `p6-app` only. `ignition` profile adds official `inductiveautomation/ignition:8.3.9` with persistent Gateway data. No modules auto-installed. No production credentials in git.

**Consequences:** Developers without Ignition trial/license can still develop Runtime/Studio/Verify.

---

## ADR-004 — Retain legacy package/repo names internally

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Spec allows retaining legacy internal names when renaming is risky. Repo is `Ironclad_Runtime`; npm names include `axiom-desktop` / `axiom_runtime`.

**Decision:** Customer-facing strings → P6 Systems. Internal package names, Docker image legacy aliases, and git remote may remain until a planned rename window. Compose service renamed to `p6-app` for clarity.

**Consequences:** Reduces break risk; branding still meets §1.2 for UI/docs.

---

## ADR-005 — Ladder IR remains vendor-neutral logic IR (initial)

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Working ladder IR executor exists; ST is export-only.

**Decision:** Keep ladder IR as the execution IR for Runtime MVP. Vendor exports stay in versioned adapters and are not claimed validated until proven. Do not invent IEC 61131 full IDE scope.

**Consequences:** Aligns with PRODUCT_CONSTRAINTS spirit while expanding toward P6 Runtime capabilities.

---

## ADR-006 — OPC UA before MQTT and before custom Ignition module

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Spec §9 prioritizes OPC UA; MQTT and custom modules are later.

**Decision:** Phase 6 implements OPC UA server on Runtime signals first. MQTT in Phase 10. Custom Ignition SDK module deferred until external connector is proven.

**Consequences:** Clear integration order; Ignition can subscribe as OPC UA client without P6 depending on Perspective licensing.

---

## ADR-007 — Source tree must live in git, not only installer zip

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Fresh clone cannot build; application code was zip-only.

**Decision:** Treat restored `server/`, `web/`, and `control_narrative_gen/` as first-class source. Installer packaging consumes the tree; the zip is not the source of truth.

**Consequences:** Docker builds and CI become possible; Phase 1 depends on this.

---

## ADR-008 — Canonical P6 Model is the hub

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Product topology places Studio ingest/tools above a single model, with Runtime and Verify as consumers and Connect as an optional industrial edge (see `docs/PRODUCT_ARCHITECTURE.md`).

**Decision:** All engineering workflows converge on the Canonical P6 Model. Runtime executes model-backed logic and equipment; Verify asserts against the same versions; Connect exposes model signals (OPC UA first) without making Ignition the system of record.

**Consequences:** Phase 2 schema work is the highest-leverage next build after Docker. UI pages that mutate only in-memory IR/`LAST_PROJECT` are transitional and must migrate to the model.

---

## ADR-009 — Phase 2 persistence is versioned JSON aggregates

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Spec lists a database component; ADR-002 deferred SQL. Phase 2 needs project-scoped persistence and migrations immediately.

**Decision:** Persist each project as `server/data/canonical/projects/<id>/project.json` with `schemaVersion` + `migrate.js`. Expose `/api/model/*`. Keep `project.legacy` for ladder IR / ioMap bridge. Introduce SQL only when concurrency/query needs justify it.

**Consequences:** Docker volume already covers `server/data`. Schema changes require a migration step. Water Transfer seed is idempotent on startup.

---

## ADR-010 — Simulation clock is timer truth; wall clock only schedules

**Status:** Accepted  
**Date:** 2026-10-07  

**Context:** Spec forbids browser timing as execution truth; wall-clock `Date.now()` in TON broke deterministic FAT.

**Decision:** `SimClock` advances by `scanMs` each scan. TON accrues one `scanMs` per scan index. `setInterval` only triggers scans when mode is `running`. PAUSE freezes sim time; STEP runs one scan.

**Consequences:** Repeatable tests; Phase 4 equipment models must also key off sim time / scan index.
