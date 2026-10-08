# Test Results

**Last updated:** 2026-10-08

## Regression harness

```bash
node scripts/regression_all.mjs
```

| Suite | Result |
|-------|--------|
| model | PASS |
| runtime | PASS |
| water_transfer | PASS |
| fat_estop | PASS |
| ocr | PASS |
| ignition_udt (Milestone A) | PASS |
| **Total** | **6/6 PASS** |

## Milestone A — Ignition UDT

| Check | Result |
|-------|--------|
| `P6_Pump` UdtType structurally valid | PASS |
| `P101` instance bound to `P101.RunningFeedback` + OPC NodeId | PASS |
| Target version pin `8.3.9` | PASS |
| Approval gate (export without approve → 403 unless forcePreview) | Implemented |
| Gateway Designer import of JSON | NOT RUN (operator / licensed Ignition) |

## Connect / OPC UA / MQTT

| Check | Result |
|-------|--------|
| OPC UA running, 11 nodes | PASS (Docker) |
| MQTT enabled + connected + publishing | PASS (Docker) |

## Known honest limits

- Milestone B–F not complete  
- Perspective pump faceplate (Milestone C) not yet generated from UDT package  
- Simulation templates (Milestone D) not started  
- Gateway controlled deploy APIs not implemented (download-only)  
- Git commit/PR of full source still pending when requested  
