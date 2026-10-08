# Build Status

**Last updated:** 2026-10-08  
**Branch:** `p6/phase0-phase1-foundation`  
**Current:** Phases 0–20 MVP complete · **Addendum Milestone A in progress** (Ignition UDT generator)

**Roadmap:** [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)  
**Build list / links:** [BUILD_LIST.md](./BUILD_LIST.md)  
**Engineering model:** [ENGINEERING_DATA_MODEL.md](./ENGINEERING_DATA_MODEL.md)  
**Ignition:** [IGNITION_INTEGRATION.md](./IGNITION_INTEGRATION.md)

## Foundation (proven)

| Check | Result |
|-------|--------|
| Runtime Water Transfer + FAT | PASS |
| OPC UA live nodes | PASS (`/api/connect/opcua`) |
| MQTT on core | PASS |
| OCR ingest | PASS |
| `node scripts/regression_all.mjs` | 6/6 PASS (incl. OCR + UDT) |

## Addendum milestones

| Milestone | Status | Look here |
|-----------|--------|-----------|
| **A** UDT Generator (pump) | **Working MVP** — generate / approve / export JSON for Ignition 8.3.9 | http://localhost:3000/engineering.html · `scripts/smoke_ignition_udt.mjs` |
| **B** Tag mapping live verify | Partial propose UI | http://localhost:3000/tags.html |
| **C** Perspective pump view | Planned (Water Transfer pack exists) | `ignition/perspective/P6_WaterTransfer/` |
| **D** Pump Skid + Tank Transfer templates | Planned | — |
| **E** P&ID → template match | Planned | — |
| **F** End-to-end demo | Planned | — |

## Next actionable task

**Milestone B depth:** enrich tag map editor (duplicates / type checks / OPC path + live value column) and prove simulation → OPC → mapped path without overwriting Ignition.
