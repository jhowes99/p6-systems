# Build Status

**Last updated:** 2026-10-14  
**Branch:** `p6/phase0-phase1-foundation`  

## Docs

- First-time handoff: [GETTING_STARTED.md](./GETTING_STARTED.md) (Demo vs Project, how to run, Studio workflow).

## Engineering plant valve/pump feedback (KI-031) — ✓

`attachEngineeringPlant` always replaces program IR with an empty ladder (no leftover demo IR clearing Q). Plant-owned valve position + every-scan assert of `OpenedFeedback`/`ClosedFeedback`; pump `RunningFeedback` stays true while RunCommand/System.Start && !fault && pathOpen. API smoke: XV-501 open stays true from step 3 onward; P-501 RunningFeedback stays true. Demo `tank_transfer` / `water_transfer` bind unchanged. Evidence: [TEST_RESULTS.md](./TEST_RESULTS.md).

## Implementation verification (prior) — ✓ executed

Rebuilt `p6-app`; reconciled mid-flight edits. Fixed Water Transfer seed restore when `TANK101` renamed (KI-026), model smoke equipment count (10), `level_transmitter`/`flow_transmitter` library entries. Live API workflow: create/edit/persist, Engineer template apply, WT mass balance (source↓ dest↑ flow), FAT pass. Evidence: [TEST_RESULTS.md](./TEST_RESULTS.md).

## P6 Engineer — automated controls (M05/M06) — ◐

`server/engineer/*`: templates, I/O proposals (no invented addresses), strategies, IEC 61131-3 ST, vendor adapters, review gates (no silent overwrite), separate safety path, extended impact, water-transfer acceptance. Mount: `/api/engineer`. Studio: Engineer → Controls codegen. Smoke: `smoke_test_engineer.js` (regression `engineer`). Sample ST: `server/data/engineer_samples/`. Gaps: AB placeholder; Runtime ladder-first; auto template match open.

## Phase 2 Industrial Graphics & P&ID Editor — ◐ shipped (MVP)

Original P6 ISA-style SVG symbols under `web/symbols/` (registry + SVG). **License:** [Grindstone visual-toolkit](https://github.com/Grindstone-Systems/visual-toolkit) is Apache-2.0 — compatible but **not vendored**; no Ignition proprietary graphics. P&ID/SCADA toggle (one model); ports; connection kinds + invalid flag; Water Transfer → 2 tanks + pump/motor/valve + LT/FT/PT + ported piping. Tracker: [phase-02-industrial-symbols.md](../development/phase-02-industrial-symbols.md). **E2E 32/32 PASS** after rebuild. Gaps: 100-node load unproven; port drag-connect polish (KI-028).

## P6 Vision / M04 P&ID import (brief Phase 3) — ◐

Multi-doc ingest pipeline (`runIngestPipeline`): PDF/text/CSV/SVG extract, source refs, connection proposals (ambiguous flagged), engineering gap decisions, Studio wizard steps, document retain under `server/data/uploads/`, promote with explicit connection include. Image OCR unfinished (KI-003). Tracker: [phase-04-pid-import.md](../development/phase-04-pid-import.md).

## Phase 5 / M07–M08 Virtual Commissioning — ✓ MVP hardened

Water-transfer: two-tank lumped mass balance (`process_physics.js`), valve travel, dry-run shutdown with reason, FT/PT, sim vs equipment API layers, named process faults (`/api/runtime/process-fault`), `GET /api/runtime/process`. Trackers: [phase-07](../development/phase-07-virtual-runtime.md), [phase-08](../development/phase-08-fault-injection.md). Smokes PASS locally; rebuild container for studio_e2e process checks. Gaps: CFD/hydraulics/CTU-CTD-PID (KI-027); commissioning packet incomplete.

## Phase 1 Studio UX rebuild (four workspaces) — ✓ shell

Replaced five-tab nav (Design · Logic · I/O · Simulate · Verify) with **Design · Engineer · Simulate · Verify & Export**. Logic + I/O fold into Engineer (canvas + contextual panels; selection persists). Categorized library with symbol previews; inspector Overview/Control/I/O/Interlocks + Advanced Engineering; compact status bar; Project menu (New/Import/Open/Save/Save As/Export); drag threshold + drag lock; engineer-language command rejects; autosave recovery draft. Tracker: [phase-01-studio-ux.md](../development/phase-01-studio-ux.md).

**E2E:** `smoke_studio_e2e.mjs` **30/30 PASS** after `p6-app` rebuild. Preserve verified: Runtime bind, water-transfer energize/physics, X-Ray, ingest, interlocks, FAT, knownLimits.

## Master Development Plan (docs initiative) — ✓

**Authority for milestone planning 00–11:** [MASTER_DEVELOPMENT_PLAN.md](./MASTER_DEVELOPMENT_PLAN.md)

| Doc | Role |
|-----|------|
| [MASTER_DEVELOPMENT_PLAN.md](./MASTER_DEVELOPMENT_PLAN.md) | Milestones, MVP 20 points, working rules |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current topology north-star |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | Rollup + MVP gap map |
| [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) | Honesty / approval / SoR rules |
| `development/phase-00` … `phase-11` | Checkbox task trackers |

## Canvas alarm "!" badge (always-on) — ✓ (KI-029)

Top-right red `!` is the **runtime alarm** marker (`Healthy`/`ESTOP` false or `Fault` true). CSS `.eqNode .badge { display:flex }` overrode the HTML `hidden` attribute, so every card showed `!`. Fixed with `.badge[hidden] { display:none !important }`; tooltip names the live signal. Interlock lock badges and UNVERIFIED labels unchanged.

## Simulate start-path + node label fix (KI-025) — ✓

Water Transfer canvas was active while Runtime stayed on Tank Transfer (`LT-101.High` → false X-Ray “High level interlock”). Boot/activate now rebind + attach matching plant IR; Simulate bar exposes Clear LSH / START TRANSFER; eqNode type+status wrap (no clip). studio_e2e extended with water-transfer energize check.

## Studio edit cleanup (post UX refactor) — ✓

Fixed interaction blockers after five-workspace shell (KI-024): Verify panel class typo, Design restores Overview edit fields, `?demo=1` opens Design with library, description on canvas + inspector, Props toggle on narrow viewports. studio_e2e **26/26**.

## Studio UX architecture refactor (Phases 1–10) — ✓ delivered

Inventory: [STUDIO_UX_INVENTORY.md](./STUDIO_UX_INVENTORY.md)

| Phase | Scope | Status |
|------:|--------|--------|
| 1 | Remove nested iframe apps / “Open full page” chrome | ✓ Native Logic / I/O / Verify / Ingest panels; `toolFrame` removed |
| 2 | Nav categories → four: Design · Engineer · Simulate · Verify & Export | ✓ (supersedes five-tab) |
| 3 | Unified layout (top / ws nav / left / canvas / right / sim bar + console) | ✓ |
| 4 | Selection persists across workspace switches; contextual panels | ✓ |
| 5 | Compact sim bar + canvas toolbar; advanced under “More” | ✓ |
| 6 | No nested page scroll; KI-020 grid collapse preserved | ✓ |
| 7 | Landing → Import P&ID / Scratch / Open existing / Sample | ✓ |
| 8 | Dark P6 brand; reduced strip/cards/duplicate headings | ✓ |
| 9 | Same projectId / canonical model across views (no reset) | ✓ |
| 10 | E2E markers + regression | ✓ **11/11**, studio_e2e **26/26** |

**Honest gaps:** Control-sequence authoring UI unfinished (labeled in Logic). Standalone pages (HMI, electrician, exports, …) remain outside Studio — not re-embedded. Connect live / Ignition still unproven (KI-019).

## CEM 2.0 (Canonical Engineering Model) — in progress

| Phase | Deliverable | Status |
|------:|-------------|--------|
| A | Architecture inventory + compatibility plan | ✓ [CEM2_INVENTORY.md](./CEM2_INVENTORY.md) |
| B | Schema v2 + migrate (additive) | ✓ `SCHEMA_VERSION=2`, `cem2-schema-v2` migration |
| C | `validateProject` + API + Studio Alarms surfacing | ✓ `/api/model/projects/:id/validation` |
| D | Runtime/X-Ray adapters (no engine rewrite) | ✓ X-Ray prefers interlock + connection walks via `model_adapter` (`findRoleSignals`); live values from runtime; tag-regex fallback only; Phase 1 UI preserved |
| E | Connect vendor mapping stub | ◐ `vendor_mapping.js` + GET export route (proposals only) |
| F | Impact API (revision uses existing `modelVersion`) | ◐ `/api/model/projects/:id/impact` — equipment/signal deps + `verifyCatalogRefs` from model testCases (no invented FATs) |
| G | Regression smoke | ✓ `smoke_test_cem2.js` in `regression_all.mjs` (11 jobs) |

**Write-path validation:** promote / equipment / signal / connection / approve routes run `validateProject`, persist `lastValidation` (non-blocking). Studio Alarms still reads GET validation.

**Not complete vs full §23 spec:** control sequence authoring UI, full Connect live path, SQL, Tank Transfer FATs, certified safety claims.

**Authority:** Master Development Directive (evolution) + MASTER PLATFORM SPEC (§1–§45)

**Audit:** [PLATFORM_AUDIT.md](./PLATFORM_AUDIT.md)

## Studio / X-Ray UX modernization track (8 phases)

| Phase | Scope | Status |
|------:|--------|--------|
| 1 | X-Ray health dashboard, signal trace, narrative, Verify hints | ✓ |
| 2 | P6 Verify surface (`verify.html`) — catalog from `/api/verify/tests`, assertion rows from `/api/verify/run`, shared `verify_ui.js` with Studio console | ✓ |
| 3 | Ingest/OCR — `tagOrigin` demo vs extracted, hide demo/reference filter (Studio + ingest page), honest OCR limits unchanged | ✓ |
| 4 | Connect — overview cards on `connect.html` + Studio Connect panel (Ignition unproven callout) | ✓ |
| 5 | Simulation workflow — scenarios log to Events (not Verify); history/playback honesty in sidebar | ✓ |
| 6 | Control-logic observability — `/api/runtime/logic` in Diag inspector (program IR excerpt, staged deploy status) | ✓ |
| 7 | Verify expansion — multi-FAT catalog + BLOCKED honesty | ✓ 6 executable + 1 BLOCKED; see Phase 6 / M09 |
| 8 | Final UX polish — landing Connect nav, responsive prior work, regression + E2E markers | ✓ |

## Directive Phase status (MVP complete)

| Phase | Status |
|------:|--------|
| 1 Stabilize | ✓ Incremental canvas sync + poll/rAF |
| 2 Fluid interaction | ✓ Pan/zoom, snap, guides, multi-select, undo/redo, ortho links, waypoints, lock, layers, minimap, rotate |
| 3 Live visual simulation | ✓ Tank levels, pump/valve state, flow intensity from FIT GPM |
| 4 Unified workspace | ✓ Embedded tools + workflow strip; canvas state preserved |
| 5 Advanced diagnostics | ✓ X-Ray Phase 1 + logic observability in Diag mode |
| 6 End-to-end experience | ✓ Upload→…→Verify strip, scenarios with signal diffs (Events tab) |
| Studio hub | ✓ In-Studio P&ID/doc ingest → review → place on canvas; delete/rework; Runtime auto-rebind |
| Interlocks | ✓ Native Studio Interlocks panel |
| Honesty | ✓ Known limits in `/api/readiness` + Studio sidebar |

## Spec §41 (parallel)

| Phase | Status |
|------:|--------|
| 1–4 | ✓ / ◐ MVP delivered |
| 5–7 | ◐ Expansion open (Ignition live prove-out; Tank Transfer FATs; AB L5X) |

## Phase 6 — P6 Verify + exports (2026-10-13) — ✓ partial

| Deliverable | Status |
|-------------|--------|
| Catalog generate/execute vs WT Runtime | ✓ 6 PASS + 1 BLOCKED |
| Impact regression + acceptance path | ✓ |
| Engineering package zip + approval | ✓ `/api/exports/package/*` |
| HMI preliminary + Connect architecture | ✓ stubs; Ignition unproven |
| Tank Transfer FATs / motor fault alarm | open |

## Verification

| Check | Result |
|-------|--------|
| `node scripts/smoke_verify_phase6.mjs` | **PASS** (executed) |
| `node scripts/regression_all.mjs` | **13/13 PASS** (executed this session) |
| Studio E2E | **32/32 PASS** (executed) |
| Demo | http://localhost:3000/studio.html?demo=1 |

## Out of MVP (honest)

- Ignition / OPC live path optional — do not claim until proven  
- Allen-Bradley export remains placeholder  
- History playback overlays recorded signals (does not rewind plant physics)  
- Image OCR for scanned P&IDs unfinished (text/PDF extract works)  
- Motor fault alarm FAT BLOCKED; Tank Transfer automated FATs not catalogued  

## Ignition live attempt (2026-10-12)

| Check | Result |
|-------|--------|
| P6 OPC UA server | ✓ `GET /api/connect/opcua` — `running:true`, endpoint `opc.tcp://localhost:4840/UA/P6Systems`, `nodeCount:23`, mode SIMULATION |
| Compose profile `ignition` | ◐ Image `8.3.9` pulled; `p6-ignition` container healthy HTTP |
| Gateway commissioning | ✗ Logs: `Resources needing commissioning: eula` (`ACCEPT_IGNITION_EULA=N`) |
| Admin password | ✗ `.env` `IGNITION_ADMIN_PASSWORD` empty |
| Live tag read/write via Ignition | ✗ Not proven — blocked before OPC client / Perspective bind |

**Verdict:** Ignition live **blocked** (EULA + credentials). Do not claim Connect complete.

## Next (recommended)

1. Manual Studio Project-mode Simulate: Import → promote → Demo\|Project toggle → open XV / run pump on canvas (API path proven; confirm UI)  
2. Manual Studio checklist: Design place → Logic interlock → I/O filter by selection → Simulate scenario → Verify FAT (same selection)  
3. User: set `ACCEPT_IGNITION_EULA=Y` + strong `IGNITION_ADMIN_PASSWORD` in `.env`, recreate `p6-ignition`, finish Gateway commissioning  
4. Add Tank Transfer FAT when real Runtime assertions exist  
5. Open PR for `p6/phase0-phase1-foundation` (KI-001)  
