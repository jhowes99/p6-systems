# P6 Systems — Getting Started

First-time handoff for exploring the platform. For build phase detail and honesty status, see [BUILD_STATUS.md](./BUILD_STATUS.md).

## What it is

**P6 Systems** is an Industrial Engineering, Simulation and Virtual Commissioning Platform.

| Surface | Role |
|---------|------|
| **P6 Studio** | Browser engineering workspace (design, import, simulate, verify) |
| **P6 Runtime** | Virtual PLC + process/equipment simulation |
| **P6 Connect** | Industrial connectivity (OPC UA; Ignition optional) |
| **P6 Verify** | Automated tests / FAT against the runtime model |

The **canonical P6 model** is the system of record. Studio tools write through it; Runtime and Verify execute against it; Connect exports or observes it. Logical layout: [PRODUCT_ARCHITECTURE.md](./PRODUCT_ARCHITECTURE.md).

## How to start

**Recommended (Docker core):**

```bash
docker compose --profile core up --build
```

Open Studio: [http://localhost:3000](http://localhost:3000) (demo shortcut: [studio.html?demo=1](http://localhost:3000/studio.html?demo=1)).

- Core does **not** require Ignition.
- If UI/JS looks stale after a rebuild, hard-refresh: **Ctrl+Shift+R**.
- More profiles and ports: [DOCKER.md](./DOCKER.md).

## Demo vs Project

Studio has a **Demo | Project** toggle (`plantMode`) near the Simulate controls.

| Mode | Purpose |
|------|---------|
| **Demo** | Polished sample plant (tank / water transfer). Leave it as the default exploration experience — full sample valve/pump controls. |
| **Project** | Your imported / real engineering. After import and promote, switch here so Simulate commands **your** equipment tags (valves, pumps) via the generic engineering plant — not the demo ladder. |

- Demo stays available anytime; it does not overwrite your project.
- After a successful import → promote, Studio switches to **Project** so Simulate drives the imported model.
- If you click Project with nothing imported yet, Studio keeps Demo and tells you to import first.

## Typical first workflow

1. Open Studio (or `?demo=1`).
2. Stay on **Demo** → **Simulate**: try Clear LSH / open valve / START and watch canvas + runtime feedback.
3. **Design → Import** engineering (P&ID / docs), review candidates, **promote** into the model.
4. Confirm mode is **Project** (or toggle it).
5. **Simulate** again: open a valve / START on the imported equipment — Runtime binds the engineering plant to those tags.

## What each area does

| Area | What you use it for |
|------|---------------------|
| **Studio (Design / Engineer)** | Place equipment, edit the model, I/O and logic panels, Project menu (New / Import / Open / Save). |
| **Simulate / Runtime** | Bind the active project, run virtual scan, command tags, watch live graphics and process state. |
| **Vision / Import** | Ingest PDF/text/CSV/SVG → review → promote. Image OCR for scanned P&IDs is unfinished. |
| **X-Ray** | Diagnostics: health, signal trace, interlock/connection walks against live runtime. |
| **Verify** | Run catalog FAT / regression against Runtime (some cases may be BLOCKED until assertions exist). |
| **Connect / Ignition** | Optional. Core runs without it. Live Ignition tag path is **not proven** — see BUILD_STATUS (EULA/credentials blocked). |

## Honesty rules

- No fake buttons: controls drive real API/runtime behavior, or are labeled unfinished.
- Simulated E-stop / ESD is **model behavior only** — not a certified physical safety function.
- P6 model is system of record; Ignition must not silently overwrite approved engineering data.
- Do not treat incomplete features as done — trust [BUILD_STATUS.md](./BUILD_STATUS.md) and [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

## Where to go deeper

| Doc | Why |
|-----|-----|
| [BUILD_STATUS.md](./BUILD_STATUS.md) | What is shipped vs open |
| [PRODUCT_ARCHITECTURE.md](./PRODUCT_ARCHITECTURE.md) | Product topology |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current implementation topology |
| [DOCKER.md](./DOCKER.md) | Compose profiles and commands |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | Known gaps and blockers |
