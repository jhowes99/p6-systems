# Existing Architecture — Ironclad / Axiom Runtime

**Audit date:** 2026-10-07  
**Source of truth:** `https://github.com/jhowes99/Ironclad_Runtime.git` + application payload from `INSTALLER THIS ONE.zip`  
**Product rename target:** P6 Systems (Studio / Runtime / Verify / Connect)

---

## Critical repository finding

The GitHub `main` tree at commit `3075ef4` contains Docker/config/docs and `package.json`, but **does not contain** `server/`, `web/`, `control_narrative_gen/`, or `electron/`.

Those directories are packaged inside **`INSTALLER THIS ONE.zip`**. Phase 0 restored them into the working tree so the application can be inspected and run. Until they are committed (or published as a proper source tree), a fresh clone **cannot** build or start the app.

---

## High-level shape

Single **Node.js (Express) monolith** serving:

| Concern | Location | Notes |
|--------|----------|--------|
| HTTP API + static UI | `server/server.js` + `web/` | One process, port 3000 |
| Virtual PLC scan cycle | `server/plc/runtime.js` | `setInterval` ~50 ms |
| I/O image + faults | `server/plc/io.js` | I/Q/M digital, A/B analog-lite |
| Ladder IR execution | `server/plc/ladder.js`, `ir_eval.js`, `eval.js` | Server-side |
| Document ingest | `server/plc/pid_parser.js`, IO/C&E parsers | Partial OCR |
| FAT-style tests | `server/plc/test_runner.js` | C&E → arrange/act/assert |
| Control narrative gen | `control_narrative_gen/` (Python) | Spawned from API |
| Persistence | JSON under `server/data/` | No SQL database |
| Desktop wrapper | Electron (referenced in root `package.json`) | Not present in zip payload inspected |

There is **no** separate frontend build (no React/Vite). UI is multi-page static HTML + vanilla JS.

---

## Frontend (`web/`)

### Branding

- Product name in shell: **P6 Systems** / **P6 Verify** (`web/app_shell.js`, logos in `web/logo*.png`)
- README / Electron package: **P6 Systems**
- Legacy installer/compose filenames may still say Ironclad / `axiom_runtime`
- No P6 Systems branding yet

### Navigation (current tabs)

Workflow, Import, Validate, Monitor, Interlocks, Tests, Exports, Versions, Security, HMI, Build View, Safety, Control Templates (Pro), Sequencing (Pro), Audit (Enterprise).

This is **not** the P6 Studio navigation (Dashboard, Projects, Documents, P&ID Viewer, Equipment Library, I/O Mapping, Control Logic, Simulation, P6 Verify, P6 Connect, Reports, Settings).

### Pages of note

| Page | Role |
|------|------|
| `workflow.html` | Default entry (index redirects here) |
| `pid_import.html` | P&ID / project import |
| `monitor.html` | Live I/O toggle against `/api/state` and `/api/input/:name` |
| `tests.html` | Generate/run C&E tests |
| `panel_builder.html` | Device/panel → ladder IR |
| `interlocks.html` / `safety.html` | Safety / interlock UX |
| `hmi.html` | Mentions Ignition only as an **export consumer**, not live integration |
| `versions.html` | Snapshot list/diff |

Controls generally call real Express APIs (not static mocks). Completeness of backend behavior varies by feature.

---

## Backend API (`server/server.js`)

Representative working surface (confirmed by route registration):

**Runtime:** `/api/plc/start|stop|power-cycle`, `/api/state`, `/api/status`, `/api/input/:name`, `/api/analog/:name`, `/api/fault(s)`, `/api/program`, `/api/mode/strict`

**Explainability:** `/api/evaluate`, `/api/explain/output/:var`, `/api/faults/explain`

**Import:** `/api/pid/import`, `/api/pid/import-and-upload`, `/api/pid/import-text*`, `/api/project/*`, `/api/code/import`

**Verify:** `/api/tests/generate`, `/api/tests/run`, `/api/tests/last`, `/api/tests/export`

**Exports:** ST, CODESYS, Siemens, Allen-Bradley placeholder, Python, I/O list, wiring, commissioning packet

**Auth / license:** `/api/auth/*`, `/api/security/*`, `/api/license*`, tier gates via `license.js`

**Health:** `/api/features` (used by Docker HEALTHCHECK)

In-memory: single `VirtualPLC` instance, `LAST_PROJECT`, session `Map`. Not multi-tenant / multi-project.

---

## Control logic & simulation

### What exists and is real

- Ladder IR language with networks/rungs, AND/OR/NOT, coils, SET/RESET, TON timers
- Server-driven scan loop (not browser-as-truth for execution)
- Fault injection (`force` / `stuck`)
- Strict mode for declared I/O
- First Motor template (start/stop/E-stop seal-in) — good seed for Water Transfer reference
- Pure `evaluator.js` for explanation reasons (product constraint)

### Gaps vs P6 Runtime spec

- Timers use **wall-clock `Date.now()`**, not a simulation clock → repeatability risk
- No PAUSE / RESUME / STEP / RESET as first-class runtime actions (start/stop/power-cycle only)
- No equipment simulation models (Pump/Valve/Tank as objects) — only address-level I/O
- No staged live logic deployment / rollback
- ST is export-only; runtime rejects non-ladder languages
- Vendor exporters exist but Allen-Bradley is explicitly a placeholder; validation of vendor targets not proven

---

## Document processing

| Capability | Status |
|------------|--------|
| Structured JSON P&ID | Working |
| Searchable PDF text extract (`pdf-parse`) | Present |
| Regex tag mining from text | Present |
| Image OCR | **Implemented** (`server/plc/ocr_ingest.js`, `/ingest.html`, PID import path) |
| CSV / XLSX IO & C&E parsers | Present via dedicated parsers |
| Confidence scores / EXTRACTED vs INFERENCE vs APPROVED | **Missing** |
| Mandatory human-approval gate before model promotion | **Incomplete** (validation/exceptions exist; not full approval workflow) |

---

## Persistence & “database”

- `server/data/config.json` — secure mode, password hash (PBKDF2), license tier
- `server/data/snapshots/` — project snapshots
- Audit log file(s)
- Commissioning packet log on disk
- **No PostgreSQL / SQLite / Redis**

---

## Authentication

- Optional **Secure Mode** with cookie session + password
- `HMI_AUTH_BYPASS=1` used in Docker demos
- License tiers: core / pro / enterprise (feature gates)
- Not project-level RBAC; not industrial-grade identity

---

## Docker (pre–Phase 1)

| File | Purpose |
|------|---------|
| `Dockerfile` | `node:20-alpine` + Python venv for narrative gen; healthcheck on `/api/features` |
| `docker-compose.yml` / `compose.yaml` | Single `axiom_runtime` service |
| `docker-compose.share.yml` | Share-friendly single container |
| `docker-compose.axiom-runtime.dev.yml` | Bind-mount + `--watch` |

No Compose profiles, no Ignition, no MQTT, no object storage, no dedicated DB service.

---

## Tests

- `HARDENING_SUMMARY.md` claims `server/plc/__tests__/evaluator.test.js`
- **That test file is absent** from the restored tree (0 `__tests__` directories)
- Automated regression suite for deterministic simulation: **Missing**
- Evidence zips exist at repo root (`evidence*.zip`) — artifacts, not a CI suite

---

## Ignition / industrial connectivity

- **No OPC UA server**
- MQTT publisher: `server/connect/mqtt_publisher.js` (JSON, not Sparkplug); Mosquitto on core profile
- Perspective template: `ignition/perspective/P6_WaterTransfer/`
- **No Ignition Gateway API client**
- HMI page text only mentions Ignition as a possible import target for exports

---

## Reusable components (preserve)

1. `VirtualPLC` + `IOModel` + ladder executor — foundation for P6 Runtime  
2. Express API patterns for start/stop/state/faults/program  
3. Project bundle import (P&ID + I/O + C&E + narrative)  
4. C&E test generator + `runTests` scan loop  
5. Snapshot/versioning under `server/data/snapshots`  
6. Commissioning packet / audit chain primitives  
7. Feature gate registry  
8. First Motor template (extend → Water Transfer System)  
9. Existing Dockerfile healthcheck pattern  
10. Control narrative Python generator (optional Pro path)

---

## Architecture diagram (as-is)

```text
Browser (static HTML/JS)
        │  HTTP :3000
        ▼
┌───────────────────────────────────────┐
│  Express monolith (server.js)         │
│  ├─ Static web/                       │
│  ├─ VirtualPLC (50ms interval)        │
│  ├─ IOModel (I/Q/M/A/B + faults)      │
│  ├─ PLC helpers (import/test/export)  │
│  └─ spawn → control_narrative_gen Py  │
└───────────────────────────────────────┘
        │
        ▼
   server/data/*.json (files)
```
