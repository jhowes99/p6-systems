# P6 Systems — Master Development Plan

**Authority for this initiative.** Supersedes prior phase numbering for planning order; legacy docs remain historical evidence.  
**Philosophy:** AUTOMATE THE WORK. ENGINEER THE DECISIONS.  
**Last updated:** 2026-10-13  
**Branch:** `p6/phase0-phase1-foundation`

| Companion | Role |
|-----------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current topology north-star |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | Milestone rollup |
| [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) | Working rules + industrial honesty |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | Open defects / limits |
| [TEST_RESULTS.md](./TEST_RESULTS.md) | Regression evidence |
| [BUILD_STATUS.md](./BUILD_STATUS.md) | Session / delivery notes |

Phase task trackers live under [`development/`](../development/).

---

## Product intent

P6 Systems reduces repetitive controls engineering work while preserving engineer oversight.

**Target workflow**

```text
Import drawings → Extract data → Reconstruct P&ID → Review decisions
  → Generate control logic → Configure HMI/SCADA → Virtual simulation
  → Inject faults → Automated verification → Engineering package
  → Engineer approval → Deployment preparation
```

**Surfaces:** P6 Studio · P6 Runtime · P6 Verify · P6 Connect  
**Hub:** Canonical Engineering Model (file JSON SoR under `server/data/canonical/`).

---

## Audit snapshot (2026-10-13)

Honest classification from repo inspection + regression evidence (`scripts/regression_all.mjs` **11/11** last recorded).

| Area | Exists | Works | Broken / unfinished |
|------|--------|-------|---------------------|
| Architecture | Express monolith `p6-app`, Compose `core` + optional `ignition` | Core bring-up, healthchecks | KI-001: `main` historically omitted app source |
| Frontend | `web/studio.html` four-workspace shell; landing; many legacy pages | Studio UX Phase 1 rebuild (E2E four-workspace markers) | Control-sequence authoring UI (KI-023); legacy page sprawl outside Studio |
| Backend | `server/server.js` + `/api/model|runtime|verify|connect|ingest|…` | Primary routes exercised by smokes | Some standalone HTML tools not folded into Studio |
| Canonical model | Schema v2, store, migrate, validate, impact, adapters | CEM2 smoke PASS; Water Transfer / Tank Transfer seeds | `controlSequences` collection empty of authoring UX; `legacy.*` still parallel |
| Drawing import (P6 Vision / brief Phase 3 ≡ M04) | `ocr_ingest`, `ingest_promote`, Studio wizard | Text/PDF/SVG/CSV pipeline, source refs, connection/gap review, retain+promote | Scanned image OCR (KI-003); PDF geometry→topology unfinished |
| Equipment graphics | Inline SVG helpers in `studio.js`; library types in `equipment/library.js` | Basic type symbols on canvas | Full industrial P&ID symbol library / symbol pack not shipped |
| Runtime / sim | VirtualPLC, SimClock, water_transfer + tank_transfer equipment | Start/pause/step, tank levels, pump/valve, X-Ray | Continuous process physics limited; history = signal overlay (KI-012) |
| Codegen | Ladder IR, ST/wiring/IO exporters, logic stage/apply | IR execution + deploy APIs | Allen-Bradley placeholder (KI-007); model→logic auto-gen incomplete |
| Verify | FAT runner, `P101_ESTOP_SHUTDOWN`, PDF, Verify UI | FAT PASS in regression | One automated FAT only (KI-015) |
| Integrations | OPC UA server, MQTT, UDT propose/approve/export | OPC/MQTT status APIs; UDT smoke | Ignition live bind blocked (KI-019) |
| Persistence | JSON canonical + Docker volume | Project save/reload via API | SQL deferred; no multi-user concurrency |
| Tests | `regression_all.mjs` (11 jobs) + Studio E2E | Recorded **11/11 PASS** | Evaluator unit tests missing from tree (KI-002) |

**Preserve:** VirtualPLC, Water/Tank Transfer sims, canonical store, OPC UA/MQTT, FAT runner, Studio four-workspace shell, landing visual direction, Compose core profile.

---

## Milestones 00–11

| ID | Title | Phase file | Status (honest) |
|----|-------|------------|-----------------|
| 00 | Architecture and Codebase Audit | [phase-00-audit.md](../development/phase-00-audit.md) | ✓ Docs complete this session |
| 01 | Studio User Experience | [phase-01-studio-ux.md](../development/phase-01-studio-ux.md) | ◐ Four-workspace shell; human acceptance walkthrough open |
| 02 | Industrial SVG Equipment Library | [phase-02-industrial-symbols.md](../development/phase-02-industrial-symbols.md) | ◐ Basic symbols only |
| 03 | Canonical Engineering Model | [phase-03-canonical-model.md](../development/phase-03-canonical-model.md) | ◐ CEM 2.0 foundation |
| 04 | PDF/Image P&ID Import (P6 Vision) | [phase-04-pid-import.md](../development/phase-04-pid-import.md) | ◐ Pipeline+review+promote; image OCR open |
| 05 | Equipment Identification and Templates | [phase-05-equipment-templates.md](../development/phase-05-equipment-templates.md) | ◐ Control templates + apply/approve; auto-match open |
| 06 | PLC Logic and I/O Generation | [phase-06-code-generation.md](../development/phase-06-code-generation.md) | ◐ IEC ST + I/O + review gates; not multi-vendor deployable |
| 07 | Virtual PLC and Process Runtime | [phase-07-virtual-runtime.md](../development/phase-07-virtual-runtime.md) | ◐ MVP + mass balance / dry-run; not CFD (KI-027) |
| 08 | Fault Injection and Commissioning | [phase-08-fault-injection.md](../development/phase-08-fault-injection.md) | ◐ Named process faults + analog force; packet incomplete |
| 09 | Automated Verification and FAT | [phase-09-verification.md](../development/phase-09-verification.md) | ◐ One FAT |
| 10 | Industrial Integrations | [phase-10-integrations.md](../development/phase-10-integrations.md) | ◐ OPC/MQTT; Ignition live blocked |
| 11 | Engineering Exports and Change Management | [phase-11-engineering-exports.md](../development/phase-11-engineering-exports.md) | ◐ Partial exports |

Legend: ✓ milestone MVP acceptance largely met · ◐ partial · ✗ not started meaningfully

---

## Per-milestone definitions

### 00 — Architecture and Codebase Audit

- **Required:** Inventory stack, routes, model, runtime, verify, connect, persistence, tests; classify working / partial / missing / broken; document preserve list.
- **Preserve:** All working Runtime/Connect/Verify paths; landing page; compose patterns.
- **Tasks:** See [phase-00-audit.md](../development/phase-00-audit.md).
- **Dependencies:** None (foundation).
- **Integration:** None.
- **Testing:** Doc honesty cross-check vs `regression_all.mjs` and `/api/readiness` knownLimits.
- **Acceptance:** Master plan + architecture + status docs exist and match codebase.
- **Limitations:** Audit is point-in-time; update when topology changes.

### 01 — Studio User Experience

- **Required:** Single canvas-first Studio; Design · Engineer · Simulate · Verify & Export; no nested iframe apps; project selection persists; real API actions only.
- **Preserve:** Four-workspace shell, landing CTAs, pan/zoom/undo, inspector/X-Ray, sim bar, water-transfer energize path.
- **Tasks:** [phase-01-studio-ux.md](../development/phase-01-studio-ux.md).
- **Dependencies:** M00; model APIs (M03).
- **Integration:** All Studio panels → `/api/model`, `/api/runtime`, `/api/verify`.
- **Testing:** `smoke_studio_e2e.mjs`; manual four-workspace checklist.
- **Acceptance:** E2E markers green; Create→Simulate path without training; unfinished capabilities labeled (not fake).
- **Limitations:** Standalone legacy pages remain; control-sequence editor unfinished (KI-023).

### 02 — Industrial SVG Equipment Library

- **Required:** Professional industrial symbols (tank, pump, valve, instruments, motor, …) driven by equipment type; runtime state reflected in graphics.
- **Preserve:** Existing `symbolSvg` types and equipment library signal schemas.
- **Tasks:** [phase-02-industrial-symbols.md](../development/phase-02-industrial-symbols.md).
- **Dependencies:** M01 canvas; M03 equipment types; M05 templates.
- **Integration:** Canvas nodes bind `equipment.id` / `type`; live state from runtime canvas API.
- **Testing:** Visual + E2E that symbols render per type and update on run/fault.
- **Acceptance:** Water Transfer / Tank Transfer demos show distinct industrial symbols with live state.
- **Limitations:** Not a full ISA/ISO symbol CAD suite; start with demo equipment set.

### 03 — Canonical Engineering Model

- **Required:** One SoR for projects, equipment, signals, connections, interlocks, tests; migrations; validation; impact; no silent overwrite of approved data.
- **Preserve:** `server/model/*`, schema v2, Water/Tank seeds, `legacy` bridge, write-path validation.
- **Tasks:** [phase-03-canonical-model.md](../development/phase-03-canonical-model.md).
- **Dependencies:** M00.
- **Integration:** Studio/Runtime/Verify/Connect read/write through model APIs.
- **Testing:** `smoke_test.js`, `smoke_test_cem2.js`.
- **Acceptance:** Schema migrate on load; validation + impact APIs; seeds reload lossless.
- **Limitations:** SQL deferred; control-sequence authoring not complete vs full §23.

### 04 — PDF/Image P&ID Import (P6 Vision)

- **Required:** Import drawings; extract tags/equipment/connections with source refs; engineer review (accept/reject/correct); promote with data classification; gap decisions; reconstruct editable diagram. User brief calls this **Phase 3 — P6 Vision** — tracker remains M04 / `phase-04-pid-import.md`.
- **Preserve:** OCR/PDF ingest, promote confirm (no silent approve), CEM, Studio Design → Import P&ID.
- **Tasks:** [phase-04-pid-import.md](../development/phase-04-pid-import.md).
- **Dependencies:** M03; M01 ingest panel.
- **Integration:** Promote → canonical equipment/instruments/connections/documents; never auto-approve; ambiguous topology requires explicit include.
- **Testing:** `smoke_ocr.mjs`; Vision pipeline + promote paths in Studio E2E.
- **Acceptance:** Water-transfer text/SVG/PDF path yields reviewable candidates, connection proposals, gaps, and promotes into model with source links.
- **Limitations:** Scanned image OCR unfinished (KI-003); PDF vector geometry→topology unfinished.

### 05 — Equipment Identification and Templates

- **Required:** Identify tanks/pumps/valves/instruments; instantiate executable templates; engineer approval of associations.
- **Preserve:** `EquipmentLibrary`, `water_transfer.js`, `tank_transfer.js`, plant binding.
- **Tasks:** [phase-05-equipment-templates.md](../development/phase-05-equipment-templates.md).
- **Dependencies:** M03, M04; Runtime M07 for executable templates.
- **Integration:** Template instance → model equipment + runtime IR bind.
- **Testing:** water_transfer + tank_transfer smokes; template seed APIs.
- **Acceptance:** Import/seed → identified equipment → runnable template without parallel models.
- **Limitations:** Auto P&ID→template matching not proven end-to-end.

### 06 — PLC Logic and I/O Generation

- **Required:** Generate preliminary control logic and I/O maps from approved model; staged deploy; traceable artifacts.
- **Preserve:** Ladder IR, `logic_deploy`, IO map bridge, exporters that are honest about placeholders.
- **Tasks:** [phase-06-code-generation.md](../development/phase-06-code-generation.md).
- **Dependencies:** M03, M05.
- **Integration:** Generated IR binds to signals; Verify uses same tags.
- **Testing:** Runtime logic validate/stage/apply; regression runtime jobs.
- **Acceptance:** From approved Water Transfer model, engineer can obtain preliminary logic + I/O and deploy to Runtime.
- **Limitations:** Vendor PLC packages (AB) placeholder until validated (KI-007).

### 07 — Virtual PLC and Process Runtime

- **Required:** Deterministic scan; sim clock; equipment + process behavior; operator commands with real reject reasons; live canvas feedback.
- **Preserve:** VirtualPLC, SimClock, project_binding, command_validate, X-Ray adapters.
- **Tasks:** [phase-07-virtual-runtime.md](../development/phase-07-virtual-runtime.md).
- **Dependencies:** M03, M05, M06.
- **Integration:** Commands → Runtime → signals → Studio/OPC/Verify.
- **Testing:** `smoke_test_runtime`, water/tank transfer, xray, history.
- **Acceptance:** Pump start, fluid transfer indication, interlocks, E-stop sim all runtime-backed.
- **Limitations:** Not full hydraulic CFD; E-stop is simulation only (KI-017).

### 08 — Fault Injection and Commissioning

- **Required:** Inject process/IO faults; observe interlocks; commissioning evidence packages.
- **Preserve:** `/api/fault*`, Studio scenarios, stuck-valve X-Ray demo.
- **Tasks:** [phase-08-fault-injection.md](../development/phase-08-fault-injection.md).
- **Dependencies:** M07; M09 for verified fault scenarios.
- **Integration:** Faults affect Runtime IO image; Verify can assert post-fault behavior.
- **Testing:** X-Ray stuck-valve E2E; scenario injects in Studio.
- **Acceptance:** Engineer can inject at least pump/valve/level faults and see honest Runtime/X-Ray response.
- **Limitations:** Commissioning packet completeness varies; not plant safety certification.

### 09 — Automated Verification and FAT

- **Required:** Catalog of real FATs; arrange/act/assert against Runtime; evidence with modelVersion; PDF reports.
- **Preserve:** `fat_runner.js`, Verify workspace, `limits[]` honesty.
- **Tasks:** [phase-09-verification.md](../development/phase-09-verification.md).
- **Dependencies:** M07, M08; model testCases (M03).
- **Integration:** Same project/modelVersion as Studio/Runtime.
- **Testing:** `fat_estop` job; Verify E2E markers.
- **Acceptance:** ≥1 Water Transfer FAT green; Tank Transfer FAT when assertions exist; no fake pass rows.
- **Limitations:** Single FAT today (KI-015).

### 10 — Industrial Integrations

- **Required:** OPC UA exposure of P6 signals; optional MQTT; Ignition observe/export with engineer approval; never silent SoR overwrite.
- **Preserve:** `opcua_server`, `mqtt_publisher`, UDT generator, Perspective template mount, Compose `ignition` profile.
- **Tasks:** [phase-10-integrations.md](../development/phase-10-integrations.md).
- **Dependencies:** M03, M07; Gateway credentials (operator).
- **Integration:** Runtime signals → OPC → Ignition (optional); UDT proposals from approved model.
- **Testing:** `/api/connect/opcua|mqtt`; `smoke_ignition_udt.mjs`; live Ignition only when EULA+password set.
- **Acceptance:** Core works without Ignition; live tag path claimed only when proven (KI-019).
- **Limitations:** Ignition live blocked on EULA/admin password; LIVE_INTEGRATION off by default.

### 11 — Engineering Exports and Change Management

- **Required:** Save/reload; engineering package export; impact/change visibility; approval gates; traceability.
- **Preserve:** modelVersion, impact API, UDT export gate, versions/snapshots where real.
- **Tasks:** [phase-11-engineering-exports.md](../development/phase-11-engineering-exports.md).
- **Dependencies:** M03–M10 artifacts.
- **Integration:** Package references model revision + Verify evidence + Connect proposals.
- **Testing:** Project reload smoke; export download paths; impact API.
- **Acceptance:** MVP demo points 18–20: docs + save/reload + export package.
- **Limitations:** AB export placeholder; full change journal incomplete.

---

## Working rules (STEP 5)

See also [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md).

1. Complete one cohesive task at a time.  
2. Preserve existing working functionality.  
3. Avoid unnecessary architectural rewrites.  
4. Never replace real functionality with mock behavior.  
5. Maintain one authoritative engineering model.  
6. Keep industrial engineering terminology intuitive.  
7. All controls must perform meaningful actions.  
8. All simulation states must reflect runtime behavior.  
9. All generated engineering artifacts must be traceable.  
10. Run relevant tests before marking work complete.  
11. Do not silently invent engineering requirements.  
12. Require approval for safety-related decisions.  
13. Document unfinished capabilities accurately.  
14. Maintain compatibility with existing saved projects.  
15. Fix regressions before proceeding.  

---

## MVP definition (STEP 6) — 20 demo points

First complete demonstration must support (all through one engineering model):

1. Create a project.  
2. Import a real water-transfer P&ID.  
3. Identify tanks, pumps, valves, and instruments.  
4. Reconstruct an editable engineering diagram.  
5. Display professional industrial symbols.  
6. Configure equipment and process connections.  
7. Identify missing engineering requirements.  
8. Approve operating conditions.  
9. Generate preliminary control logic.  
10. Generate preliminary I/O mappings.  
11. Launch virtual simulation.  
12. Execute simulated pump controls.  
13. Calculate fluid transfer between tanks.  
14. Trigger configured process faults.  
15. Evaluate permissives and interlocks.  
16. Run automated verification tests.  
17. Record actual test results.  
18. Generate engineering documentation.  
19. Save and reload the project.  
20. Export an engineering package.  

**MVP gap map (honest):** Points 11–12, 14–17, 19 largely work for seeded demos. Points 2–5, 9–10, 13, 18, 20 are partial. Point 8 (approval UX) and full symbol professionalism remain open. Track in [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).

---

## Recommended implementation order

```text
M00 (done) → harden M03 + M01 gaps
  → M02 symbols (demo set)
  → M04 import honesty + review UX
  → M05 template matching (approve)
  → M06 preliminary logic/IO from model
  → M07 process transfer polish
  → M08 fault catalog
  → M09 additional FATs
  → M10 Ignition live prove-out (operator gated)
  → M11 engineering package + change evidence
```

Do not rebuild working Runtime/Connect paths — extend via the canonical model.

---

## Critical dependencies

| Dependency | Why |
|------------|-----|
| Canonical model (M03) | Hub for all surfaces |
| Runtime bind (M07) | Simulation + Verify truth |
| Engineer approval gates | Safety / Connect / promote |
| Compose `core` healthy | Local demo + regression |
| Ignition EULA + admin password | Only for claiming Connect live |
| Schema migrations | Saved project compatibility |

---

## Final principle

P6 Systems must reduce engineering work, not create more engineering administration. Do not substitute visual polish for functionality.
