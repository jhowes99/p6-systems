# P6 Connect — Ignition Integration

Ignition is **optional**. Core Runtime/Studio/Verify run without the `ignition` Compose profile.

Pinned Gateway image: `inductiveautomation/ignition:8.3.9` ([DOCKER.md](./DOCKER.md)).

---

## Modes

| Mode | Behavior |
|------|----------|
| SIMULATION (default) | P6 executes; Ignition may **observe** via OPC UA |
| EXTERNAL TEST | Gated |
| LIVE INTEGRATION | Off by default; never silent overwrite of P6 SoR |

---

## Live data path (proven)

```text
P6 Runtime signals
  → OPC UA server (ENABLE_OPCUA=1)
  → opc.tcp://…:4840/UA/P6Systems
  → Ignition OPC client (optional)
  → Perspective tags [P6]/…
```

Status: http://localhost:3000/api/connect/opcua  
Connect UI: http://localhost:3000/connect.html  

Perspective starter pack: `ignition/perspective/P6_WaterTransfer/` (not a substitute for Milestone C pump template).

MQTT (JSON, not Sparkplug): http://localhost:3000/api/connect/mqtt  

---

## Ignition Engineering Generator

**Purpose:** Convert **approved** P6 engineering models into reviewable Ignition-compatible artifacts. Engineer approval required before export/deploy.

### Milestone status

| Milestone | Capability | Status |
|-----------|------------|--------|
| A | UDT definitions + instances (pump first) | Implementing — `/api/connect/engineering/*` |
| B | Tag mapping editor + live verify | Partial — `/tags.html` propose/save |
| C | Perspective pump equipment view | Planned |
| — | Alarms / history **proposals** only | Planned |
| — | Controlled Gateway deploy | Planned — official APIs only |

### APIs (Milestone A)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/connect/engineering/status` | Target version, capability notes |
| POST | `/api/connect/engineering/udt/generate` | Build proposal from active project |
| GET | `/api/connect/engineering/udt` | Load stored proposal |
| POST | `/api/connect/engineering/udt/approve` | Mark engineer-approved |
| GET | `/api/connect/engineering/udt/export` | Download JSON package (approved or `?forcePreview=1`) |

Studio: http://localhost:3000/engineering.html  

### Rules

1. **Propose, never auto-deploy.**  
2. Reusable UDT types (`P6_Pump`) — one definition, many instances.  
3. Configurable naming + folder prefixes.  
4. Do not overwrite existing Ignition configs without explicit authorization.  
5. Never invent Gateway APIs; use documented Ignition 8.3 formats / APIs only.  
6. Alarms/history are **configuration proposals** — P6 does not replace Ignition alarm/historian products.  
7. P6 Verify remains the verification evidence system.

### Export package shape

```json
{
  "p6ArtifactType": "ignition.udt.package",
  "targetIgnitionVersion": "8.3.9",
  "reviewRequired": true,
  "approved": false,
  "udtTypes": [ /* Ignition-compatible UdtType JSON */ ],
  "udtInstances": [ /* instance tags + OPC bindings */ ],
  "validation": { "ok": true, "errors": [], "warnings": [] }
}
```

---

## Tag mapping (Milestone B foundation)

- UI: http://localhost:3000/tags.html  
- Persist: `server/data/canonical/tag_maps/<projectId>.json`  
- Default mode: `READ_ONLY` / `P6_TO_IGNITION`  
- Bidirectional requires `ALLOW_BIDIRECTIONAL_TAGS=1`

---

## Deploy (future)

When implemented: target Gateway/version ID → capability checks → preview → validate → duplicate/conflict handling → deployment approval → audit → rollback where supported. No speculative Gateway RPC.
