# P6 Systems

**P6 Systems** — Industrial Engineering, Simulation and Virtual Commissioning Platform.

Surfaces: **P6 Studio** · **P6 Runtime** · **P6 Connect** (Ignition optional) · **P6 Verify**.

**First-time handoff:** [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) — what it is, how to run (Docker core), Demo vs Project, and the import → Simulate workflow.

---

A local virtual PLC runtime with:
- **P&ID Import** - Automatically generate PLC code from P&ID documents (perfect for non-PLC users!)
- Ladder-like Blockly editor (compiles to a small Ladder IR JSON)
- Live monitor to toggle inputs and watch outputs/memory/timers
- ST export from Ladder IR (for readability/version control)
- **Export IEC 61499** - BasicFB XML for 4diac IDE and IEC 61499 tools
- Python support is *available* but **disabled by default** (feature flag)

## Run

### Local (no Docker)

From the project root:

```bash
npm start
```

Or from the server directory:

```bash
cd server
npm install
node server.js
```

Then open in your browser:
- Home: http://localhost:3000
- P&ID Import: http://localhost:3000/pid_import.html
- Monitor: http://localhost:3000/monitor.html
- Interlocks: http://localhost:3000/interlocks.html
- Project Wizard: http://localhost:3000/project_wizard.html
- Audit: http://localhost:3000/audit.html

### Docker (easiest way to share with others)

If you or others hit Node.js or npm errors when running locally, use Docker instead. Recipients only need **Docker Desktop** (or Docker Engine)—no Node.js or Python.

**Simplest (app only, one container):**

```bash
docker compose -f docker-compose.share.yml up --build
```

Then open **http://localhost:3000**. To stop: `Ctrl+C` then `docker compose -f docker-compose.share.yml down`.

**Full stack (app + proxy + HMI):**

```bash
docker compose up --build
```

## Quick demo

### Option 1: P&ID Import (Easiest for non-PLC users)

1. Go to **P&ID Import** (http://localhost:3000/pid_import.html)
2. Either:
   - Upload a P&ID file (PDF/image) - *Note: Full OCR support coming soon*
   - Or paste JSON data describing your P&ID (see `web/pid_example.json` for format)
3. Review the generated PLC code
4. Click **Upload to PLC Runtime**
5. Go to **Monitor** to test the generated code

### Option 2: Panel Builder / Wizards

1. Go to **Panel Builder** (http://localhost:3000/panel_builder.html) or **Wizards** (http://localhost:3000/wizards.html)
2. Generate + Upload a program
3. Go to **Monitor** to test it

## API

- `GET /api/state`
- `GET /api/mode`, `POST /api/mode/strict`
- `POST /api/plc/start`, `POST /api/plc/stop`, `POST /api/plc/power-cycle`
- `POST /api/input/I0` body: `{ "value": true }`
- Fault injection:
  - `GET /api/faults`
  - `POST /api/fault` body: `{ "var":"Q0", "mode":"force|stuck", "value": true }`
  - `DELETE /api/fault/Q0`
- Explainability:
  - `GET /api/explain/output/Q0`
- `GET /api/program` returns `{ ir }`
- `POST /api/program` body: `{ "ir": ... }`
- `GET /api/program/st` returns ST text
- `POST /api/export/iec61499/basicfb` - Export IEC 61499 BasicFB XML (body: `{ ladderIR, ioMap?, options? }`)
- `GET /api/features` returns feature flags
- `POST /api/pid/import` - Import P&ID and generate PLC code (body: FormData with `file` or `pidData` JSON)
- `POST /api/pid/import-and-upload` - Import P&ID, generate code, and upload to PLC runtime
- `POST /api/project/import` - Import a project bundle (P&ID + IO list + Cause&Effect + Narrative) and generate PLC code
- `GET /api/audit`

## What this is / isn't

See `PRODUCT_CONSTRAINTS.md` for product scope and constraints. All contributors must follow these constraints.

Also see `docs/WHAT_THIS_IS.md` for additional context.

## Python

Python nodes (`PY_CALL`, `PY_FB`) are rejected unless you set:

```bash
ENABLE_PY=1
```

This repo ships with the feature flag only; it does not include a Python worker yet.

## Export IEC 61499

The **Export IEC 61499** button (next to Export ST Code on the P&ID Import page) produces a BasicFB XML file compatible with 4diac IDE and other IEC 61499 tools.

**What gets exported:**
- Basic Function Block Type only (no Application/Resource/Device XML yet)
- Interface: EventInputs (INIT, REQ), EventOutputs (INITO, CNF), InputVars, OutputVars, InternalVars
- ECC with state S0 and REQ/INIT transitions
- Algorithm ST converted from Ladder IR

**Mapping rules:**
- `I*` addresses → InputVars (DataInputs)
- `Q*` addresses → OutputVars (DataOutputs)
- `M*` addresses → InternalVars (optional, enabled by default)
- Unknown prefixes → warnings (ignored)

**Limitations:**
- Exporter only—no runtime IEC 61499 execution in this tool
- TON timers and PY_CALL/PY_FB emit TODO comments in ST
- No runtime changes; ECC/event model is for import into IEC 61499 editors

**Future upgrade path (TODO):** Full DTD validation, true INIT semantics, multi-state ECC inference, Composite FB export, Application/Resource/Device XML, import IEC 61499 XML back.

---

## Docker Desktop testing

### Option A — Run with Docker Compose (recommended)
From this folder:

```bash
docker compose -f docker-compose.yml up --build
```

Then open:
- http://localhost:3000 (UI)
- http://localhost:3000/api/features (health check)

### Option B — Build an image and import into Docker Desktop (docker load)
Build + export an image tar:

```bash
./scripts/build_and_export.sh axiom_runtime:local axiom_runtime.tar
```

Import:
- CLI: `docker load -i axiom_runtime.tar`
- Docker Desktop UI: **Images → Load** and select `axiom_runtime.tar`

Run the imported image:

```bash
docker run --rm -p 3000:3000 axiom_runtime:local
```

### Prod-ish compose (no bind mounts)
Use `compose.yaml`:

```bash
docker compose -f compose.yaml up --build axiom_runtime
```

Or for live-reload dev profile:

```bash
docker compose -f compose.yaml --profile dev up --build
```

## Raspberry Pi / external telemetry

Set `TELEMETRY_BASE_URL` to your Pi service so the container can proxy telemetry endpoints:

```bash
# Example
export TELEMETRY_BASE_URL=http://192.168.86.31:8080
```

Then call the container endpoints:
- `http://localhost:3000/api/traffic`
- `http://localhost:3000/api/telemetry`

This avoids hardcoding the Pi IP in the browser and fixes CORS/networking issues.

## Virtual PLC docs (merged)

Design notes and placeholders were merged from `C:\Work\virtual_plc_cursor_project`:
- `README_virtual_plc_cursor_project.md`
- `docs/` (product vision, MVP scope, exports, UX principles)
- `src/*/README.md` (high-level module intent)
