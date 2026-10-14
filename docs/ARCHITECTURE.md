# P6 Systems — Architecture (North Star)

**Describes the system as it exists and the logical product topology.**  
**Last updated:** 2026-10-13  
**Planning authority:** [MASTER_DEVELOPMENT_PLAN.md](./MASTER_DEVELOPMENT_PLAN.md)

Legacy deep-dives remain useful and are **not deleted**: [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md), [EXISTING_ARCHITECTURE.md](./EXISTING_ARCHITECTURE.md), [PRODUCT_ARCHITECTURE.md](./PRODUCT_ARCHITECTURE.md), [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md), [CEM2_INVENTORY.md](./CEM2_INVENTORY.md), [PLATFORM_AUDIT.md](./PLATFORM_AUDIT.md).

---

## Logical product topology

```text
P6 SYSTEMS
    └── P6 STUDIO (engineering workspace)
            ├── P&ID ingestion
            └── Engineering tools (map, I/O, logic, interlocks)
                    │
                    ▼
            CANONICAL P6 MODEL (system of record)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   P6 RUNTIME              P6 VERIFY
   Virtual PLC             FAT / evidence
   Process / equipment     Fault scenarios
   Simulated I/O
        │
        ▼
   P6 CONNECT (optional)
   OPC UA · MQTT · Ignition (observe / export proposals)
```

| Layer | Owns | Does not own |
|-------|------|--------------|
| Studio | UX for ingest, mapping, sim controls, verify, connect | Scan-clock truth |
| Canonical model | Projects, equipment, signals, logic versions, tests | Ignition as SoR |
| Runtime | Deterministic scan, VirtualPLC, equipment models | Physical safety certification |
| Verify | FAT definitions, evidence, reports | Replacing Ignition historian |
| Connect | OPC UA, MQTT, Ignition artifact proposals | Required dependency for core |

---

## Deployed topology (MVP)

```text
Browser (static web/)
    │  HTTP poll (~600 ms)
    ▼
p6-app (Express monolith)     compose profile: core
    ├── Static UI — landing.html, studio.html, legacy pages
    ├── Canonical model API → server/data/canonical/
    ├── VirtualPLC Runtime  → server/plc/*
    ├── P6 Verify           → server/verify/*
    ├── Document / OCR      → pid_parser, ocr_ingest
    └── P6 Connect          → opcua_server, mqtt, ignition_udt
         │
         ├── Mosquitto (core)
         └── Ignition Gateway 8.3.9 (profile: ignition) — optional
```

- **Persistence:** JSON files + Docker volume `p6_app_data` → `/app/server/data`. SQL deferred.  
- **Schema:** `SCHEMA_VERSION = 2` (CEM 2.0 additive); migrations in `server/model/migrate.js`.  
- **Auth:** Session + RBAC helpers; `HMI_AUTH_BYPASS` for local demos only.

---

## Frontend

| Surface | Role | Status |
|---------|------|--------|
| `landing.html` | Marketing — preserve visual direction | Working |
| `studio.html` + `studio.js` / `studio.css` | Primary engineering workspace (Design · Logic · I/O · Simulate · Verify) | Working (MVP) |
| Legacy pages (`simulation.html`, `verify.html`, `ingest.html`, …) | Standalone tools; not nested in Studio iframes | Partial / legacy |

No bundler. Vanilla JS. Canvas layout: `project.ui.graph`. Commands: `POST /api/runtime/command` with server validation.

Inventory: [STUDIO_UX_INVENTORY.md](./STUDIO_UX_INVENTORY.md).

---

## Backend modules (preserve)

| Module | Path | Role |
|--------|------|------|
| Model SoR | `server/model/*` | Projects, validation, X-Ray, impact, seeds |
| Runtime | `server/plc/*` | VirtualPLC, ladder IR, SimClock, equipment |
| Equipment | `server/plc/equipment/*` | Library, water_transfer, tank_transfer |
| Verify | `server/verify/*` | FAT runner |
| Connect | `server/connect/*` | OPC UA, MQTT, UDT, vendor_mapping |
| Ingest | `server/plc/ocr_ingest.js`, `pid_parser.js` | Document extract |
| Readiness | `server/readiness.js` | Health + knownLimits |

---

## Data flow

```text
Documents → Review/Approve → Canonical Model → Logic + Equipment
                                    ↓
                              P6 Runtime
                               ↙     ↘
                         P6 Verify   P6 Connect → Ignition (optional)
```

Stable join keys for integrators: `equipment.tag`, `signal.tag`. Revision: `modelVersion`.

Live runtime values live on the project binding / PLC IO image — not rewritten into SoR every scan.

---

## Compose profiles

| Profile | Services |
|---------|----------|
| `core` | `p6-app` + Mosquitto |
| `ignition` | Official Ignition 8.3.9 |
| `integration-test` | curl smoke against healthy app |

Details: [DOCKER.md](./DOCKER.md). Core **never** requires Ignition.

---

## Architectural limits (honest)

- Not a React SPA; no WebSocket yet (HTTP poll).  
- Process physics beyond discrete equipment models is limited.  
- Scanned image OCR unfinished; text/PDF extract works.  
- Ignition live tag bind not proven (EULA / credentials — KI-019).  
- Allen-Bradley export is placeholder.  
- History playback overlays recorded signals (does not rewind plant physics).  
- Verify catalog: one automated FAT (`P101_ESTOP_SHUTDOWN`) until more are implemented.

---

## Decision posture

- Prefer reuse of `server/plc/*`, Express APIs, Docker patterns over rewrites.  
- Container splits follow ADR-001 only when justified.  
- Feature work follows [MASTER_DEVELOPMENT_PLAN.md](./MASTER_DEVELOPMENT_PLAN.md) milestones 00–11.
