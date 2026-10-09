# Test Results

**Last updated:** 2026-10-09

## Regression harness

```bash
node scripts/regression_all.mjs
```

| Suite | Result |
|-------|--------|
| model | PASS |
| runtime | PASS |
| water_transfer | PASS |
| tank_transfer | PASS |
| xray | PASS |
| history | PASS |
| fat_estop | PASS |
| ocr | PASS |
| ignition_udt | PASS |
| studio_e2e | PASS (20/20) |
| **Total** | **10/10 PASS** |

## Studio E2E highlights

| Check | Result |
|-------|--------|
| §40 Tank Transfer demo | PASS |
| Canvas / layout / tank props | PASS |
| Valve open → Start / permissives / E-stop / X-Ray | PASS |
| History frames + speed API | PASS |
| Lock + connection waypoints | PASS |
| Ingest promote → canvas + Runtime rebind | PASS |
| Delete equipment → canvas clear + rebind | PASS |
| Platform knownLimits (readiness) | PASS |
| Core pages 200 | PASS |

## Honest limits

- No Playwright canvas FPS suite  
- History playback overlays recorded signals (not physics rewind)  
- Ignition live path not proven in this harness  
