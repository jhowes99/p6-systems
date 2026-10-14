# P6 Platform Audit — Master Platform Build Spec (§4)

**Authority:** User-fed *MASTER PLATFORM BUILD SPECIFICATION* (supersedes prior Parts 1–22 / Phases 0–9 workspace notes).  
**Date:** 2026-10-08  
**Rule:** Do not claim a phase complete until §42 Definition of Done is met with demonstrable behavior.

---

## Stack inventory

| Layer | Reality |
|-------|---------|
| Frontend | Vanilla HTML/CSS/JS (no React). Primary workspace: `web/studio.html` + `studio.js`/`studio.css`. Landing: `landing.html`. |
| Shared chrome | `web/app_shell.js` + `app_shell.css` (legacy light “toolbar + drawer” — **not** §6 left-nav shell). |
| Backend | Express monolith `server/server.js` |
| Runtime | `server/plc/*` VirtualPLC + equipment sims |
| Model | Canonical JSON SoR `server/model/*` under `server/data/canonical` |
| Verify | `server/verify/fat_runner.js` |
| Connect | OPC UA + MQTT + Ignition UDT packages under `server/connect/*` |
| Docker | Compose profile `core` → `p6-app` + Mosquitto; optional `ignition` |
| Auth | RBAC helpers; HMI bypass for local demo |
| Tests | `scripts/regression_all.mjs` + module smokes |

**Reusable (preserve):** VirtualPLC, IO model, water/tank transfer equipment, FAT runner, OCR ingest/promote, OPC UA/MQTT, canonical store.

---

## Route inventory

| Route | Purpose | Shell | Gap vs Master Spec |
|-------|---------|-------|--------------------|
| `/landing.html` | Public marketing | Own | Keep as design reference |
| `/studio.html` | Interactive workspace (**primary**) | Own dark shell | Needs library DnD, resize, X-Ray, full §40 demo |
| `/ingest.html` | Document OCR + dual-pane review | app_shell | Wire into Studio; bbox highlight incomplete |
| `/simulation.html` | Classic runtime UI | app_shell | Duplicate of Studio runtime — unify |
| `/verify.html` | FAT / Verify | app_shell | Create-test UX incomplete |
| `/connect.html` | Connect status | app_shell | Mode console partial |
| `/monitor.html` | I/O mapping | app_shell | Legacy styling |
| `/library.html` | Equipment library list | app_shell | Not drag-to-canvas |
| `/logic.html`, `/panel_builder.html` | Logic | app_shell | Not canvas-integrated |
| `/interlocks.html` | Interlocks | app_shell | Not canvas-integrated |
| `/trace.html` | Traceability | app_shell | Precursor to X-Ray |
| `/engineering.html`, `/tags.html` | Ignition/UDT | app_shell | Approve-before-export OK |
| `/versions.html`, `/workflow.html` | Projects / dashboard | app_shell | Not project SoR UX |
| `/canvas.html`, `/hmi.html`, … | Legacy tools | app_shell | Disconnected pages — fold or clearly mark |
| `/pid_import.html`, `/scan_build.html`, … | Import helpers | app_shell | Keep APIs; unify chrome |

**Finding:** Too many disconnected HTML routes with a separate light shell from Studio. §1 directive applies: stop extending page sprawl; unify chrome and drive work through the engineering workspace + shared shell.

---

## Phase status (Master Spec §41)

| Phase | Status | Notes |
|------:|--------|-------|
| 1 Foundation | ◐ | Audit here; universal shell in progress |
| 2 Interactive Studio | ◐ | Map + commands exist; library DnD / resize / tank edit next |
| 3 Virtual Runtime | ◐ | Tank transfer sim exists; align §14/§40 demo |
| 4 Visual intelligence | ◐ | X-Ray root-cause + highlight live; timeline replay open |
| 5 Verification | ◐ | FAT works; suites/create-test incomplete |
| 6 Integration | ◐ | OPC UA/MQTT/UDT live when enabled |
| 7 Expansion | ❌ | Deferred |

---

## Immediate build priority (§44)

1. Universal shell (§5–§6) across engineering routes  
2. Two-tank interactive workflow (§14 / §40) as first complete loop  
3. Studio library + editable tanks + connections (§7–§11)  
4. Visual feedback + X-Ray (§15–§19) after the loop is real  
