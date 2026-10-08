# P6 Systems — Development Roadmap

Extends [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) and [PHASES_10_20.md](./PHASES_10_20.md).

**Foundation gate (required before Milestones A–F):** Runtime Water Transfer + OPC UA acceptance passed. See [BUILD_STATUS.md](./BUILD_STATUS.md) and [TEST_RESULTS.md](./TEST_RESULTS.md).

---

## Completed foundation (Phases 0–20 MVP)

Canonical model, Runtime, Water Transfer, Studio, OPC UA, Verify, ingest/OCR, MQTT, tag map UI, canvas, trace, security, regression, equipment library, logic UI, reports, readiness, Perspective template pack.

Clickable inventory: [BUILD_LIST.md](./BUILD_LIST.md).

---

## Addendum — Ignition Engineering & Simulation Templates

**Priority:** High  
**Constraint:** Do not rebuild working components. All features share the [canonical engineering model](./ENGINEERING_DATA_MODEL.md).

### Capability tracks

| Track | Goal |
|-------|------|
| **Ignition Engineering Generator** | Approved P6 model → reviewable Ignition UDTs, tag maps, alarms/history proposals, Perspective assets, export/deploy |
| **Reusable simulation templates** | Versioned industrial starting points (Pump Skid → Tank Transfer → …) that instantiate executable Runtime projects |
| **P&ID → template matching** | After ingest, propose templates; engineer must approve associations |

### Workflow (Ignition Engineering Generator)

1. Upload P&ID → extract → engineer approve model  
2. Identify Ignition tags / structures  
3. Propose UDTs + instances  
4. Propose OPC UA bindings  
5. Propose alarms / history designations  
6. Propose Perspective assets  
7. Engineer review  
8. Export or controlled deploy (never overwrite without authorization)

---

## Milestones A–F

| Milestone | Focus | Exit criteria | Status |
|-----------|--------|---------------|--------|
| **A** | Ignition UDT Generator | Valid pump UDT + instance from P6 model; version-validated artifact; approval before export | **MVP complete** (smoke PASS; Gateway import still operator-validated) |
| **B** | Ignition Tag Mapping | Generated maps resolve; live OPC UA values from simulation | Planned (partial propose UI exists) |
| **C** | Perspective Equipment View | Reusable pump view with working P6 bindings | Planned (Water Transfer pack exists; pump template next) |
| **D** | Template Library | Pump Skid + Tank Transfer run in Runtime | Planned |
| **E** | P&ID Template Matching | Sample P&ID → suggested template; engineer approval | Planned |
| **F** | End-to-end demo | P&ID → approve → template → sim → Ignition tags/viz → FAT → report | Planned |

Implement templates **incrementally** (Pump Skid first, then Tank Transfer). Do not build all five template families at once.

### Deferred

- Sparkplug B (after lifecycle correctness)
- Custom Ignition module
- Gateway write/deploy APIs unless officially documented for pinned version
- Full process Perspective plants (after single pump view proven)

---

## Acceptance rules (addendum)

A milestone is complete only when:

- UDT output is structurally valid for the target Ignition version  
- Tag paths resolve; OPC UA values come from live simulation  
- Perspective bindings work (no hardcoded mock values as “done”)  
- Templates instantiate executable models with unique instance identity  
- Simulation is repeatable; Verify reports reflect actual runs  
- Existing engineering data is never overwritten accidentally  

Update `BUILD_STATUS.md`, `TEST_RESULTS.md`, and milestone docs when proving each exit criterion.

---

## Related docs

| Doc | Role |
|-----|------|
| [ENGINEERING_DATA_MODEL.md](./ENGINEERING_DATA_MODEL.md) | Shared SoR + adapters |
| [IGNITION_INTEGRATION.md](./IGNITION_INTEGRATION.md) | Connect + generator + deploy rules |
| [CANONICAL_MODEL.md](./CANONICAL_MODEL.md) | Schema / API details |
| [BUILD_LIST.md](./BUILD_LIST.md) | Links to Studio / APIs |
