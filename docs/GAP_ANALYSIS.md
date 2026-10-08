# Gap Analysis — Axiom/Ironclad → P6 Systems

**Audit date:** 2026-10-07  
**Classification key:** Existing and working · Existing but incomplete · Missing · Requires refactoring · Deferred

---

## Product packaging & repo integrity

| Item | Classification | Evidence / notes |
|------|----------------|------------------|
| Application source in git | **Requires refactoring** | `server/` / `web/` only in installer zip; clone broken |
| Docker single-container run | Existing and working (needs restore) | Dockerfile + compose files present |
| P6 branding (Studio/Runtime/Verify/Connect) | Missing | UI still “Axiom Verify” |
| Customer-facing Axiom copy removal | Missing | README, shell, exporters, Electron productName |
| End-to-end engineering workflow (spec §3–15) | Existing but incomplete | Pieces exist; not one coherent P6 Studio flow |

---

## Section mapping to P6 master spec

### Docker environment (§2)

| Feature | Classification |
|---------|----------------|
| App container + healthcheck | Existing and working |
| Persistent data volume | Existing but incomplete (no named volume in compose) |
| Compose profiles `core` / `ignition` / `integration-test` | Missing → Phase 1 |
| Optional Ignition 8.3 Gateway | Missing → Phase 1 |
| Redis / object storage / MQTT broker | Deferred (add when a capability needs them) |
| Separate containers per product name | Deferred — unjustified while monolith works |

### P6 Studio (§3)

| Feature | Classification |
|---------|----------------|
| Multi-page engineering UI | Existing but incomplete |
| Public landing (“FROM P&ID TO VIRTUAL COMMISSIONING”) | Missing |
| Auth’d workspace nav (Dashboard…Settings) | Missing |
| Project create / versions / reports | Existing but incomplete (snapshots, packets) |

### P&ID ingestion (§4)

| Feature | Classification |
|---------|----------------|
| PDF / CSV / structured JSON import | Existing and working |
| Image OCR | **Implemented** — `ocr_ingest.js` + `/api/ingest/ocr` + ingest UI (engineer review before promote) |
| Confidence + fact/inference/approved | Missing |
| Mandatory human review UI | Existing but incomplete |
| Canonical relationship mapping | Missing |

### Canonical engineering model (§5)

| Feature | Classification |
|---------|----------------|
| Address-level I/O + ladder IR | Existing and working |
| Versioned schema (Project, Equipment, Signal, …) | Missing |
| Signal quality / override / timestamp model | Missing |
| P6 as SoR vs Ignition | Missing (Ignition absent) |

### P6 Runtime (§6)

| Feature | Classification |
|---------|----------------|
| Digital/analog I/O, boolean logic, timers, faults | Existing and working |
| Server scan cycle | Existing and working |
| Simulation clock (not wall clock) | Missing / Requires refactoring (TON uses `Date.now()`) |
| START/STOP/PAUSE/RESUME/RESET/STEP | Existing but incomplete |
| Equipment + process simulation layers | Missing |
| Staged live logic deploy | Missing (Phase 9) |

### Virtual control logic (§7)

| Feature | Classification |
|---------|----------------|
| Vendor-neutral ladder IR | Existing and working |
| IEC-oriented concepts (partial) | Existing but incomplete |
| Validated vendor exporters | Existing but incomplete (placeholders / unvalidated) |

### Virtual equipment library (§8)

| Feature | Classification |
|---------|----------------|
| Reusable Motor/Pump/Valve/Tank models | Missing |
| First Motor device list in template | Existing but incomplete (UI devices, not sim models) |

### Ignition / P6 Connect (§9)

| Feature | Classification |
|---------|----------------|
| OPC UA exposure of runtime signals | Missing (Phase 6) |
| Tag mapping UI | Missing |
| Gateway OpenAPI client | Missing |
| Perspective example | **Shipped** — `ignition/perspective/P6_WaterTransfer/` (OPC UA live bindings) |
| MQTT telemetry | **Implemented** — JSON publisher + Mosquitto on core profile |
| Live Integration mode | Deferred (must stay off by default) |

### P6 Verify (§10)

| Feature | Classification |
|---------|----------------|
| C&E-generated FAT tests + run | Existing and working |
| Water Transfer `P101_ESTOP_SHUTDOWN` scenario | Missing |
| Evidence with version refs + PDF report | Existing but incomplete |
| Regression suite vs golden traces | Missing |

### Live engineering canvas (§11)

| Feature | Classification |
|---------|----------------|
| Panel / electrician views | Existing but incomplete |
| Live process canvas with runtime-backed status | Missing |

### Traceability (§12)

| Feature | Classification |
|---------|----------------|
| C&E ↔ I/O ↔ IR helpers | Existing but incomplete |
| Full document→test→evidence chain UI | Missing |

### Security (§13)

| Feature | Classification |
|---------|----------------|
| Secure mode + PBKDF2 password | Existing and working |
| RBAC / project auth / credential vault | Missing |
| `.env.example` without secrets | Existing but incomplete |

### Deterministic testing (§14)

| Feature | Classification |
|---------|----------------|
| Independent IO per test + N scans | Existing and working |
| Simulation time ≠ wall clock | Missing |
| Automated CI regression | Missing (claimed unit tests absent from tree) |

### Reference project (§15)

| Feature | Classification |
|---------|----------------|
| First Motor | Existing and working |
| Water Transfer System | Missing (Phase 4) |

---

## Fake / overstated functionality risks

| Claim / UI | Reality |
|------------|---------|
| Image OCR / “full OCR coming soon” | Closed — tesseract.js for images; pdf-parse for searchable PDF |
| Allen-Bradley export | Placeholder exporter |
| Ignition integration | Marketing/export mention only |
| Evaluator unit tests in hardening doc | File not in restored source |
| Deterministic timers | Wall-clock based |

Per P6 rule **1.3**: unfinished features must be labeled; integrations must not be claimed until data flow is proven.

---

## Minimum viable architecture recommendation

1. **Keep the Express monolith** for Studio UI + API + Runtime + Document Processing in one deployable (`p6-app`) until OPC UA / load / team boundaries force a split.  
2. **Persist with a Docker volume** on `server/data` in Phase 1; introduce Postgres only when the canonical model needs multi-user concurrency/migrations (Phase 2+).  
3. **Ignition optional** via Compose profile; never block core startup.  
4. **Evolve IR + IOModel** into a versioned canonical model rather than rewriting the scan engine.  
5. **Extend First Motor → Water Transfer** as the vertical slice that drives Runtime, Verify, and Connect.  
6. **Restore and commit source** (`server/`, `web/`, `control_narrative_gen/`) so Docker and git clones work.
