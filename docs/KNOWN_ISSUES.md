# Known Issues

**Last updated:** 2026-10-12

## Blockers / high

| ID | Issue | Impact | Mitigation |
|----|-------|--------|------------|
| KI-001 | GitHub `main` omits `server/`, `web/`, `control_narrative_gen/` | Fresh clone cannot build or run | Restored from installer zip; must commit source on feature branch |
| KI-002 | Evaluator unit tests cited in `HARDENING_SUMMARY.md` are missing from tree | Cannot rely on documented CI quality | Re-add tests in a later phase; do not claim coverage |
| KI-003 | Scanned image OCR unfinished (tesseract may return empty/low conf) | Scanned P&ID path incomplete | Surfaced in Studio ingest + `/api/readiness` knownLimits; prefer text/PDF/CSV |

## Medium

| ID | Issue | Impact | Mitigation |
|----|-------|--------|------------|
| KI-004 | TON timers historically wall-clock | Deterministic FAT timing | Sim clock present in Runtime smokes; keep validating FATs |
| KI-005 | Studio tool pages still full navigations | Closed | Studio UX refactor: five workspaces + native panels; no nested iframe chrome. Standalone pages remain outside Studio |
| KI-006 | Customer branding still Axiom/Ironclad | Closed | UI/docs/logos use P6 Systems / P6 Verify; legacy compose service names may remain |
| KI-007 | Allen-Bradley export is placeholder | Must not claim vendor support | Keep labeled; validate before claiming |
| KI-008 | Ignition live path optional / unproven | Must not claim Connect complete | Profile `ignition`; prove live tags before claiming |
| KI-012 | History playback overlays signals (no physics rewind) | Scrub shows recorded tags, not re-simulated process | Labeled in Studio timeline + playback pill; scenario packages later |
| KI-013 | Undo/redo + multi-select + waypoints | Closed (MVP) | Undo/redo, multi-select, rotate, lock, waypoints shipped |

## Low / informational

| ID | Issue | Notes |
|----|-------|-------|
| KI-009 | `HMI_AUTH_BYPASS` enabled in Docker demos | Dev-only; document in DOCKER.md |
| KI-010 | Electron desktop packaging referenced but incomplete in zip | Out of scope for Docker-first MVP |
| KI-011 | `.gitignore` ignores `*.zip` | Installer zip already tracked historically; prefer source tree |
| KI-014 | Stale `p6-app` image can leave valve OpenedFeedback stuck / omit X-Ray Phase 1 fields | Rebuild after Runtime/Studio changes (`compose -f compose.yaml --profile core up --build -d p6-app`) |
| KI-015 | Verify catalog has one FAT test | `GET /api/verify/tests` exposes `limits[]`; UI surfaces catalog only — no fake pass/fail |
| KI-016 | Studio E2E sensitive to leftover faults (I1 stuck) | Smoke clears faults + runtime reset at start; still sim-only |
| KI-017 | X-Ray safety / narrative is simulation-only | UI shows sim disclaimer; never claim certified physical safety assessment |
| KI-018 | CEM 2.0 partial vs §23 | Schema v2, validation, X-Ray model-first adapters, write-path `lastValidation`, impact + Connect stubs shipped; control-sequence UI and Connect/Ignition live prove-out remain open |
| KI-019 | Ignition live path not proven | `p6-ignition` starts but stays in **needs_commissioning: eula** while `.env` has `ACCEPT_IGNITION_EULA=N` and empty `IGNITION_ADMIN_PASSWORD`. P6 OPC UA half is up (`/api/connect/opcua` running, 23 nodes) — Gateway↔OPC tag bind not completed. User must accept EULA + set admin password, then configure Ignition OPC client to `opc.tcp://host.docker.internal:4840/UA/P6Systems` |
| KI-020 | Studio X-Ray layout (collapsed sidebar + `display:none`) | Closed — collapsing sidebar now retargets `.studioBody` grid so canvas keeps `1fr`; inspector capped ~380px with internal scroll |
| KI-021 | Runtime (`simulation.html`) light-on-white + stale tags | Closed — dark panels match shell; equipment rows use canonical tags (`ESD-101`, `VALVE-101`, …) with aliases; no raw `undefined` |
| KI-022 | Studio UX nested iframe apps | Closed — Design/Logic/I/O/Simulate/Verify shell; inventory in `docs/STUDIO_UX_INVENTORY.md` |
| KI-023 | Control sequence authoring UI | Open — Logic workspace shows model interlocks + Runtime logic observability; sequence editor unfinished (honest label) |
