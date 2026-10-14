# Architecture Audit — P6 Systems Workspace Rebuild

**Audit date:** 2026-10-08  
**Branch:** `p6/phase0-phase1-foundation`  
**Spec:** Master Application Build Specification (Studio + Runtime + Verify + Connect)  
**Regression at audit:** `node scripts/regression_all.mjs` → **6/6 PASS**  
**Live Docker:** `GET /api/features` 200; landing/canvas/simulation 200

---

## 1. Stack summary

| Layer | Reality |
|-------|---------|
| Framework | **None (SPA).** Multi-page static HTML + vanilla JS served by Express |
| Backend | Node.js Express monolith `server/server.js` |
| Runtime | `VirtualPLC` + `SimClock` + project binding (`server/plc/*`) |
| Persistence | JSON files under `server/data/canonical/` (no SQL) |
| Auth | Session + license tiers; `HMI_AUTH_BYPASS` for local; RBAC `X-P6-Role` |
| Document processing | `pid_parser.js`, `ocr_ingest.js`, CSV/IO parsers; Python narrative sidecar |
| Docker | Modular monolith `p6-app` + Mosquitto; optional Ignition profile |
| Tests | Node smoke scripts + FAT runner; no Playwright/Cypress UI suite yet |

**Do not introduce React/Vite unless Phase 2 explicitly requires React Flow** — current stack has no frontend build step. Prefer extending vanilla canvas first; React Flow is optional if justified.

---

## 2. What must be preserved

| Asset | Path | Rule |
|-------|------|------|
| Landing page visual direction | `web/landing.html`, `landing.css`, `logo.png` | **Do not replace.** Enhance CTAs only |
| P6 branding | `web/logo.png`, `logo-verify.png`, shell product names | Keep |
| Working Runtime | Water Transfer ladder + equipmentStep | Reuse — no parallel simulator |
| Canonical model | `server/model/*` | Single SoR for Studio/Runtime/Verify/Connect |
| OPC UA / MQTT | `server/connect/*` | Keep optional; core without Ignition |
| Verify FAT | `server/verify/fat_runner.js` | Real PASS/FAIL evidence |
| Docker core profile | `compose.yaml` | One-command bring-up |

---

## 3. Capability classification

Legend: **W** Working · **P** Partial · **U** UI-only · **M** Missing · **B** Broken

### Platform / shell

| Capability | Class | Evidence |
|------------|-------|----------|
| Landing marketing page | **W** | `/landing.html` 200, approved visual language |
| Unified P6 Studio workspace (toolbar/sidebar/canvas/inspector/console) | **M** | Multi-page `app_shell.js` tabs only — not one engineering environment |
| Marketing vs app nav separation | **P** | Landing separate; Studio still flat tab list |
| Dark engineering design tokens (spec palette) | **P** | Landing dark; Studio shell still light industrial |

### Canonical model

| Capability | Class | Evidence |
|------------|-------|----------|
| Project CRUD + seed Water Transfer | **W** | `/api/model/*`, seed on boot |
| Equipment / signals / interlocks / test cases | **W** | schema v1 + file store |
| Ports / rich connections / graph layout persistence | **P** | Connections exist; no first-class PORT graph editor persistence |
| Model revision / audit of edits | **P** | `modelVersion` bump; limited change journal |
| Separate immutable definition vs runtime state | **P** | Signals hold live values on project bridge; needs clearer split |

### Document ingestion

| Capability | Class | Evidence |
|------------|-------|----------|
| PDF text extract / image OCR / promote | **W** | `/api/ingest/ocr`, `/ingest.html`, smoke_ocr PASS |
| P&ID → PLC import path | **P** | `pid_import.html` + parsers; confidence review uneven |
| Side-by-side drawing ↔ model review with highlight | **M** | Not implemented |
| Source region provenance on canvas | **M** | Tags mined; no bbox overlay workflow |
| XLSX equipment/IO lists | **P** | Parsers exist; not full guided wizard |

### Equipment library & graph

| Capability | Class | Evidence |
|------------|-------|----------|
| Typed equipment library | **W** | `server/plc/equipment/library.js`, `/library.html` |
| Live equipment canvas from runtime | **P** | `/canvas.html` + `/api/runtime/canvas` — absolute nodes, poll 500 ms, not full graph editor |
| P&ID-inspired distinct symbols | **U/P** | Mostly identical boxes |
| Zoom/pan/minimap/multi-select/auto-layout | **M** | Missing on canvas |
| Drag-drop library → canvas | **M** | Missing |

### Runtime / simulation

| Capability | Class | Evidence |
|------------|-------|----------|
| Start/pause/resume/step/reset + sim clock | **W** | `/api/plc/*`, `/api/runtime/*`, smoke_test_runtime PASS |
| Water Transfer start / LSH / E-stop / reset | **W** | smoke_test_water_transfer PASS |
| Operator UI for commands | **W** | `/simulation.html` hits real APIs |
| Process models (tank fill, flow, pressure) | **P** | LevelPct signal exists; continuous process physics limited |
| WebSocket / SSE state stream | **M** | HTTP polling only |
| Command reject with permissive explanation | **P** | Interlocks work; UI messaging incomplete |
| Snapshots / replay | **P** | Versions/snapshots pages exist; not full sim replay |

### Verify

| Capability | Class | Evidence |
|------------|-------|----------|
| FAT `P101_ESTOP_SHUTDOWN` + PDF | **W** | `/verify.html`, fat_runner PASS |
| Right-click create test from equipment | **M** | Missing in workspace |
| Suite compare / replay | **P** | Legacy tests UI; not integrated into Studio |
| Honest “not certification” disclaimer | **W** | Present on Verify/Simulation |

### Connect

| Capability | Class | Evidence |
|------------|-------|----------|
| OPC UA server from runtime signals | **W** | `/api/connect/opcua` running in Docker |
| MQTT JSON publish | **W** | Mosquitto + publisher; smoke_mqtt_check |
| Tag map propose/save | **P** | `/tags.html` JSON dump — weak editor |
| UDT generate/approve/export (Milestone A) | **W** | `/engineering.html`, smoke_ignition_udt PASS |
| Perspective pack | **P** | Template files shipped; live Designer prove-out operator-gated |
| Read-only connection modes UX | **P** | Modes documented; not full Connect console |
| Unrestricted production write | **M** (correctly) | Intentionally not implemented |

### Auth / security / deploy

| Capability | Class | Evidence |
|------------|-------|----------|
| Docker health + volumes | **W** | compose core |
| Upload limits / type checks | **P** | multer present; needs hardening pass |
| Project-scoped command isolation | **P** | Single active project typical |
| OpenAPI contract | **M** | Missing |
| SQL / object storage microservices | **M** | Deferred — monolith OK per ADR |

---

## 4. Reusable code map (do not duplicate)

| Need | Reuse |
|------|--------|
| Simulation clock & scan | `server/plc/runtime.js`, `sim_clock.js` |
| Water Transfer / demo plant | `server/plc/equipment/water_transfer.js`, seed |
| Live signals API | `/api/runtime/signals`, `/api/runtime/signal` |
| Canvas data | `/api/runtime/canvas` |
| Events | `/api/runtime/events` |
| Model SoR | `server/model/store.js`, `schema.js` |
| OCR/ingest | `ocr_ingest.js`, ingest routes |
| Verify | `fat_runner.js` |
| Connect | `opcua_server.js`, `mqtt_publisher.js`, `ignition_udt.js` |
| Landing | `landing.html` / `landing.css` |

---

## 5. Gaps vs acceptance criteria (Part 21)

| Step | Today |
|------|-------|
| Landing → Studio | Landing → `workflow.html` (not unified Studio) |
| Demo project map | Canvas exists but sparse UX |
| Click P-101 → START → flow/levels | Simulation page works; Studio inspector/commands incomplete |
| Event timeline | Events API exists; no Studio console |
| ESD → shutdown → reset → Verify PASS → export | Works across separate pages |
| Refresh without losing project | Canonical JSON persists |

**First substantial milestone blocked primarily by missing unified Studio shell + deeper graph/process UX — not by missing Runtime core.**

---

## 6. Risks

1. Introducing React solely for React Flow splits the UI stack — justify in Phase 2.  
2. Multiplying equipment schemas (Studio vs Runtime) — forbidden; extend canonical model.  
3. Replacing landing visuals — forbidden.  
4. Claiming WebSocket/process twin features before implementation — forbidden.  
