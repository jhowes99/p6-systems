# P6 Systems — Build List (Phases 0–20)

**Base URL (Docker core):** http://localhost:3000  
**Branch:** `p6/phase0-phase1-foundation`  
**Status:** MVP incorporated — [BUILD_STATUS.md](./BUILD_STATUS.md)

Start stack: `docker compose --profile core up --build`  
Docs index: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) · [PHASES_10_20.md](./PHASES_10_20.md) · [DOCKER.md](./DOCKER.md)

---

## Quick entry (product surfaces)

| Surface | Open |
|---------|------|
| Platform landing | http://localhost:3000/landing.html |
| Studio home / workflow | http://localhost:3000/workflow.html |
| P6 Runtime (simulation) | http://localhost:3000/simulation.html |
| P6 Verify | http://localhost:3000/verify.html |
| P6 Connect | http://localhost:3000/connect.html |
| Ignition Engineering Generator | http://localhost:3000/engineering.html |
| Platform readiness | http://localhost:3000/readiness.html |
| Health / features API | http://localhost:3000/api/features |
| Readiness API | http://localhost:3000/api/readiness |

---

## Full build list by phase

### Phase 0 — Repository inspection

| Deliverable | Look here |
|-------------|-----------|
| Existing architecture | [docs/EXISTING_ARCHITECTURE.md](./EXISTING_ARCHITECTURE.md) |
| Gap analysis | [docs/GAP_ANALYSIS.md](./GAP_ANALYSIS.md) |
| Agent rules | [AGENTS.md](../AGENTS.md) |
| ADRs | [docs/ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) |

### Phase 1 — Docker foundation

| Deliverable | Look here |
|-------------|-----------|
| Compose (primary) | [compose.yaml](../compose.yaml) |
| Docker runbook | [docs/DOCKER.md](./DOCKER.md) |
| Env template | [.env.example](../.env.example) |
| Core up | `docker compose --profile core up --build` → http://localhost:3000 |
| Integration smoke | `docker compose --profile core --profile integration-test up --build --abort-on-container-exit` |
| Ignition (optional) | `docker compose --profile core --profile ignition up --build` → http://localhost:9088 |

### Phase 2 — Canonical model

| Deliverable | Look here |
|-------------|-----------|
| Model schema / docs | [docs/CANONICAL_MODEL.md](./CANONICAL_MODEL.md) |
| Projects API | http://localhost:3000/api/model/projects |
| Store / seed | `server/model/` · Water Transfer seed on boot |
| Studio projects | http://localhost:3000/versions.html |

### Phase 3 — Runtime MVP

| Deliverable | Look here |
|-------------|-----------|
| Runtime design | [docs/RUNTIME.md](./RUNTIME.md) |
| Simulation UI | http://localhost:3000/simulation.html |
| Features / PLC APIs | http://localhost:3000/api/features · `/api/plc/*` |
| Smoke | `node server/plc/smoke_test_runtime.js` |

### Phase 4 — Water Transfer reference system

| Deliverable | Look here |
|-------------|-----------|
| Drive sequence | http://localhost:3000/simulation.html (START / LSH / E-STOP / RESET) |
| Live canvas | http://localhost:3000/canvas.html |
| Smoke | `node server/plc/equipment/smoke_test_water_transfer.js` |
| Equipment code | `server/plc/equipment/water_transfer.js` |

### Phase 5 — P6 Studio

| Deliverable | Look here |
|-------------|-----------|
| Landing | http://localhost:3000/landing.html |
| Workflow dashboard | http://localhost:3000/workflow.html |
| App shell nav | all tools via left nav on Studio pages |

### Phase 6 — P6 Connect (OPC UA + Ignition)

| Deliverable | Look here |
|-------------|-----------|
| Connect status UI | http://localhost:3000/connect.html |
| OPC UA status API | http://localhost:3000/api/connect/opcua |
| Connect aggregate | http://localhost:3000/api/connect/status |
| Tag map UI | http://localhost:3000/tags.html |
| Tag map API | http://localhost:3000/api/connect/tag-map |
| Ignition Engineering Generator (Milestone A) | http://localhost:3000/engineering.html |
| UDT generate / approve / export | `/api/connect/engineering/udt/*` |
| Perspective template | [ignition/perspective/P6_WaterTransfer/README.md](../ignition/perspective/P6_WaterTransfer/README.md) |
| Tag path cheat sheet | [ignition/perspective/P6_WaterTransfer/tags/tag-paths.md](../ignition/perspective/P6_WaterTransfer/tags/tag-paths.md) |
| OPC connection notes | [ignition/perspective/P6_WaterTransfer/opcua/connection.md](../ignition/perspective/P6_WaterTransfer/opcua/connection.md) |
| Ignition Gateway | http://localhost:9088 (profile `ignition`) |
| Roadmap A–F | [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) |

### Phase 7 — P6 Verify

| Deliverable | Look here |
|-------------|-----------|
| Verify UI | http://localhost:3000/verify.html |
| List tests | http://localhost:3000/api/verify/tests |
| Run FAT | `POST` http://localhost:3000/api/verify/run |
| FAT PDF | `POST` http://localhost:3000/api/verify/run.pdf |

### Phase 8 — Document ingestion (promote)

| Deliverable | Look here |
|-------------|-----------|
| Document / OCR UI | http://localhost:3000/ingest.html |
| P&ID import | http://localhost:3000/pid_import.html |
| Promote API | `POST` `/api/model/ingest/promote` · `/api/ingest/ocr/promote` |

### Phase 9 — Live logic editing

| Deliverable | Look here |
|-------------|-----------|
| Logic deploy UI | http://localhost:3000/logic.html |
| Control logic builder | http://localhost:3000/panel_builder.html |
| APIs | `/api/runtime/logic` · validate / stage / apply / rollback |

### Phase 10 — MQTT telemetry

| Deliverable | Look here |
|-------------|-----------|
| MQTT status (UI) | http://localhost:3000/connect.html |
| MQTT status API | http://localhost:3000/api/connect/mqtt |
| Broker | `localhost:1883` (Mosquitto on core profile) |
| Smoke script | `node scripts/smoke_mqtt_check.mjs` |
| Subscribe (host) | `mosquitto_sub -h localhost -t 'p6systems/#' -v` |

### Phase 11 — Ignition tag mapping

| Deliverable | Look here |
|-------------|-----------|
| Tag Map Studio | http://localhost:3000/tags.html |
| Propose / persist | `/api/connect/tag-map` · `/api/connect/tag-map/propose` |
| UDT proposal | http://localhost:3000/api/connect/udt-proposal |

### Phase 12 — Live engineering canvas

| Deliverable | Look here |
|-------------|-----------|
| Live canvas | http://localhost:3000/canvas.html |
| Canvas API | http://localhost:3000/api/runtime/canvas |

### Phase 13 — Traceability

| Deliverable | Look here |
|-------------|-----------|
| Trace UI | http://localhost:3000/trace.html |
| Trace APIs | `/api/trace/from-test` · `/api/trace/signal/:tag` |

### Phase 14 — Security hardening

| Deliverable | Look here |
|-------------|-----------|
| Security / roles UI | http://localhost:3000/security.html |
| Roles API | http://localhost:3000/api/security/roles |
| Connection audit | http://localhost:3000/api/connect/audit |
| Audit log (enterprise) | http://localhost:3000/audit.html |

### Phase 15 — Regression harness

| Deliverable | Look here |
|-------------|-----------|
| One-command regression | `node scripts/regression_all.mjs` (model + runtime + WT + FAT + OCR) |
| Test results doc | [docs/TEST_RESULTS.md](./TEST_RESULTS.md) |

### Phase 16 — Equipment library

| Deliverable | Look here |
|-------------|-----------|
| Library UI | http://localhost:3000/library.html |
| Library API | http://localhost:3000/api/equipment/library |
| Type detail | http://localhost:3000/api/equipment/library/:type |

### Phase 17 — Live logic UI

| Deliverable | Look here |
|-------------|-----------|
| Logic deploy | http://localhost:3000/logic.html |
| (Same APIs as Phase 9) | `/api/runtime/logic/*` |

### Phase 18 — OCR ingest

| Deliverable | Look here |
|-------------|-----------|
| OCR / review / promote | http://localhost:3000/ingest.html |
| OCR API | `POST` http://localhost:3000/api/ingest/ocr |
| Sample fixture | [server/data/samples/ocr_water_transfer.txt](../server/data/samples/ocr_water_transfer.txt) |
| Smoke | `node scripts/smoke_ocr.mjs` |
| P&ID path | http://localhost:3000/pid_import.html |

### Phase 19 — Reports hub

| Deliverable | Look here |
|-------------|-----------|
| Reports UI | http://localhost:3000/reports.html |
| Platform report API | http://localhost:3000/api/reports/platform |

### Phase 20 — Platform readiness

| Deliverable | Look here |
|-------------|-----------|
| Readiness UI | http://localhost:3000/readiness.html |
| Readiness API | http://localhost:3000/api/readiness |
| Integration-test profile | see [DOCKER.md](./DOCKER.md) |

---

## Studio tool map (nav → URL)

| Nav label | URL |
|-----------|-----|
| Dashboard | http://localhost:3000/workflow.html |
| Projects | http://localhost:3000/versions.html |
| Documents (OCR) | http://localhost:3000/ingest.html |
| P&ID Import | http://localhost:3000/pid_import.html |
| Equipment Library | http://localhost:3000/library.html |
| I/O Mapping | http://localhost:3000/monitor.html |
| Control Logic | http://localhost:3000/panel_builder.html |
| Logic Deploy | http://localhost:3000/logic.html |
| Simulation | http://localhost:3000/simulation.html |
| Live Canvas | http://localhost:3000/canvas.html |
| P6 Verify | http://localhost:3000/verify.html |
| Traceability | http://localhost:3000/trace.html |
| P6 Connect | http://localhost:3000/connect.html |
| Tag Map | http://localhost:3000/tags.html |
| Ignition Eng. | http://localhost:3000/engineering.html |
| Reports | http://localhost:3000/reports.html |
| Readiness | http://localhost:3000/readiness.html |
| Settings | http://localhost:3000/security.html |
| Safety | http://localhost:3000/safety.html |

---

## Proof checklist (run locally)

```bash
docker compose --profile core up --build -d
# wait until healthy
curl.exe -fsS http://localhost:3000/api/features
curl.exe -fsS http://localhost:3000/api/readiness
curl.exe -fsS http://localhost:3000/api/connect/opcua
curl.exe -fsS http://localhost:3000/api/connect/mqtt
node scripts/smoke_ocr.mjs
node scripts/smoke_mqtt_check.mjs
node scripts/regression_all.mjs
```

Ignition + Perspective (optional):

```bash
# ACCEPT_IGNITION_EULA=Y and IGNITION_ADMIN_PASSWORD set in .env
docker compose --profile core --profile ignition up --build
# Gateway: http://localhost:9088
# Template: ignition/perspective/P6_WaterTransfer/README.md
```
