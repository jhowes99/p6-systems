# Known Issues

**Last updated:** 2026-10-07

## Blockers / high

| ID | Issue | Impact | Mitigation |
|----|-------|--------|------------|
| KI-001 | GitHub `main` omits `server/`, `web/`, `control_narrative_gen/` | Fresh clone cannot build or run | Restored from installer zip; must commit source on feature branch |
| KI-002 | Evaluator unit tests cited in `HARDENING_SUMMARY.md` are missing from tree | Cannot rely on documented CI quality | Re-add tests in a later phase; do not claim coverage |
| KI-003 | Image OCR not implemented despite tesseract dependency | Scanned P&ID path incomplete | Label UI unfinished; use JSON/PDF text until Phase 8 |

## Medium

| ID | Issue | Impact | Mitigation |
|----|-------|--------|------------|
| KI-004 | TON timers use wall-clock `Date.now()` | Deterministic FAT timing unreliable | Simulation clock in Phase 3 |
| KI-005 | VirtualPLC still global; Studio still uses `LAST_PROJECT` | Model exists but Runtime/UI not fully bound | Phase 3–5 migration to `/api/model` |
| KI-006 | Customer branding still Axiom/Ironclad | Spec §1.2 unmet | Rebrand in Phase 5 (partial earlier OK) |
| KI-007 | Allen-Bradley export is placeholder | Must not claim vendor support | Keep labeled; validate before claiming |
| KI-008 | No OPC UA / Ignition live path | P6 Connect unmet | Phase 6 |

## Low / informational

| ID | Issue | Notes |
|----|-------|-------|
| KI-009 | `HMI_AUTH_BYPASS` enabled in Docker demos | Dev-only; document in DOCKER.md |
| KI-010 | Electron desktop packaging referenced but incomplete in zip | Out of scope for Docker-first MVP |
| KI-011 | `.gitignore` ignores `*.zip` | Installer zip already tracked historically; prefer source tree |
