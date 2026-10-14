# AGENTS.md — P6 Systems Platform

Enduring rules for every development session. Read this file and `docs/BUILD_STATUS.md` before changing code.

## Product

**P6 Systems** — Industrial Engineering, Simulation and Virtual Commissioning Platform.

| Product surface | Role |
|-----------------|------|
| **P6 Studio** | Engineering workspace (browser UI) |
| **P6 Runtime** | Virtual execution and simulation |
| **P6 Connect** | Industrial connectivity (Ignition optional) |
| **P6 Verify** | Automated testing and commissioning |

**Customer-facing UI and docs must say P6 Systems** (Verify surface: **P6 Verify**). Logos: `web/logo.png` (Systems), `web/logo-verify.png` (Verify). Legacy compose filenames / GitHub origin may still mention Ironclad/`axiom_runtime` until cleaned up.

Upstream origin: `https://github.com/jhowes99/Ironclad_Runtime.git`

## Non-negotiable rules

1. **Inspect before rewriting.** Prefer reuse of `server/plc/*`, Express APIs, and existing Docker patterns.  
2. **No fake functionality.** Buttons must drive real runtime/API behavior or be labeled unfinished.  
3. **No unnecessary architecture.** No Kubernetes, multi-DB, or event meshes unless an implemented capability requires them.  
4. **Ignition is optional.** Core must start without the `ignition` profile. Never claim Ignition works without proven live data flow.  
5. **P6 model is system of record.** Ignition must not silently overwrite approved P6 engineering data.  
6. **Safety honesty.** Simulated E-stop demonstrates model behavior only — never represent it as a certified physical safety function.  
7. **No secrets in git.** Use `.env.example`. Do not commit credentials.  
8. **No direct pushes to `main`.** Use feature branches and PRs.  
9. **Do not mark features complete from generated code alone.** Update `docs/BUILD_STATUS.md`, `docs/KNOWN_ISSUES.md`, `docs/TEST_RESULTS.md`.  
10. **Schema changes need migrations** once the canonical model is introduced.

## Product topology

Logical architecture (Studio → Model → Runtime/Verify → Connect) is defined in `docs/PRODUCT_ARCHITECTURE.md`. That diagram is the product north star; container splits follow ADR-001 only when justified.

## Current architecture (MVP)

- **Monolith container `p6-app`:** Studio static UI + Backend API + Runtime + Document Processing.  
- **Persistence:** volume on `server/data` (JSON). SQL deferred to Phase 2+.  
- **Optional:** Ignition Gateway via Compose profile `ignition` (image pin documented in `docs/DOCKER.md`).  
- **Hub of the platform:** Canonical P6 Model — all Studio tools write through it; Runtime and Verify execute against it; Connect exports/observes it.

## Development order

**Authority (supersedes prior plans):** User-fed *MASTER PLATFORM BUILD SPECIFICATION* (§1–§45).  
Audit / ledger: `docs/PLATFORM_AUDIT.md` · status: `docs/BUILD_STATUS.md`.

Phases (§41): 1 Foundation → 2 Interactive Studio → 3 Runtime → 4 X-Ray → 5 Verify → 6 Connect → 7 Expansion.

**Active priority:** Universal shell + §40 two-tank interactive workflow (visual feedback required). Preserve landing page. Do not rebuild working Runtime/Connect paths — extend via the canonical model.

### Addendum rules

- Engineer approval before Ignition export/deploy; never silent overwrite.
- Simulation templates share the same equipment/signal schema — no parallel models.
- UDT/tag/Perspective outputs must bind to real P6 signals / OPC UA — no mock-as-done.
- Update `docs/BUILD_STATUS.md`, `docs/TEST_RESULTS.md`, and Ignition docs when proving a milestone.

## Session start

1. Read `AGENTS.md`  
2. Read `docs/BUILD_STATUS.md`  
3. `git status` / branch check  
4. Identify incomplete tasks; continue from next verified step  

## Session end

1. Run relevant tests / health checks  
2. Update BUILD_STATUS, KNOWN_ISSUES, TEST_RESULTS  
3. Summarize changes and state the next actionable task  

## Key docs

| Doc | Purpose |
|-----|---------|
| `docs/ARCHITECTURE_AUDIT.md` | Honest capability classification |
| `docs/BUILD_PROGRESS.md` | Current rebuild phase / tests |
| `docs/WORKSPACE_IMPLEMENTATION_PLAN.md` | Studio rebuild phases 0–9 |
| `docs/DEVELOPMENT_ROADMAP.md` | Phases + Addendum milestones A–F |
| `docs/ENGINEERING_DATA_MODEL.md` | Shared SoR / adapter rules |
| `docs/IGNITION_INTEGRATION.md` | Connect, UDT generator, deploy rules |
| `docs/BUILD_LIST.md` | Clickable Studio / API inventory |
| `docs/EXISTING_ARCHITECTURE.md` | What the inherited code actually does |
| `docs/GAP_ANALYSIS.md` | Spec vs reality classifications |
| `docs/IMPLEMENTATION_PLAN.md` | Phase roadmap |
| `docs/ARCHITECTURE_DECISIONS.md` | ADRs |
| `docs/DOCKER.md` | Compose profiles and commands |
| `docs/BUILD_STATUS.md` | Current phase status |
| `PRODUCT_CONSTRAINTS.md` | Legacy product boundaries (evolve carefully toward P6 scope) |
