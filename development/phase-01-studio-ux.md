# Phase 01 — Studio User Experience

**Milestone:** M01 · Studio UX  
**Last updated:** 2026-10-13  
**Status:** ◐ Four-workspace shell delivered; acceptance path largely met; gaps noted below

## Goal

Simplify P6 Studio while preserving working engineering functionality (canonical model, Runtime bind, water-transfer energize, X-Ray, ingest, interlocks, CEM validation).

## Workspace mapping

| Workspace | Contains (from prior 5-tab shell) | Primary surface |
|-----------|-----------------------------------|-----------------|
| **DESIGN** | Design | Canvas, categorized library, connections, Import Drawing |
| **ENGINEER** | Logic + I/O | Equipment config, signals, interlocks, logic observability (contextual panels; selection persists) |
| **SIMULATE** | Simulate | Runtime controls, scenarios, faults, process viz, X-Ray |
| **VERIFY & EXPORT** | Verify + export entry | FAT catalog, snapshot, engineering package export |

Legacy URL params `ws=logic` / `ws=io` normalize to **engineer**.

## Checklist

### Navigation / shell
- [x] Exactly four workspaces: Design · Engineer · Simulate · Verify & Export
- [x] Remove Logic / I/O top-level tabs (folded into Engineer)
- [x] No nested iframe / “Open full page” chrome
- [x] Equipment selection persists across workspace switches
- [x] Project menu: New / Import Drawing / Open / Save / Save As / Export

### Canvas
- [x] Zoom fit / in / out, wheel zoom, pan
- [x] Select, multi-select, DnD from library
- [x] Rotate, mirror, snap, guides, undo/redo
- [x] Copy / paste (Ctrl+C/V), delete with confirm
- [x] Auto-layout
- [x] Persistent coords (graph PATCH + autosave)
- [x] Connection routing / waypoints (preserved)
- [x] Readable labels + tooltips
- [x] Drag threshold + optional drag lock (accidental move prevention)
- [x] Save dirty feedback (pill + status chip)

### Sidebars / inspector / status
- [x] Left: collapsible categorized library (Pumps, Tanks, Motors, Valves, Instrumentation, Process, Electrical, Control) + search + symbol previews + DnD
- [x] Right inspector: Overview · Control · I/O · Interlocks; Advanced Engineering for X-Ray / Logic IR / Alarms·CEM
- [x] Bottom: one compact status bar (save · sim · alarms · warnings · verify) with expandable events/alarms/verify/timeline
- [x] Sim plant ops remain on Simulate workspace bar

### Assistance / responsive / quality
- [x] Failed start/commands explained in engineer language (not raw reject codes for ordinary users)
- [x] Responsive grid lessons preserved (KI-020/021 collapse patterns)
- [x] Dead nested-app chrome removed; duplicate workspace tabs removed
- [x] `smoke_studio_e2e.mjs` extended for four-workspace shell
- [ ] Manual Create→Add→Connect→Edit→Signals→Save→Reopen→Simulate walkthrough signed off by a fresh engineer (human)

## Gaps vs full acceptance

- Control sequence authoring UI still unfinished (KI-023) — labeled in Engineer
- Industrial symbol pack still basic (M02)
- Scanned image OCR unfinished (KI-003)
- Allen-Bradley export placeholder (KI-007)
- Ignition live path unproven (KI-019)
- Auto-layout is a simple grid (not full P&ID auto-router)

## Verification

| Check | Result |
|-------|--------|
| `smoke_studio_e2e.mjs` | **30/30 PASS** (2026-10-13 after p6-app rebuild) |
| Water Transfer energize | Preserved in e2e |
| Canonical model / Runtime bind | Preserved |
