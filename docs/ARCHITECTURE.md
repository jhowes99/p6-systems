# P6 Systems — Implemented Architecture

**Describes the system as it exists**, not a future ideal. Updated as phases land.  
Companion audit: [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md).

---

## Topology

```text
Browser (static web/)
    │  HTTP (+ future WS)
    ▼
p6-app (Express monolith)
    ├── Static UI (landing, Studio shell, legacy pages)
    ├── Canonical model API  → server/data/canonical/
    ├── VirtualPLC Runtime   → ladder + equipmentStep + SimClock
    ├── P6 Verify            → FAT runner + PDF
    ├── Document / OCR       → pid_parser, ocr_ingest
    └── P6 Connect           → OPC UA, MQTT, UDT export
         │
         ├── Mosquitto (compose core)
         └── Ignition Gateway (optional profile)
```

Logical products share **one canonical project** (equipment, signals, interlocks, tests). Runtime binds that project; Verify asserts against it; Connect exports/observes it.

---

## Persistence

- File JSON SoR (`schemaVersion` 1). SQL deferred.  
- Docker volume `p6_app_data` → `/app/server/data`.  
- Runtime signal values synced through project binding; not a second database.

---

## Frontend

| Surface | Role |
|---------|------|
| `landing.html` | Marketing — **preserve visual direction** |
| `studio.html` | Unified engineering workspace (Phases 1–8) |
| Legacy pages | `simulation.html`, `verify.html`, `ingest.html`, etc. remain callable from Studio |

No bundler. Vanilla JS. State sync: HTTP poll (~600 ms). Layout: `project.ui.graph` via `PATCH /api/model/projects/:id/graph`. Commands: `POST /api/runtime/command` with permissive validation.

---

## Runtime authority

Browser issues commands → Express validates → VirtualPLC updates → APIs return confirmed state. UI must not invent success.

Simulated E-stop = model behavior only (not SIL certification).

---

## Compose profiles

| Profile | Services |
|---------|----------|
| `core` | `p6-app` + Mosquitto |
| `ignition` | Official Ignition 8.3.9 |
| `integration-test` | curl smoke |

---

## Known architectural limits (honest)

- Not a React SPA; graph editor is evolving from `/api/runtime/canvas`.  
- No WebSocket yet.  
- Process physics beyond discrete equipment models is limited.  
- Ignition Perspective live prove-out requires licensed Gateway + operator import.  
