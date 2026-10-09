# Known Issues

**Last updated:** 2026-10-09

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
| KI-005 | Studio tool pages still full navigations | Closed (MVP) | Tools embed in Studio iframe; full SPA optional later |
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
| KI-014 | Stale `p6-app` image can leave valve OpenedFeedback stuck | Rebuild after Runtime/Studio changes (`compose --profile core up --build -d`) |
