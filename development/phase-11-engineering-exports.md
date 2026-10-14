# Phase 11 — Engineering Exports and Change Management

**Milestone:** 11  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial (unified package + approval gate; AB placeholder remains)

## Goal

Export engineering artifacts where data exists; downloadable package with model + verify evidence + warnings; approval before deployment-oriented artifacts; never auto-write physical PLCs.

## Required functionality

- Equipment list, instrument index, I/O schedule, control narrative stub
- ST / SCL (+ AB placeholder), signal maps, alarms, interlock matrix
- Verify report + sim/acceptance results when present
- Preliminary HMI screen config (Ignition path extensible, not live-proven)
- Zip package with version, warnings, VIRTUAL label
- Engineer approval workflow

## Existing to preserve

- Commissioning packet (`commissioning_packet.js`)
- PLC exporters / wiring exports
- Impact API / modelVersion
- UDT approve gate pattern

## Tasks

- [x] `server/exports/engineering_artifacts.js` — collect present/missing kinds
- [x] `server/exports/hmi_config.js` — preliminary operator screen
- [x] `server/exports/engineering_package.js` — zip + approve/revoke
- [x] APIs under `/api/verify/exports/*` and `/api/exports/*`
- [x] Studio Verify hooks: suite run + package preview / approve download
- [x] Package includes Connect architecture + FAT docs + model snapshot
- [ ] Richer change journal beyond modelVersion
- [ ] Real Allen-Bradley L5X (placeholder only today)
- [ ] Signed control narrative (current is preliminary stub)

## Package format

```text
MANIFEST.json
README.txt
WARNINGS.txt
approval.json
model/project.json
artifacts/*.csv|*.md|*.json|program.st|program.scl|allen_bradley_placeholder.json
hmi/preliminary_screen.json
connect/architecture.json
verify/fat_docs.json
verify/last_results.json
```

Download: `GET /api/exports/package/download`  
Preview without approval: `?forcePreview=1`  
Approve: `POST /api/exports/package/approve`

## Honesty labels

- Evidence class: VIRTUAL
- Physical FAT not complete
- Ignition live unproven
- Never auto-write physical PLCs

## Acceptance

- Artifacts emitted only where model data exists (`presentKinds` / `missingKinds`)
- Unapproved download returns 403 unless forcePreview
- Smoke package zip builds after approval

## Limitations

- AB export placeholder
- Control narrative is preliminary markdown from model, not a signed CN
- HMI config is preliminary — not commissioned Perspective
