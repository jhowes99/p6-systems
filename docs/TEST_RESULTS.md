# Test Results

**Last updated:** 2026-10-12

## Regression harness

```bash
docker compose -f compose.yaml --profile core up --build -d p6-app
node scripts/regression_all.mjs
```

| Suite | Result |
|-------|--------|
| model | PASS |
| cem2 | PASS |
| runtime | PASS |
| water_transfer | PASS |
| tank_transfer | PASS |
| xray | PASS |
| history | PASS |
| fat_estop | PASS |
| ocr | PASS (incl. `tagOrigin` demo_reference) |
| ignition_udt | PASS |
| studio_e2e | PASS (**24/24**) |
| **Total** | **11/11 PASS** |

**Verified 2026-10-12 (post CEM D / write-validation):** `docker compose … up --build -d p6-app` then `regression_all.mjs` — **11/11 PASS**, studio_e2e **24/24**. Evidence: model-first X-Ray (`relationshipSource`, `derivedFrom`), impact `verifyCatalogRefs`, non-blocking `lastValidation` on writes.

**Ignition live attempt (same session):**

| Probe | Result |
|-------|--------|
| `GET /api/connect/opcua` | PASS — `running:true`, `nodeCount:23`, `opc.tcp://localhost:4840/UA/P6Systems` |
| `docker compose --profile ignition up -d ignition` | Container started (image 8.3.9) |
| Gateway logs | `needs_commissioning: eula` |
| `.env` | `ACCEPT_IGNITION_EULA=N`, `IGNITION_ADMIN_PASSWORD` empty |
| Ignition OPC client ↔ P6 tag read/write | **NOT PROVEN** |

See KI-019. Core regression remains independent of Ignition.

## Studio E2E highlights (Phases 2–8)

| Check | Result |
|-------|--------|
| §40 Tank Transfer demo | PASS |
| X-Ray Phase 1 payload + stuck-valve fault | PASS |
| Verify catalog + `limits[]` + FAT run | PASS |
| `/api/runtime/logic` observability | PASS |
| `verify.html` / `connect.html` UX markers | PASS |
| Ingest promote / interlocks / knownLimits | PASS |

## Honest limits

- E2E assumes p6-app reachable at `http://127.0.0.1:3000`; skips if down  
- Stale container images omit new fields — rebuild before claiming milestones  
- Simulated E-stop / faults — not certified physical safety  
- Verify still one automated FAT until Tank Transfer assertions are implemented  
