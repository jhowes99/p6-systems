# Phase 06 — PLC Logic and I/O Generation

**Milestone:** 06  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial (IEC ST + I/O proposals + review gates shipped; vendor packages not deployable)

## Goal

Generate preliminary control logic and I/O maps from the approved P6 model; staged review; traceable artifacts. Engineer oversight required. Never claim deployable to every PLC.

## Required functionality

- I/O generation: DI/DO/AI/AO lists, instrument mapping, descriptions, equipment association — **no invented physical PLC addresses**
- Control strategy suggestions (transfer, alternation, duty/standby, valve seq, level control) + missing operating requirements
- PLC codegen prioritizing IEC 61131-3 ST; extensible vendor framework
- Logic review API/UI: review / approve / reject / modify / regenerate; preserve engineer-approved edits
- Safety separate path; no SIL inference from geometry; E-stop honesty
- Change impact: logic, I/O, HMI, sim, tests, docs; regenerate after approval
- Water-transfer acceptance path: permissives → ST → traceability → impact → regenerate gate

## Existing to preserve

- Ladder IR, `logic_deploy`, legacy `st_export.js` / exporters
- CEM `controlLogic`, interlocks, validate.js, impact.js
- Runtime validate/stage/apply path (separate from preliminary ST)

## Tasks

- [x] `server/engineer/io_generate.js` — DI/DO/AI/AO proposals without inventing addresses
- [x] Hardware address approval requires `engineerAcknowledged`
- [x] `strategy.js` — topology-based suggestions + missing requirements
- [x] `st_generate.js` — IEC 61131-3 ST from interlocks/permissives/signals
- [x] `vendors.js` — IEC/CODESYS ST supported; Siemens partial; AB placeholder
- [x] `review.js` — approve/reject/modify; block silent overwrite of approved/manual ST
- [x] `safety.js` — separate path; SIL not inferred; sim-only acknowledgement
- [x] Extend `impact.js` — logic / I/O / HMI / sim / docs / templates
- [x] REST `/api/engineer/*` + water-transfer acceptance helper
- [x] Sample ST write under `server/data/engineer_samples/`
- [x] Thin Studio Controls codegen panel (approve/reject ST)
- [x] Smoke: template + ST + impact (`smoke_test_engineer.js` in regression)
- [ ] Validated Allen-Bradley / full Siemens project packages (still placeholder / partial)
- [ ] Auto-stage generated ST into Runtime ladder IR (honest gap — Runtime remains ladder-first)

## Technical dependencies

- M03 CEM, M05 templates
- Existing exporters for vendor adapters

## Integration requirements

- Generated artifacts classified ENGINEERING_INFERENCE until review
- Approved manual edits preserved (regenerate blocked unless forceOverwriteManual)
- Safety codegen excluded from normal ST path

## Testing requirements

- `node server/engineer/smoke_test_engineer.js`
- Regression job `engineer`
- Optional: Runtime logic validate/stage/apply remains separate

## Acceptance criteria

- [x] From Water Transfer model: permissives → preliminary ST → traceability metadata → impact shows affected → regenerate gated
- [x] I/O list does not invent PLC addresses
- [x] Review approve/reject/modify works; no silent overwrite
- [ ] Deployable multi-vendor PLC packages — **not claimed**

## Known limitations

- ST is preliminary / review-only — not a certified vendor project export
- Allen-Bradley remains placeholder (KI-007)
- Runtime execution IR is still ladder-centric; ST is an engineering deliverable
- Safety / SIL never auto-generated
