# P6 Systems — Product Architecture

Canonical product topology. Implementation may start as a monolith (`p6-app`); this diagram is the **logical** system of record for product boundaries.

```text
P6 SYSTEMS
                         |
                      P6 STUDIO
               Engineering Workspace
                         |
             +-----------+-----------+
             |                       |
       P&ID INGESTION          ENGINEERING TOOLS
             |                       |
       PDF / Drawings          Equipment Mapping
       Instrument Tags         I/O Assignment
       Specifications          Logic Generation
       Equipment Lists         Interlocks / Sequences
             |                       |
             +-----------+-----------+
                         |
                 CANONICAL P6 MODEL
                         |
             +-----------+-----------+
             |                       |
         P6 RUNTIME               P6 VERIFY
             |                       |
       Virtual PLC                Automated FAT
       Process Models             Regression Tests
       State Machines             Fault Injection
       Simulated I/O              Evidence / Reports
             |
          P6 CONNECT
             |
      +------+------+------+
      |             |      |
   Ignition       OPC UA  MQTT
      |
   Ignition Gateway
      |
   Tags / UDTs
   Perspective
   Alarm / History
   SCADA Visualization
```

## Layer rules

| Layer | Owns | Does not own |
|-------|------|----------------|
| **P6 Studio** | UX for ingest, mapping, logic authoring, simulation controls, verify, connect, reports | Execution truth (browser timing is not the scan clock) |
| **P&ID Ingestion** | Document parse, candidates, confidence, human review | Silent promotion to approved engineering data |
| **Engineering Tools** | Mapping, I/O, logic, interlocks/sequences against the model | Vendor-specific PLC project formats (adapters only) |
| **Canonical P6 Model** | System of record for projects, equipment, signals, logic versions, tests | Ignition tags as authoritative engineering data |
| **P6 Runtime** | Deterministic scan, virtual PLC, process/equipment models, simulated I/O | Physical machine safety certification |
| **P6 Verify** | FAT definitions, regression, fault scenarios, evidence/reports | Replacing Ignition historian/alarms |
| **P6 Connect** | OPC UA (primary), MQTT (later), Ignition Gateway integration | Required dependency for core Runtime |

## Data flow (engineering workflow)

```text
Documents → Review/Approve → Canonical Model → Logic + Equipment
                                    ↓
                              P6 Runtime
                               ↙     ↘
                         P6 Verify   P6 Connect → Ignition (optional)
```

## Deployment mapping (current MVP)

| Logical block | Deployed as (Phase 1) | Status |
|---------------|----------------------|--------|
| P6 Studio | Static UI in `p6-app` | Partial (Axiom-era pages) |
| P&ID Ingestion | Modules in `p6-app` | Partial (PDF/JSON; OCR incomplete) |
| Engineering Tools | Modules in `p6-app` | Partial |
| Canonical P6 Model | `server/data/canonical/` + `/api/model` | Phase 2 done (schema v1); Runtime bind = Phase 3 |
| P6 Runtime | `VirtualPLC` + sim clock + signal bind in `p6-app` | Phase 3 MVP done; process models = Phase 4 |
| P6 Verify | `test_runner` + UI in `p6-app` | Partial (C&E tests; no Water Transfer FAT) |
| P6 Connect | Compose `ignition` profile only | Gateway optional; OPC UA/MQTT not implemented |
| OPC UA / MQTT | — | Missing (Phases 6 / 10) |

Ignition remains **optional**: Runtime and Verify must run with `--profile core` alone.

## Related docs

- `docs/EXISTING_ARCHITECTURE.md` — inherited Ironclad/Axiom code
- `docs/GAP_ANALYSIS.md` — classification vs master spec
- `docs/IMPLEMENTATION_PLAN.md` — phase order
- `docs/ARCHITECTURE_DECISIONS.md` — ADRs (monolith, Ignition optional, OPC UA first)
