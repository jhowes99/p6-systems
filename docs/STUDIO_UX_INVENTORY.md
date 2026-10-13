# Studio UX layout inventory (pre / post refactor)

**Date:** 2026-10-12  
**Branch:** `p6/phase0-phase1-foundation`

## Before (nested-app shell)

| Region | Components | Issues |
|--------|------------|--------|
| Top toolbar | Brand, project, pills, **runtime + canvas + tool** buttons mixed | Crowded; sim controls always visible |
| Left sidebar | 8+ `details` groups (Project, Library, Engineering, Logic, I/O, Runtime, Verification, Connections, Scenarios, Limits) | Duplicate categories vs Eng/Sim/Diag modes |
| Workflow strip | STEP 1–6 + Run Test | Intermediate dashboard chrome |
| Center | Canvas + **iframe `toolFrame`** + interlocks/ingest/connect overlays | Nested full-app pages via `data-embed` + “Open full page” / “Back to canvas” |
| Right | Inspector tabs | OK; X-Ray width/grid issues fixed as KI-020/021 |
| Bottom | Events / Alarms / Verify / Timeline | OK |

**Embed problem:** `openEmbed(url)` loaded `/verify.html`, `/interlocks.html`, etc. Those pages mount `app_shell` (header + side nav) → nested apps inside Studio.

## After (canvas-first shell)

| Region | Components |
|--------|------------|
| Top | Brand, project, save pills, Undo/Redo/Save, Tools/Props/Settings, Exit |
| Workspace nav | **Design · Logic · I/O · Simulate · Verify** only |
| Left | Contextual tools per workspace (library / interlocks / signals / scenarios / FAT) + Platform limits |
| Center | Canvas (Design/Simulate) or native panels (Logic interlocks, I/O table, Verify catalog, Ingest, Connect status) — **no tool iframe** |
| Right | Equipment properties (Overview / Control / Logic / Interlocks / I/O / X-Ray / Alarms) |
| Bottom | Compact sim bar (Simulate/Verify) + expandable events drawer |

## Mapping (folded vs removed)

| Former | Disposition |
|--------|-------------|
| iframe embeds (versions, ingest full, pid_import, interlocks.html, safety, logic.html, narrative, monitor, electrician, hmi, timeline, verify.html, tests, validation, exports, security) | **Removed from Studio nav** — capabilities folded into five workspaces or remain as standalone pages (honest; not nested) |
| Native interlocks panel | **Logic** workspace |
| Native ingest | **Design → Import P&ID** |
| Connect panel | **Design → Connect status** (optional) |
| Verify console + catalog | **Verify** workspace (inline `data-verify-catalog`) |
| Scenarios / X-Ray / runtime controls | **Simulate** |
| Signals / I/O monitor | **I/O** workspace (`/api/runtime/signals`) |
| Workflow strip | **Removed** (tabs replace steps) |
| Eng/Sim/Diag mode toggle | Internal canvas modes driven by workspace |

## Scroll / layout constraints preserved

- `html, body, .studio` overflow hidden; canvas pan/zoom not page scroll  
- Collapsed sidebar retargets grid (KI-020 lesson)  
- Inspector capped ~380px in diagnostic/X-Ray; internal scroll only  
