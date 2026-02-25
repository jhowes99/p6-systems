# cn_gen_onefile — Single-File Control Narrative Generator

Single-file Python tool that turns logic/functional PDFs into a control narrative (Markdown, DOCX, CSVs, build artifacts, QA report).

## Install

```bash
pip install -r cn_gen_onefile_requirements.txt
```

Or:

```bash
pip install PyMuPDF pandas python-docx
```

## Run

From the repo root:

```bash
python cn_gen_onefile.py --logic inputs/777.pdf --template inputs/4208.pdf --out exports --project "My Project" --customer "My Customer"
```

- `--logic` — Logic/functional diagrams PDF (e.g. 777-style).
- `--template` — Optional narrative template PDF (e.g. 4208).
- `--out` — Output directory for narrative and CSVs (default: `exports`).
- `--project` — Project name.
- `--customer` — Customer name.

## Outputs

| Path | Description |
|------|-------------|
| `exports/control_narrative.md` | Markdown narrative |
| `exports/control_narrative.docx` | Word narrative with tables and appendix |
| `exports/tag_dictionary.csv` | Tags, pages, count |
| `exports/cause_effect.csv` | Cause/effect with SourcePage |
| `exports/alarms.csv` | Alarms extracted from logic |
| `exports/timers.csv` | Timer delays (ON/OFF DELAY + value + units) |
| `exports/setpoints.csv` | Scaffold (Setpoint/Tag, Unit, TBD at commissioning) |
| `exports/mode_behavior.csv` | Scaffold (Mode, Behavior, TODO) |
| `exports/qa_report.md` | QA report (PASS/FAIL) |
| `build/logic_pages.json` | Indexed pages (page_num, raw_text, blocks, title_guess) |
| `build/function_areas.json` | FunctionArea → page numbers |
| `build/tag_dictionary.json` | Tag → Pages, Count |
| `build/sequences.json` | Startup/normal/shutdown/trip/recovery per area |
| `build/assets/page_NNNN.png` | Rendered logic pages (~180 DPI) |

## QA

The script exits with **code 1** if:

- Safeguards (cause/effect table) are empty, or
- Any defined FunctionArea has no pages, or
- A generic fluff phrase is repeated more than 5 times.

Otherwise it exits 0 and prints "Done." plus the list of outputs.
