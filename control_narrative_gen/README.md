# Control Narrative Generator

Generates **control narratives** (Markdown, DOCX, optional PDF), **tag dictionary**, **cause-effect** table, and **diagram exports** from:

- **Logic/functional diagrams** — Logic / Functional Logic Diagrams (PDF, multi-sheet)
- **Narrative template** — Control Narrative output example/template (PDF, optional)

Output structure follows the narrative template: Document Control, Introduction, Reference Documents, Instrumentation, Functional Description, Sequence, Safeguarding, Set Points, Diagrams.

---

## Setup

```bash
cd control_narrative_gen
pip install -r requirements.txt
```

**PDF output:** Requires `reportlab` (included in `requirements.txt`). When the server runs the generator, it will use a venv here if present: create one with `python -m venv .venv`, then `.venv\Scripts\pip install -r requirements.txt` (Windows) or `.venv/bin/pip install -r requirements.txt` (Unix). That way PDF is generated when you use the web “Generate control narrative” flow.

## Inputs

Place PDFs in `./inputs/`:

- `./inputs/logic_diagrams.pdf` — Logic diagrams (Steam Pressure, Fuel Gas, Oxygen Trim, Furnace Pressure, Drum Level, etc.)
- `./inputs/template.pdf` — Narrative template (example control narrative used for target structure)

## Run

From the **project root** (`control_narrative_gen`):

```bash
python scripts/generate.py --logic inputs/logic_diagrams.pdf --template inputs/template.pdf --out exports --project "Combustion Control System, Fully Metered" --customer "TotalEnergies Port Arthur, TX."
```

Default `--project` and `--customer` are as above; override as needed.

## Outputs (in `./exports/`)

| File / Folder | Description |
|---------------|-------------|
| `control_narrative.md` | Full narrative in Markdown (customer-facing) |
| `control_narrative.docx` | Word document with headings, tables, appendix |
| `control_narrative.pdf` | Optional; generated if reportlab works without errors |
| `tag_dictionary.csv` | All tags/signals, grouped by loop/page |
| `cause_effect.csv` | Cause→effect (trips, alarms, interlocks, commands) |
| `diagrams/` | One PNG per page of logic diagrams for appendix references |

---

## Narrative structure (narrative template)

Sections are fixed to:

1. Document Control & Administration  
2. Introduction and Scope  
3. Reference Documents  
4. Instrumentation and Monitoring  
5. Functional and Control Description  
6. Sequence Description (Operating Modes)  
7. Instrument Safeguarding Functions  
8. Operating Set Points and Determination  
9. Diagrams and Attachments  

For each **functional area** detected in the logic diagrams (Steam Pressure, Fuel Gas, Oxygen Trim, Furnace Pressure, Drum Level, FGR/Damper, etc.), the tool generates:

- **Purpose** — What it controls and why  
- **Key inputs** — PV, SP, mode selects, BMS permissives, bad-quality flags  
- **Key outputs** — Valve/damper commands, demand signals, permissives  
- **Modes** — Auto/Manual/Track/Standby  
- **Bad quality / fail-safe** — PV bad, analyzer bad, etc.  
- **Alarms, interlocks, trips** — With timing when present  
- **Operator notes** — Startup/shutdown when present in 777  

Source page numbers from the logic diagrams are cited in each section.

---

## Cause-effect table (`cause_effect.csv`)

Columns: `FunctionArea`, `CauseSignal`, `Condition/Threshold`, `TimerDelay`, `EffectSignal`, `EffectDescription`, `SourcePage`.

Populated by scanning for: Trip, Alarm (AL), permissive, “To BMS”, “Release to modulate”, Purge, Burner firing, bad quality, deviation, etc. Where exact wiring is not machine-readable, the table is best-effort from nearby text and page references.

---

## Tag dictionary (`tag_dictionary.csv`)

Columns: `LoopPage`, `Tag`, `Description`, `SourcePage`.

Tags are extracted with regex heuristics (e.g. `63PC4102`, `MasterDemand`, `BmsRelToMod`). Description is left blank for later enrichment.

---

## PDF export

- **Included** when `reportlab` is installed and generation succeeds.
- **Skipped** if reportlab is missing or fails; the CLI reports why and you can rely on DOCX/MD.
- The PDF is a plain text flow of the narrative, not a full layout match to the DOCX.

---

## Reusing for other logic/functional diagram PDFs

1. Put your logic PDF in `inputs/` (e.g. `inputs/logic_diagrams.pdf`).
2. Optionally put a narrative template PDF in `inputs/` (e.g. `inputs/template.pdf`); section order follows the narrative template when provided, and content is driven by the logic PDF.
3. Run the same CLI with your `--project` and `--customer`.
4. Customize functional-area detection in `cn_gen/parser.py` (`FUNCTIONAL_AREA_PATTERNS`) if your titles differ.
5. Adjust tag regex in `cn_gen/parser.py` (`TAG_PATTERN`) if your tag naming differs.

---

## Project layout

```
control_narrative_gen/
├── cn_gen/           # Package
│   ├── __init__.py
│   ├── parser.py     # PDF parse (logic diagrams, narrative template), PNG export
│   ├── extractors.py # Tag dictionary, cause-effect
│   ├── narrative.py  # Section layout, narrative text per area
│   ├── export_docx.py
│   ├── export_pdf.py
│   └── runner.py     # Orchestrates full pipeline
├── scripts/
│   └── generate.py  # CLI
├── inputs/          # Place logic_diagrams.pdf, template.pdf here
├── exports/         # Created by run
├── requirements.txt
└── README.md
```

---

## Definition of Done

- [x] CLI creates all outputs without manual editing.  
- [x] Narrative includes sections for every detected functional area.  
- [x] Each section cites source page numbers from the logic diagrams.
- [x] Tag dictionary and cause-effect CSVs are generated and non-empty when the logic PDF has content.
- [x] README explains workflow and how to reuse for future logic/functional diagram PDFs.
