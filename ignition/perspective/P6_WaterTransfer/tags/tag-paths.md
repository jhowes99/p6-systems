# P6 → Perspective tag paths

Create an Ignition tag provider named **`P6`** (or rename bindings to match your provider).

All tags are **OPC → Ignition** (read-only from Perspective). Do not enable bidirectional writes unless Live Integration is explicitly enabled in P6.

## Mapping table

| Perspective tag path | P6 signal tag | OPC UA browse path (under project) |
|----------------------|---------------|-------------------------------------|
| `[P6]WaterTransfer/P101/RunningFeedback` | `P101.RunningFeedback` | `P6Systems/Projects/WaterTransferSystem/P101.RunningFeedback` |
| `[P6]WaterTransfer/M101/Energize` | `M101.Energize` | `…/M101.Energize` |
| `[P6]WaterTransfer/XV101/OpenCommand` | `XV101.OpenCommand` | `…/XV101.OpenCommand` |
| `[P6]WaterTransfer/XV101/OpenedFeedback` | `XV101.OpenedFeedback` | `…/XV101.OpenedFeedback` |
| `[P6]WaterTransfer/ESTOP101/Healthy` | `ESTOP101.Healthy` | `…/ESTOP101.Healthy` |
| `[P6]WaterTransfer/LSH101/High` | `LSH101.High` | `…/LSH101.High` |
| `[P6]WaterTransfer/TANK101/LevelPct` | `TANK101.LevelPct` | `…/TANK101.LevelPct` |
| `[P6]WaterTransfer/System/Start` | `System.Start` | `…/System.Start` |
| `[P6]WaterTransfer/System/Reset` | `System.Reset` | `…/System.Reset` |

## How to create tags in Designer

1. OPC Connections → browse `P6_Runtime`
2. Drag nodes into Tag Browser under provider `P6` / folder `WaterTransfer`
3. Or use P6 Studio **Tags** page (`/tags.html`) → Propose map → recreate paths in Ignition

## Prove live

Drive P6 Simulation (`/simulation.html`). If Perspective LEDs do not change when P6 does, the binding is wrong — fix OPC/tags, do not hardcode values in the view.
