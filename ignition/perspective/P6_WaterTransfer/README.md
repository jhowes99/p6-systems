# P6 Water Transfer — Ignition Perspective Template

This pack is an **example Perspective project** that displays **live P6 Runtime values** via OPC UA (not hardcoded demo tags).

> Requires Ignition 8.3+ with Perspective module licensed/trial.  
> P6 core runs without Ignition; this is optional visualization.

## Architecture

```text
P6 Runtime (OPC UA server)
  opc.tcp://host.docker.internal:4840/UA/P6Systems
        ↓
Ignition OPC UA client connection "P6_Runtime"
        ↓
Perspective view "WaterTransfer/Main"
```

## 1. Start P6 with OPC UA

```bash
docker compose --profile core up --build
```

Confirm: http://localhost:3000/api/connect/opcua → `"running": true`

## 2. Start Ignition (optional profile)

```bash
# Set ACCEPT_IGNITION_EULA=Y and IGNITION_ADMIN_PASSWORD in .env first
docker compose --profile core --profile ignition up --build
```

Gateway: http://localhost:9088

## 3. Create OPC UA connection in Ignition

Designer or Gateway Config → OPC Connections → Create:

| Field | Value |
|-------|--------|
| Name | `P6_Runtime` |
| Type | OPC UA |
| Endpoint | `opc.tcp://host.docker.internal:4840/UA/P6Systems` (Docker Desktop) |
|  | or `opc.tcp://p6-app:4840/UA/P6Systems` (same compose network — advanced) |
| Security | None / Sign&Encrypt per your policy (dev often None) |

Browse namespace for nodes like:

`P6Systems/Projects/WaterTransferSystem/P101.RunningFeedback`

NodeIds use string form:

`ns=<n>;s=P6Systems/Projects/WaterTransferSystem/<SignalTag>`

## 4. Import this Perspective project

**Option A — copy into Gateway `data/projects`:**

1. Copy folder `P6_WaterTransfer` to Ignition data projects directory  
   (Docker volume: often under `/usr/local/bin/ignition/data/projects/`)
2. Gateway → Config → Projects → scan / restart project
3. Open Designer → project **P6_WaterTransfer**

**Option B — Designer import:**

1. Zip the `P6_WaterTransfer` directory
2. Designer → File → Import → select zip (or merge resources manually)

## 5. Bind tags

Views reference tags under `[P6]` provider paths documented in `tags/tag-paths.md`.

Create a Tag Provider or OPC tags that map:

| Perspective tag path | P6 OPC UA node (browse name) |
|----------------------|------------------------------|
| `[P6]WaterTransfer/P101/RunningFeedback` | `P101.RunningFeedback` |
| `[P6]WaterTransfer/M101/Energize` | `M101.Energize` |
| `[P6]WaterTransfer/XV101/OpenCommand` | `XV101.OpenCommand` |
| `[P6]WaterTransfer/XV101/OpenedFeedback` | `XV101.OpenedFeedback` |
| `[P6]WaterTransfer/ESTOP101/Healthy` | `ESTOP101.Healthy` |
| `[P6]WaterTransfer/LSH101/High` | `LSH101.High` |
| `[P6]WaterTransfer/TANK101/LevelPct` | `TANK101.LevelPct` |
| `[P6]WaterTransfer/System/Start` | `System.Start` |
| `[P6]WaterTransfer/System/Reset` | `System.Reset` |

Or use P6 Connect **Tag Map** UI (`/tags.html`) → Propose, then create matching Ignition OPC tags.

## 6. Prove live data

1. Open Perspective session → page `WaterTransfer/Main`
2. In P6: http://localhost:3000/simulation.html → **START TRANSFER**
3. Watch pump/motor indicators update in Perspective
4. **ACTIVATE E-STOP** in P6 → Perspective E-stop and motor status change

If values do not change, the view is not connected — fix OPC subscription, do not hardcode.

## Safety disclaimer

Perspective E-stop status reflects a **simulated** P6 input. It does **not** certify a physical safety function.

## Files

| Path | Purpose |
|------|---------|
| `project.json` | Project metadata |
| `com.inductiveautomation.perspective/session-props/props.json` | Session props |
| `com.inductiveautomation.perspective/views/WaterTransfer/Main/view.json` | Main HMI view |
| `tags/tag-paths.md` | Tag mapping cheat sheet |
| `opcua/connection.md` | Connection notes |
