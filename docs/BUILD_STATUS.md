# Build Status

**Last updated:** 2026-10-12  
**Branch:** `p6/phase0-phase1-foundation`  

## Studio UX architecture refactor (Phases 1–10) — ✓ delivered

Inventory: [STUDIO_UX_INVENTORY.md](./STUDIO_UX_INVENTORY.md)

| Phase | Scope | Status |
|------:|--------|--------|
| 1 | Remove nested iframe apps / “Open full page” chrome | ✓ Native Logic / I/O / Verify / Ingest panels; `toolFrame` removed |
| 2 | Five nav categories only: Design · Logic · I/O · Simulate · Verify | ✓ |
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

**Not complete vs full §23 spec:** control sequence authoring UI, full Connect live path, SQL, multi-FAT catalog, certified safety claims.

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
| 7 | Verify expansion — catalog `limits[]` documents single FAT; no extra fake tests | ◐ (one real FAT only) |
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
| 5–7 | ◐ Expansion open (Ignition live prove-out, vendor exports, additional FATs) |

## Verification

| Check | Result |
|-------|--------|
| `node scripts/regression_all.mjs` | **11/11 PASS** (incl. `cem2` + `studio_e2e`) — see TEST_RESULTS |
| Studio E2E | **26/26** (prior 24 + five-workspace shell markers + landing CTAs) |
| Demo | http://localhost:3000/studio.html?demo=1 |

## Out of MVP (honest)

- Ignition / OPC live path optional — do not claim until proven  
- Allen-Bradley export remains placeholder  
- History playback overlays recorded signals (does not rewind plant physics)  
- Image OCR for scanned P&IDs unfinished (text/PDF extract works)  
- Verify catalog still one FAT (`P101_ESTOP_SHUTDOWN`) — UI documents limit via `limits[]`  

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

1. Manual Studio checklist: Design place → Logic interlock → I/O filter by selection → Simulate scenario → Verify FAT (same selection)  
2. User: set `ACCEPT_IGNITION_EULA=Y` + strong `IGNITION_ADMIN_PASSWORD` in `.env`, recreate `p6-ignition`, finish Gateway commissioning  
3. Add Tank Transfer FAT when real Runtime assertions exist  
4. Open PR for `p6/phase0-phase1-foundation` (KI-001)  
