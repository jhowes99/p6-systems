# P6 Engineering Data Model (Shared SoR)

**System of record:** Canonical P6 model (`server/data/canonical/`).  
Detail: [CANONICAL_MODEL.md](./CANONICAL_MODEL.md). Schema version in `server/model/schema.js`.

This document defines **how all product surfaces share one model** (Addendum §4). Do not invent parallel equipment schemas for OCR, templates, Runtime, Verify, or Ignition generation.

---

## Consumers (must use versioned adapters)

| Consumer | Reads | Writes |
|----------|-------|--------|
| P&ID / OCR ingest | — | Candidates as `ENGINEERING_INFERENCE` until promote/approve |
| Equipment library | Type templates | Instantiates equipment into project |
| Control logic / Logic deploy | Signals, interlocks | Staged logic → apply to Runtime IR |
| P6 Runtime | Bound project signals | Live values, quality, timestamps |
| P6 Verify | Test cases on project | Test results / FAT evidence |
| Ignition Engineering Generator | Approved equipment + signals | **Proposals only** until engineer approve/export |
| Simulation templates | Template defs | New project instance (unique id; no shared mutable state) |

---

## Core entity alignment

Reuse existing entities: Project, Equipment, Instrument, Signal, Interlock, ControlLogic, SimulationModel, TestCase, VendorAdapter, IntegrationConnection.

### Equipment ↔ library

`Equipment.type` maps to `server/plc/equipment/library.js` type keys (`pump`, `motor`, `valve`, …).  
Library defines signal member names used by Runtime **and** Ignition UDT member proposals (`P6_Pump`, etc.).

### Signal identity

Stable `signal.tag` (e.g. `P101.RunningFeedback`) is the join key for:

- Runtime / OPC UA NodeId path  
- Tag map `p6Signal`  
- UDT instance member binding  
- Verify assertions  

### Data classification

`EXTRACTED_FACT` → `ENGINEERING_INFERENCE` → `ENGINEER_APPROVED`  

Ignition artifacts and template instantiations require **engineer approval** before treat-as-deployed.

---

## Ignition adapter (export only)

Transformations live under `server/connect/`:

| Module | Role |
|--------|------|
| `tag_mapping.js` | P6 → Ignition path proposals (persist under `tag_maps/`) |
| `ignition_udt.js` | Reusable UDT defs + instances (Milestone A) |
| `opcua_server.js` | Live observation namespace from Runtime |

Export packages are **reviewable JSON** compatible with documented Ignition 8.3 resource shapes. They are not a second SoR.

---

## Simulation templates (future Milestone D)

Templates are versioned definitions that **materialize** a new Project via the same schema:

1. Clone equipment / signals / interlocks / logic / tests from template  
2. Apply engineer tag/parameter overrides  
3. Assign new `projectId` — instances never share Runtime state  

Optional Ignition UDT mappings attach as Connect proposals after instantiation.

---

## Anti-patterns (forbidden)

- Separate “Ignition equipment model” that drifts from P6 Equipment  
- Auto-promoting OCR candidates to approved without UI review  
- Overwriting Ignition or P6 configs without explicit authorization  
- Mock OPC values labeled as live simulation data  
