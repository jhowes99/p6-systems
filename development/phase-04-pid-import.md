# Phase 04 — PDF/Image P&ID Import (P6 Vision)

**Milestone:** 04  
**User brief name:** Phase 3 — P6 Vision (Engineering Document Import)  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial (2026-10-13) — text/PDF/SVG/CSV path + review/promote hardened; image OCR unfinished (KI-003)

## Goal

Import P&IDs/drawings → extract equipment/instruments/tags/connections → reconstruct an editable engineering model with engineer oversight. Never fabricate confidence or silently approve topology.

## Alignment note

| Naming | Meaning |
|--------|---------|
| Master plan **M04** | PDF/Image P&ID Import (this file) |
| User brief **Phase 3 — P6 Vision** | Same milestone — document import / reconstruction |
| Spec §41 Phase 3 | Runtime (different numbering; do not confuse) |

## Required functionality

- [x] Import wizard (Studio Design → Import P&ID): multi-file, progress stages, retain originals
- [x] Pipeline: PDF text extract, SVG text/vector summary, image preprocess/OCR when necessary (honest unfinished), tag/equipment mining
- [x] Extraction with source refs (document, page, region, classification, confidence/uncertainty)
- [x] Review UI: source beside model; accept/reject/correct/reclassify/merge; source highlighting
- [x] Connection reconstruction with ambiguous flags — never silent uncertain topology
- [x] Promote approved → canonical equipment/instruments/connections/tags/source refs (confirm required)
- [x] Gap analysis as reviewable engineer decisions
- [ ] AI-assisted interpretation beyond pattern mining (optional; not required for MVP)
- [x] Failure → Manual reconstruct path (no fabricated confidence)
- [x] Water-transfer style text/SVG demo path (primary equipment → editable diagram → corrections → save + source links)
- [ ] Full scanned-image OCR quality (KI-003 — unfinished)

## Existing to preserve

- `server/plc/ocr_ingest.js`, `pid_parser.js`
- `server/model/ingest_promote.js` confirm/promote (no silent approve)
- CEM model + Runtime rebind after promote
- Studio Design ingest panel (extend; do not fight Phase 1/2 Studio UX work)

## Tasks

- [x] Multi-file `/api/ingest/ocr` + `/api/ingest/pipeline` with stages
- [x] SVG extract + vector summary (paths/lines/text); PDF page split via form-feed
- [x] Source refs on candidates; connection inference + gap analysis APIs
- [x] Document retention under `server/data/uploads/<projectId>/` + serve route
- [x] Promote connections/instruments/gaps; skip non-included / unaccepted topology
- [x] Studio wizard steps + connection/gap panes + manual reconstruct
- [x] Extend `scripts/smoke_ocr.mjs` + studio_e2e Vision checks
- [x] Update IMPLEMENTATION_STATUS / BUILD_STATUS / KNOWN_ISSUES / TEST_RESULTS
- [ ] Manual checklist: real water-transfer searchable PDF in Studio UI
- [ ] Improve scanned-image OCR (out of scope until KI-003 closed)

## Technical dependencies

- M03 Canonical model (equipment, connections, documents)
- M01 Studio Design ingest panel

## Integration requirements

- Promote → canonical model only after engineer confirm
- Runtime bind after promote for canvas live state
- Originals retained as `project.documents[].sourcePath` when “Keep originals” is checked

## Testing requirements

- `node scripts/smoke_ocr.mjs`
- `node scripts/smoke_studio_e2e.mjs` (Vision pipeline + promote connection skip)
- Prefer text/PDF/SVG/CSV fixtures — do not claim image OCR success

## Acceptance criteria

- [x] Water-transfer text fixture mines primary tags with source refs
- [x] Explicit connectivity language yields non-ambiguous proposals; heuristics stay ambiguous/unchecked
- [x] Promote requires confirm; excluded connections skipped
- [x] Gaps persisted on project UI for engineer decisions
- [ ] Arbitrary scanned P&ID image → reliable tags (blocked — KI-003)

## Known limitations

- Scanned image OCR unfinished (tesseract may return empty/low confidence)
- PDF vector geometry → topology not implemented (text/SVG only)
- AI suggestions not shipped as a separate assistant path
