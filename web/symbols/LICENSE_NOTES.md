# P6 Symbol Library — License Notes

## Decision (2026-10-13)

P6 Systems ships **original** industrial SVG symbols under `web/symbols/`.

| Candidate | SPDX | Use in P6 |
|-----------|------|-----------|
| [Grindstone-Systems/visual-toolkit](https://github.com/Grindstone-Systems/visual-toolkit) | Apache-2.0 (code), CC0-1.0 (gallery) | **Not vendored.** Compatible if we later copy code/assets with NOTICE. |
| Ignition / Inductive Automation symbol packs | Proprietary | **Forbidden** — do not copy or redistribute. |

Visual Toolkit README states exported SVGs belong to the exporter; code reuse requires Apache-2.0 attribution. P6 prefers first-party ISA-style geometry so Studio stays a vanilla static bundle without a Vite/pnpm dependency.

Copyright in this folder: P6 Systems / project contributors. Symbols are engineering UI assets for simulation — not certified ISA drawing packages.
