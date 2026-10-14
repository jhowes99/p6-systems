# Phase 02 — Industrial Graphics & P&ID Editor

**Status:** ◐ MVP shipped (2026-10-13) — e2e 32/32  
**Branch:** `p6/phase0-phase1-foundation`

## License decision

| Source | License | Decision |
|--------|---------|----------|
| [Grindstone-Systems/visual-toolkit](https://github.com/Grindstone-Systems/visual-toolkit) | **Apache-2.0** (code); gallery **CC0-1.0**; exported SVGs belong to exporter | Compatible for reuse/attribution |
| Proprietary Ignition / Perspective symbol packs | Vendor proprietary | **Do not redistribute** |

**P6 choice:** Ship **original P6 ISA-style SVG symbols** under `web/symbols/` (P6-owned). Do **not** vendor the Visual Toolkit React/Vite app or its procedural generators into the monolith. VT remains a documented optional future asset source (Apache-2.0 NOTICE required if code/assets are copied later). No Ignition proprietary graphics.

See also: `web/symbols/LICENSE_NOTES.md`.

## Goals

- [x] License review documented before use
- [x] Symbol registry (identity, type, modes, ports, props, control caps, runtime bindings)
- [x] SVG library covering pumps, motors, tanks, vessels, mixers, compressors, blowers, HX, valves, transmitters, switches, E-stops
- [x] P&ID vs SCADA mode toggle — one canonical equipment model
- [x] Equipment-specific ports; process/instrument/electrical/control link styles
- [x] Bind symbol states to real Runtime values only
- [x] Incremental canvas render preserved (no full redraw)
- [x] Water Transfer demo rebuilt (2 tanks, pump, motor, valve, LT/FT/PT, piping)
- [x] Smoke e2e extended for symbol mode / ports markers
- [ ] Visual acceptance at 100 nodes (manual / not load-tested this session)
- [ ] Full port drag-connect UI polish (MVP: auto-port on connect + visible anchors)
- [x] studio_e2e **32/32** after `p6-app` rebuild (symbol markers + WT diagram/ports + energize)

## Acceptance (honest)

| Criterion | Status |
|-----------|--------|
| Recognizable industrial symbols | ◐ shipped; polish ongoing |
| Ports attach (auto + stored on connection) | ✓ |
| Readable tags + editing preserved | ✓ |
| Runtime updates drive SCADA state | ✓ |
| Save/reload preserves diagram layout | ✓ (existing graph API) |
| No fake animations without Runtime truth | ✓ |
| E2E regression | ✓ 32/32 |

## Integration notes

- Studio workspaces: **Design · Engineer · Simulate · Verify & Export** (Phase 1 four-workspace shell).
- Symbol modules live in `web/symbols/` to minimize merge conflict with Phase 1 `studio.js` edits.
- Default: Design/Engineer → P&ID schematic; Simulate → SCADA status (user can override).
