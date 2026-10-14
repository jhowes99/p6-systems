# Test Results

**Last updated:** 2026-10-13 (implementation verification session)  
**Branch:** `p6/phase0-phase1-foundation`  
**Environment:** `docker compose -f compose.yaml --profile core up --build -d p6-app` then host `node` smokes against `http://127.0.0.1:3000`

## Regression harness (executed)

```bash
docker compose -f compose.yaml --profile core up --build -d p6-app
node scripts/regression_all.mjs
```

| Suite | Result |
|-------|--------|
| model | PASS |
| cem2 | PASS |
| engineer | PASS |
| runtime | PASS |
| water_transfer | PASS (incl. massBalance / levelTransfer) |
| tank_transfer | PASS |
| xray | PASS |
| history | PASS |
| fat_estop | PASS |
| verify_phase6 | PASS (6 executable FAT pass, 1 BLOCKED honest) |
| ocr | PASS |
| ignition_udt | PASS |
| studio_e2e | PASS (**32/32**) |
| **Total** | **13/13 PASS** |

## Ad-hoc workflow smoke (executed this session)

API workflow against live `p6-app`:

| Check | Result |
|-------|--------|
| Create project + add/edit equipment + graph PATCH persist + reopen | PASS |
| Engineer `POST /api/engineer/.../templates/apply` | PASS |
| Water Transfer bind + Clear LSH + System.Start energize | PASS |
| Mass balance (API polls) | PASS — `TANK101` 65→64.10, `TANK102` 15→15.90, `FT101.FlowGpm`≈1676 (demo-accelerated, calculated) |
| Canvas nodes live-bound to engineering tags | PASS |
| FAT `P101_ESTOP_SHUTDOWN` via `/api/verify/run` | PASS (4 assertions) |
| Ingest promote path | PASS |

## Studio E2E highlights (32/32)

| Check | Result |
|-------|--------|
| §40 Tank Transfer demo | PASS |
| Four-workspace shell (Design / Engineer / Simulate / Verify) | PASS |
| Symbol registry + pid/scada mode markers | PASS |
| Water Transfer Phase 2 diagram + ports | PASS |
| Water Transfer bind+start + process physics + fault injection | PASS |
| FAT catalog limits + run | PASS |
| Vision/OCR ingest pipeline + promote | PASS |
| Vision: source refs, connection include/skip, gaps, wizard markers | PASS (`smoke_ocr` + e2e this session) |

## Honest limits

- E2E assumes p6-app reachable at `http://127.0.0.1:3000`; skips if down  
- Stale container images omit new routes — rebuild before claiming milestones  
- `/api/readiness` `readyForDemo=false` while active plant IR is `tank_transfer` (`water_transfer_ir` check fails by design)  
- Simulated E-stop / faults — not certified physical safety  
- `P101_MOTOR_FAULT_ALARM` remains **BLOCKED** (no Runtime fault/alarm path yet)  
- Ignition live tag bind still **not proven** (KI-019)  
- Control-sequence authoring UI unfinished (KI-023)  
- Scanned image OCR unfinished (KI-003) — prefer text/PDF/SVG/CSV; Manual reconstruct path available  
