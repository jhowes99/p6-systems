# Phase 10 — Industrial Integrations (Connect)

**Milestone:** 10  
**Plan:** [docs/MASTER_DEVELOPMENT_PLAN.md](../docs/MASTER_DEVELOPMENT_PLAN.md)  
**Status:** Partial / live **Blocked** (Ignition unproven — KI-019)

## Goal

Extensible OPC UA / MQTT / Ignition adapters. Core works without Ignition. No live deploy claim until validated. Never auto-write physical PLCs.

## Required functionality

- Adapter architecture registry with honesty labels
- OPC UA / MQTT status (existing ENABLE_* gates)
- Ignition UDT / Perspective proposal path with engineer approval
- Vendor mapping proposals only (CEM 2.0 stub)

## Existing to preserve

- `server/connect/opcua_server.js`, `mqtt_publisher.js`
- `ignition_udt.js` approve + download-only deploy
- `tag_mapping.js`, `vendor_mapping.js`
- Compose profile `ignition` (optional)

## Tasks

- [x] `server/connect/adapters.js` — architecture snapshot
- [x] `GET /api/connect/architecture` + enriched `/api/connect/status`
- [x] Package embeds Connect architecture JSON with `liveDeployClaimed: false`
- [x] Honesty: Ignition liveProven=false; neverAutoWritePhysicalPlc=true
- [ ] Live OPC UA prove-out with node-opcua installed + ENABLE_OPCUA=1
- [ ] Live MQTT broker prove-out
- [ ] Ignition Gateway EULA + admin password + proven tag flow (operator gated)

## APIs

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/connect/status` | Includes architecture + honesty |
| GET | `/api/connect/architecture` | Adapter registry |
| GET | `/api/connect/opcua` | OPC UA status |
| GET | `/api/connect/mqtt` | MQTT status |
| * | `/api/connect/engineering/udt/*` | Generate / approve / export (existing) |

## Honesty labels

- Mode: EXTENSIBLE_STUBS until each path validated
- Ignition: proposal_only — KI-019
- LIVE_INTEGRATION off by default

## Acceptance

- Core starts without Ignition profile
- Architecture endpoint documents all three adapters
- No silent SoR overwrite / no physical PLC auto-write

## Limitations

- Ignition live blocked on EULA/admin password + unproven tag flow
- OPC UA / MQTT require optional native deps + env flags
