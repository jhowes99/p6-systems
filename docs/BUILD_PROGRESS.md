# Build Progress — Master Development Directive

**Authority:** Master Development Directive + MASTER PLATFORM BUILD SPECIFICATION.  
**Closeout:** 2026-10-09 — MVP directive phases 1–6 delivered (honest out-of-scope listed in BUILD_STATUS).

## Final closeout additions

### Files
- `server/model/schema.js`, `routes.js` — connection waypoints + graph `locked`
- `server/server.js` — canvas exposes `locked` + `waypoints`
- `web/studio.js|html|css` — waypoint edit, lock, layer toggles, scenario before/after diffs
- `scripts/smoke_studio_e2e.mjs` — lock + waypoints coverage (17/17)

### Functionality
- Editable orthogonal waypoints (dbl-click pipe / drag / remove); PATCH to model
- Equipment position lock (`L` / context menu); persisted in graph
- Layer visibility: equipment / instruments / process / signal
- Scenario runs capture signal snapshot before/after and list deltas in Verify tab

### Tests
- `node scripts/regression_all.mjs` → **10/10 PASS**
- Studio E2E → **17/17 PASS**

### Not claimed complete
- Ignition live Connect prove-out
- Allen-Bradley export
- Image OCR
- Physics rewind playback
