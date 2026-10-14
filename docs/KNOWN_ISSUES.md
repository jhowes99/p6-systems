# Known Issues

**Last updated:** 2026-10-13 (implementation verification)

## Blockers / high

| ID | Issue | Impact | Mitigation |
|----|-------|--------|------------|
| KI-001 | GitHub `main` omits `server/`, `web/`, `control_narrative_gen/` | Fresh clone cannot build or run | Restored from installer zip; must commit source on feature branch |
| KI-002 | Evaluator unit tests cited in `HARDENING_SUMMARY.md` are missing from tree | Cannot rely on documented CI quality | Re-add tests in a later phase; do not claim coverage |
| KI-003 | Scanned image OCR unfinished (tesseract may return empty/low conf) | Scanned P&ID path incomplete | Surfaced in Studio ingest + `/api/readiness` knownLimits; prefer text/PDF/CSV/SVG |

## Medium

| ID | Issue | Impact | Mitigation |
|----|-------|--------|------------|
| KI-004 | TON timers historically wall-clock | Deterministic FAT timing | Sim clock present in Runtime smokes; keep validating FATs |
| KI-005 | Studio tool pages still full navigations | Closed | Four-workspace Studio shell; no nested iframe chrome |
| KI-006 | Customer branding still Axiom/Ironclad | Closed | UI/docs/logos use P6 Systems / P6 Verify |
| KI-007 | Allen-Bradley export is placeholder | Must not claim vendor support | Keep labeled; validate before claiming |
| KI-008 | Ignition live path optional / unproven | Must not claim Connect complete | Profile `ignition`; prove live tags before claiming |
| KI-012 | History playback overlays signals (no physics rewind) | Scrub shows recorded tags, not re-simulated process | Labeled in Studio timeline + playback pill |
| KI-013 | Undo/redo + multi-select + waypoints | Closed (MVP) | Shipped |
| KI-026 | Water Transfer seed upgrade skipped when `TANK101` tag renamed | Phase 2 diagram (TANK102/LT/FT/PT) never applied on polluted volume data | Closed — `restoreTank101()` in `seed_water_transfer.js`; re-seed restores tag + diagram |

## Low / informational

| ID | Issue | Notes |
|----|-------|-------|
| KI-009 | `HMI_AUTH_BYPASS` enabled in Docker demos | Dev-only; document in DOCKER.md |
| KI-010 | Electron desktop packaging referenced but incomplete in zip | Out of scope for Docker-first MVP |
| KI-011 | `.gitignore` ignores `*.zip` | Installer zip already tracked historically; prefer source tree |
| KI-014 | Stale `p6-app` image can leave valve OpenedFeedback stuck / omit new APIs | Rebuild after Runtime/Studio/Engineer/Verify changes |
| KI-015 | Verify catalog previously one FAT | Partial close — 6 executable Water Transfer FATs + 1 BLOCKED (`P101_MOTOR_FAULT_ALARM`). Tank Transfer FATs still missing |
| KI-016 | Studio E2E sensitive to leftover faults (I1 stuck) | Smoke clears faults + runtime reset at start; still sim-only |
| KI-017 | X-Ray safety / narrative is simulation-only | UI shows sim disclaimer; never claim certified physical safety assessment |
| KI-018 | CEM 2.0 partial vs §23 | Schema v2, validation, X-Ray adapters, impact + Connect stubs; control-sequence UI and Ignition live remain open |
| KI-019 | Ignition live path not proven | Gateway EULA/credentials block; P6 OPC UA half up — Gateway↔OPC tag bind not completed |
| KI-020 | Studio X-Ray layout (collapsed sidebar) | Closed |
| KI-021 | Runtime (`simulation.html`) light-on-white + stale tags | Closed |
| KI-022 | Studio UX nested iframe apps | Closed — Design/Engineer/Simulate/Verify |
| KI-023 | Control sequence authoring UI | Open — Engineer workspace shows interlocks + logic observability; sequence editor unfinished |
| KI-024 | Studio edit friction after UX refactor | Closed |
| KI-025 | Water Transfer won't energize / X-Ray false high-level | Closed — plant template rebind + Clear LSH / START TRANSFER |
| KI-030 | `/api/readiness` `readyForDemo` false on Tank Transfer active | Expected — `water_transfer_ir` check fails when plant IR is `tank_transfer`. Not a Runtime defect |
