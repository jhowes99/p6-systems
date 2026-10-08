# Canonical P6 Model (Phase 2)

System of record for P6-generated engineering data. Ignition is an optional consumer (P6 Connect), not the SoR.

## Persistence

```text
server/data/canonical/
  meta.json                 # schemaVersion, activeProjectId
  projects/<projectId>/
    project.json            # full project aggregate
```

- Format: JSON files (ADR-002). SQL deferred until multi-user concurrency requires it.
- Schema version: `SCHEMA_VERSION` in `server/model/schema.js` (currently **1**).
- Migrations: `server/model/migrate.js` — applied on load; never drop fields without a migration.

## Core entities

Project, Document, DocumentVersion, Equipment, Instrument, Signal, IOPoint, Connection, ControlModule, Interlock, ControlLogic, SimulationModel, SimulationRun, TestCase, TestResult, VendorAdapter, IntegrationConnection.

### Signal properties (Spec §5)

`id`, `tag`, `dataType`, `units`, `direction`, `initialValue`, `currentValue`, `quality`, `source`, `timestamp`, `simulationOverride` (+ `overrideValue`), plus `equipmentId` / `address` bridge fields.

### Data classification (Spec §4)

`EXTRACTED_FACT` | `ENGINEERING_INFERENCE` | `ENGINEER_APPROVED`

Uncertain extractions data must not be silently promoted — use `POST .../approve`.

## API (`/api/model`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Schema version + active project |
| GET | `/projects` | List projects |
| POST | `/projects` | Create project |
| GET | `/projects/active` | Active project |
| POST | `/projects/active` | Set active `{ projectId }` |
| POST | `/projects/seed/water-transfer` | Idempotent Water Transfer seed |
| GET/PATCH/DELETE | `/projects/:id` | Load / update meta / delete |
| GET/POST | `/projects/:id/equipment` | List / add equipment |
| PATCH | `/projects/:id/equipment/:equipmentId` | Update equipment |
| GET/POST | `/projects/:id/signals` | List / add signals |
| PATCH | `/projects/:id/signals/:signalId` | Update signal |
| POST | `/projects/:id/approve` | Promote entity to ENGINEER_APPROVED |
| GET | `/projects/:id/summary` | Counts + tags |
| POST | `/projects/:id/import-legacy-bundle` | Bridge from LAST_PROJECT shape |

## Water Transfer seed

On server start (unless `P6_SEED_WATER_TRANSFER=0`), seeds **Water Transfer System** with:

- Equipment: TANK101, XV101, P101, M101, LSH101, ESTOP101  
- Signals for run/feedback/fault/E-stop/level/etc.  
- Interlocks: LSH101_INHIBIT, ESTOP101_SHUTDOWN  
- Test case definition: `P101_ESTOP_SHUTDOWN` (execution = Phase 7)  
- OPC UA integration connection placeholder (`not_implemented`)

Runtime behavior for this equipment is **Phase 4** — Phase 2 only persists the engineering model.

## Legacy bridge

`project.legacy` holds `ladderIR`, `ioMap`, `causeEffectRules`, `ioEntries` so existing Studio/Runtime paths keep working while migration continues.
