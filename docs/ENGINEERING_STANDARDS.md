# P6 Systems — Engineering Standards

**Last updated:** 2026-10-13  
**Authority:** [MASTER_DEVELOPMENT_PLAN.md](./MASTER_DEVELOPMENT_PLAN.md) · [AGENTS.md](../AGENTS.md)

Standards for product behavior, documentation honesty, and engineer oversight. Apply to every milestone.

---

## Core philosophy

**AUTOMATE THE WORK. ENGINEER THE DECISIONS.**

P6 Systems automates repetitive controls engineering while preserving human judgment for safety, approvals, and vendor deployment.

---

## Working rules (STEP 5)

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

## Industrial terminology

Prefer terms engineers already use. Avoid inventing parallel vocabularies.

| Prefer | Avoid / clarify |
|--------|-----------------|
| P&ID, equipment tag, instrument tag | Generic “widget” / “node” in customer UI |
| Signal, I/O point, interlock, permissive | Vague “rule” without engineering meaning |
| FAT, commissioning, cause & effect | “Unit test” alone for plant verification |
| E-stop (simulated) | Implying certified SIL / physical safety |
| ENGINEER_APPROVED / EXTRACTED_FACT | Silent “done” without classification |
| Virtual PLC / scan cycle | Browser timers as execution truth |

Customer-facing product names: **P6 Systems**, **P6 Studio**, **P6 Runtime**, **P6 Verify**, **P6 Connect**.

---

## Safety honesty

- Simulated E-stop, faults, and interlocks demonstrate **model / Runtime behavior only**.  
- Never represent simulation as a certified physical safety function (SIL, hardwired E-stop, etc.).  
- Surface sim disclaimers in Studio / X-Ray / Verify when safety-related results are shown.  
- Safety-related promotions and Connect deploy require **engineer approval** (rule 12).

---

## Model as system of record

- Canonical project under `server/data/canonical/` is the SoR for engineering data.  
- Ignition / OPC / MQTT are optional consumers — they must not silently overwrite approved P6 data.  
- Data classification: `EXTRACTED_FACT` | `ENGINEERING_INFERENCE` | `ENGINEER_APPROVED`.  
- Uncertain extractionsions must not be silently promoted — use explicit approve/promote paths.  
- Schema changes require migrations (`server/model/migrate.js`); preserve saved projects (rule 14).

---

## Approval gates

| Action | Gate |
|--------|------|
| OCR / import promote into model | Engineer review; classified as inference until approved |
| Safety interlock / permissive changes | Explicit approval; no silent invent |
| Ignition UDT / tag / Perspective export | Propose → approve → export; no auto-deploy |
| Live plant integration (`P6_LIVE_INTEGRATION`) | Off by default; explicit enable + authorization |
| Marking milestone / task complete | Tests + evidence; never from generated UI alone |

---

## No mock-as-done

- Buttons and menus must drive real Runtime/API behavior **or** be labeled unfinished.  
- Do not invent FAT pass/fail rows, live Ignition tags, or vendor PLC packages.  
- Placeholders (e.g. Allen-Bradley export) must remain clearly labeled until validated.  
- `/api/readiness` `knownLimits` and [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) must stay accurate.  
- Checkbox `[x]` in `development/phase-*.md` only when implemented **and** verified.

---

## Traceability

Generated logic, I/O maps, Verify evidence, and Connect proposals must reference:

- Project id  
- `modelVersion` (and schema version where relevant)  
- Source entities (equipment, signals, interlocks, documents)  

Impact analysis (`GET /api/model/projects/:id/impact`) is the preferred dependency view — do not invent unrelated FATs.

---

## Simulation fidelity

- UI state must reflect Runtime / VirtualPLC confirmed values (HTTP poll or future stream).  
- History playback that only overlays recorded signals must be labeled (not “physics rewind”).  
- Command rejects must surface permissive / interlock reasons from the server when available.

---

## Documentation discipline

After each completed task:

1. Update the relevant `development/phase-*.md` checkboxes.  
2. Update [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).  
3. Append evidence to [TEST_RESULTS.md](./TEST_RESULTS.md).  
4. Add or close items in [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).  
5. Brief note in [BUILD_STATUS.md](./BUILD_STATUS.md) when delivering a slice.  

Do not wipe historical test or issue records.

---

## Related AGENTS.md non-negotiables

Inspect before rewriting · No fake functionality · No unnecessary architecture · Ignition optional · P6 model SoR · No secrets in git · Feature branches / PRs · Schema migrations when needed.
