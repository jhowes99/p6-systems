# P6 Systems — Docker Environments

## Prerequisites

- Docker Desktop or Docker Engine + Compose v2+
- Application source present: `server/`, `web/`, `control_narrative_gen/` (see KI-001)
- Copy `.env.example` → `.env` and set values as needed

## Profiles

| Profile | What starts | When to use |
|---------|-------------|-------------|
| `core` | `p6-app` + Mosquitto (MQTT enabled by default) | Daily development |
| `ignition` | Official Ignition Gateway 8.3.9 + Perspective template mount | P6 Connect / Perspective / OPC client work |
| `integration-test` | Health + readiness + FAT + OPC UA + MQTT status probes | Smoke check after compose up |
| `mqtt` | Same Mosquitto service (also included in `core`) | Explicit MQTT-only profile alias |

**Core never requires Ignition.** Ignition is additive. MQTT broker ships with `core`.

Logical modules (Frontend, Backend, Runtime, Document Processing) currently run **inside** `p6-app` (ADR-001). They are not split into separate containers yet.

## Commands

### Core (recommended daily)

```bash
docker compose --profile core up --build
```

Open: http://localhost:3000  
Health: http://localhost:3000/api/features  

Stop:

```bash
docker compose --profile core down
```

### Core + Ignition

```bash
# Set ACCEPT_IGNITION_EULA=Y and IGNITION_ADMIN_PASSWORD in .env first
docker compose --profile core --profile ignition up --build
```

- P6 app: http://localhost:3000  
- Ignition Gateway HTTP: http://localhost:9088 (configurable via `IGNITION_HTTP_PORT`)  
- Ignition HTTPS: https://localhost:9043 (configurable via `IGNITION_HTTPS_PORT`)  
- Perspective template: mounted at Gateway `data/projects/P6_WaterTransfer` (see `ignition/perspective/P6_WaterTransfer/README.md`)

Gateway data persists in volume `p6_ignition_data`.

### MQTT proof

```bash
docker compose --profile core up --build -d
# wait for healthy, then:
curl -s http://localhost:3000/api/connect/mqtt
# optional host subscribe (if mosquitto clients installed):
# mosquitto_sub -h localhost -t 'p6systems/#' -v
```

### Integration-test smoke

```bash
docker compose --profile core --profile integration-test up --build --abort-on-container-exit
```

Exits non-zero if `/api/features` is not healthy.

### Compose file selection

The P6 profile stack lives in **`compose.yaml`** (Compose’s preferred filename).

### Legacy compose files

Older files (`docker-compose.share.yml`, `docker-compose.axiom-runtime.dev.yml`) remain for compatibility. Prefer `compose.yaml` with profiles for P6 work.

Dev live-reload (bind mounts) remains available via:

```bash
docker compose -f docker-compose.axiom-runtime.dev.yml up --build
```

(Note: that file still uses the legacy service name `axiom_runtime`.)

## Ignition notes

| Topic | Detail |
|-------|--------|
| Image | `inductiveautomation/ignition:8.3.9` (pinned) |
| EULA | Set `ACCEPT_IGNITION_EULA=Y` in `.env` to accept |
| Admin | `IGNITION_ADMIN_USERNAME` / `IGNITION_ADMIN_PASSWORD` — **never commit real passwords** |
| License | Trial/license is your responsibility; do not auto-install unlicensed modules |
| Modules | None are auto-installed by this compose file |
| Ports | Only mapped ports you configure; keep Gateway off public networks |
| Production writes | Not enabled; P6 Live Integration mode is future and off by default |

First Gateway boot may take several minutes. Healthcheck uses the Gateway HTTP status endpoint when available.

## Environment variables

See `.env.example` for the full list. Important:

- `PORT` — P6 app port inside container (default 3000)  
- `HMI_AUTH_BYPASS` — `1` for local demos only  
- `ENABLE_PY` — Python ladder nodes (default `0`)  
- Ignition vars only needed when using `--profile ignition`

## Data persistence

| Volume | Mount | Contents |
|--------|-------|----------|
| `p6_app_data` | `/app/server/data` | Config, snapshots, packets |
| `p6_ignition_data` | Ignition data dir | Gateway config (ignition profile) |
