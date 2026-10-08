# P6 Runtime (Phase 3 MVP)

Deterministic virtual execution. Wall-clock only schedules scans when mode is `running`; **simulation time** drives timers and evidence.

## Modes

| Mode | Behavior |
|------|----------|
| `running` | Interval fires scans; sim clock advances each scan |
| `paused` | No automatic scans; sim time frozen |
| `stopped` | Interval cleared |

## Actions

| Action | API |
|--------|-----|
| START | `POST /api/runtime/start` or `/api/plc/start` |
| STOP | `POST /api/runtime/stop` |
| PAUSE | `POST /api/runtime/pause` |
| RESUME | `POST /api/runtime/resume` |
| STEP | `POST /api/runtime/step` (one scan) |
| RESET | `POST /api/runtime/reset` (sim clock + timers + bound signal initials) |
| CHANGE INPUT | `POST /api/runtime/signal` `{ tag, value }` |
| OVERRIDE | `POST /api/runtime/signal` `{ tag, value, override: true }` |
| VIEW SIGNALS | `GET /api/runtime/signals` |
| VIEW EVENTS | `GET /api/runtime/events` |
| STATUS | `GET /api/runtime/status` |

## Scan phases (per cycle)

1. **Input image** — I/O with faults applied  
2. **Control logic** — ladder IR evaluation (TON uses sim accrual, not `Date.now`)  
3. **Equipment step** — hook for Phase 4 process models (`plc.equipmentStep`)  
4. **Sim clock tick** — `timeMs += scanMs`  
5. **Signal sync** — bound canonical signals updated in memory  

## Project binding

On startup (with Water Transfer seed), signals with `address` fields are declared on the IO image and initials applied.

- `POST /api/runtime/bind` `{ projectId? }` — rebind active or given project  
- Live values are **not** written to disk every scan  
- `POST /api/runtime/persist-signals` — explicit persist of live values into the canonical model  

## Honest limits (Phase 3)

- Water Transfer **equipment behavior** (valve/motor/pump state machines) is not implemented — that is Phase 4 (`equipmentStep`).  
- Bound signals reflect IO image + overrides only.  
- Browser is not the source of execution truth.
