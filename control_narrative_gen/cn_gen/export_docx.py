"""
Export control narrative to DOCX in Enterprise format (match Control_Narrative_Enterprise.pdf).
"""
from pathlib import Path
from typing import Optional
from .narrative import (
    _clean_title_for_appendix,
    _enterprise_purpose_default,
    _enterprise_audience_default,
    narrative_for_loop,
    group_pages_by_function,
)
from .parser import PageContent


def _add_table(doc, rows: list[dict], cols: list[str], max_rows: int = 80) -> None:
    if not rows:
        doc.add_paragraph("(none)")
        return
    table = doc.add_table(rows=1 + min(len(rows), max_rows), cols=len(cols))
    table.style = "Table Grid"
    hdr = table.rows[0].cells
    for j, c in enumerate(cols):
        hdr[j].text = c
    for i, r in enumerate(rows[:max_rows]):
        row = table.rows[i + 1].cells
        for j, c in enumerate(cols):
            row[j].text = str(r.get(c, ""))[:200]
    doc.add_paragraph()


def export_docx(
    md_content: str,
    tag_rows: list[dict],
    cause_effect_rows: list[dict],
    diagrams_dir: str,
    out_path: str,
    project: str,
    customer: str,
    pages: list[PageContent],
    setpoint_rows: Optional[list[dict]] = None,
    author: str = "Author",
    organization: str = "[Your Company Name]",
    system_name: str = "",
    purpose: str = "",
    audience: str = "",
) -> None:
    try:
        from docx import Document
        from docx.shared import Inches
    except ImportError:
        raise RuntimeError("python-docx required. pip install python-docx")

    doc = Document()
    sys_name = system_name or project
    purpose_text = purpose or _enterprise_purpose_default(project, customer)
    audience_text = audience or _enterprise_audience_default()
    setpoint_rows = setpoint_rows or []

    # ---------- Enterprise title block ----------
    doc.add_heading("CONTROL NARRATIVE", level=0)
    doc.add_paragraph(sys_name)
    doc.add_paragraph(f"Author: {author}")
    doc.add_paragraph(f"Organization: {organization}")
    doc.add_paragraph(f"Project: {project}")
    doc.add_paragraph("Purpose")
    doc.add_paragraph(purpose_text)
    doc.add_paragraph("Audience")
    doc.add_paragraph(audience_text)

    doc.add_heading("Revision History", level=1)
    rev = [{"Revision": "0.1", "Date": "(generated)", "Author": author, "Description": "Initial release"}]
    _add_table(doc, rev, ["Revision", "Date", "Author", "Description"], max_rows=10)

    # ---------- Sections 1–15 (Enterprise) ----------
    doc.add_heading("1. System Overview", level=1)
    doc.add_paragraph("This control narrative describes the control philosophy, operating modes, sequences, and safeguarding functions based on the provided control logic diagrams. The system is organized into functional areas derived from the logic sheet titles and content.")

    doc.add_heading("2. Architecture Summary", level=1)
    doc.add_paragraph("Logic source: provided logic PDF. Control behavior is defined by the logic diagrams; instrumentation and tags are listed in the appendices.")

    doc.add_heading("3. Operating Modes", level=1)
    for line in ["Ready – System healthy, idle.", "Auto – Automatic sequencing and control per logic.", "Manual – Operator directly controls setpoints and outputs.", "Maintenance – Interlocks active; automatic sequences inhibited.", "Fault – Entered on critical alarm; outputs driven to safe state."]:
        doc.add_paragraph(line, style="List Bullet")

    doc.add_heading("4. State Model", level=1)
    doc.add_paragraph("Power-Up → Initializing → Ready → (Auto | Manual | Maintenance) → Fault → Ready")

    doc.add_heading("5. Startup Sequence", level=1)
    doc.add_paragraph("1. Verify prerequisites and permissives.")
    doc.add_paragraph("2. Place loop in AUTO when stable; confirm bumpless transfer.")

    doc.add_heading("6. Normal Operation", level=1)
    doc.add_paragraph("In normal operation the system regulates per configured mode. Operator may place the loop in MANUAL for maintenance or abnormal conditions, and return to AUTO when stable.")

    doc.add_heading("7. Interlocks & Permissives", level=1)
    doc.add_paragraph(
        "All control actions require permissives and interlocks as defined in the Cause & Effect matrix below. "
        "Motion/process interlocks force safe states when conditions are not met. "
        "The full matrix is reproduced in Appendix E; raw extracted data from the logic diagrams is in Appendix F for traceability."
    )
    ce_matrix = [
        {"Cause (Event)": "E-Stop Active", "Effect (System Response)": "All fuel valves close; system enters Fault"},
        {"Cause (Event)": "Flame Failure", "Effect (System Response)": "Trip burner; inhibit restart"},
        {"Cause (Event)": "Analyzer Bad Quality", "Effect (System Response)": "Force Track mode; alarm operator"},
        {"Cause (Event)": "FGR Damper Feedback Lost", "Effect (System Response)": "Freeze demand; alarm; inhibit Auto"},
        {"Cause (Event)": "PLC → I/O Comms Loss", "Effect (System Response)": "Outputs de-energize"},
        {"Cause (Event)": "BMS Permissive Lost", "Effect (System Response)": "Transition to safe state; inhibit firing"},
        {"Cause (Event)": "HMI Comms Loss", "Effect (System Response)": "Control continues; alarm \"HMI Offline\""},
        {"Cause (Event)": "WAN / Upstream Network Loss", "Effect (System Response)": "No control impact; enter \"Offline Mode\" banner"},
    ]
    _add_table(doc, ce_matrix, ["Cause (Event)", "Effect (System Response)"], max_rows=20)

    doc.add_heading("8. Alarm Philosophy", level=1)
    doc.add_paragraph("Critical alarms force immediate safe response. Warnings indicate degraded operation. Informational alarms are advisory.")

    doc.add_heading("9. Communications & Resilience", level=1)
    doc.add_paragraph("Behavior is deterministic and fail-safe. For each scenario below, the system response is predefined:")
    for line in [
        "Loss of PLC ↔ I/O: Outputs de-energize; system enters Fault.",
        "Loss of PV / Bad Quality: Force Track or hold last good value per logic; alarm.",
        "Loss of BMS handshake: Inhibit firing; transition to safe state.",
        "Loss of HMI: Control continues; \"HMI Offline\" alarm.",
        "Loss of WAN: No control impact; local operation continues.",
    ]:
        doc.add_paragraph(line, style="List Bullet")

    doc.add_heading("10. Recovery Logic", level=1)
    doc.add_paragraph("Operator acknowledges alarms, clears root cause, returns system to Ready, and restarts via controlled sequencing.", style="List Bullet")

    doc.add_heading("11. Safety Philosophy", level=1)
    doc.add_paragraph("Fail-safe by design: PLC halt drops outputs, I/O loss removes enables, and critical interlocks are hardware-backed where applicable.")

    doc.add_heading("12. Data & Diagnostics", level=1)
    doc.add_paragraph("Key instruments, analyzers, and monitoring signals are referenced throughout. The Tag Dictionary is in Appendix A. Logic diagram page images are in Appendix D.")

    doc.add_heading("13. Commissioning Guidance", level=1)
    doc.add_paragraph(
        "Verify wiring, validate I/O, prove interlocks, test Manual, enable Auto, simulate faults. "
        "Setpoints and mode behavior tables below. "
        "All numeric limits and timers are preliminary and will be finalized during commissioning."
    )
    if setpoint_rows:
        _add_table(doc, setpoint_rows, ["Setpoint/Tag", "Unit", "Value/Notes"], max_rows=80)
    else:
        doc.add_paragraph("(none)")

    doc.add_heading("14. Change Management", level=1)
    doc.add_paragraph("All logic changes require versioning. Runtime images and configuration backups are maintained. Rollback is supported.")

    doc.add_heading("15. Intended Use", level=1)
    doc.add_paragraph("This document is the authoritative source for logic behavior, HMI design, testing, and customer communication.")

    # Functional area descriptions (from narrative_for_loop)
    doc.add_heading("Functional Area Descriptions", level=1)
    doc.add_paragraph("The system is organized into the following functional areas.")
    by_area = group_pages_by_function(pages)
    for area_name, plist in sorted(by_area.items()):
        doc.add_heading(area_name, level=2)
        body = narrative_for_loop(area_name, plist)
        for line in body.split("\n"):
            line = line.strip()
            if not line:
                doc.add_paragraph()
                continue
            if line.startswith("**") and line.endswith("**"):
                doc.add_paragraph(line.strip("*"), style="Heading 2")
            elif line.startswith("- "):
                doc.add_paragraph(line[2:], style="List Bullet")
            elif line.startswith("|"):
                continue
            else:
                doc.add_paragraph(line)

    # ---------- Appendices A–D (Enterprise) ----------
    doc.add_heading("Appendix A – Tag Naming Convention", level=1)
    doc.add_paragraph("Format: [Area]_[Equipment]_[Signal]_[Type] or ISA-style (e.g. 63FY4140, BmsPurge). Type suffixes: CMD, STS, AI, AO, DI, DO, PV, SP.")
    if tag_rows:
        _add_table(doc, tag_rows[:30], ["LoopPage", "Tag", "Description", "SourcePage"], max_rows=30)

    doc.add_heading("Appendix B – State Machine", level=1)
    doc.add_paragraph("[ Power-Up ] → [ Initializing ] → [ Ready ] → ( Auto | Manual | Maintenance ) → [ Fault ] → [ Ready ]")

    doc.add_heading("Appendix C – Failure Modes & Effects", level=1)
    if cause_effect_rows:
        fm_rows = []
        for r in cause_effect_rows[:40]:
            fm_rows.append({
                "Failure Mode": str(r.get("FunctionArea", r.get("type", "")))[:30],
                "Cause": str(r.get("CauseSignal", r.get("cause_text", "")))[:60],
                "System Response": str(r.get("EffectDescription", r.get("effect_text", "")))[:60],
                "Operator Indication": "Alarm/Interlock",
                "Recovery Action": "Clear condition, restart per procedure",
            })
        _add_table(doc, fm_rows, ["Failure Mode", "Cause", "System Response", "Operator Indication", "Recovery Action"], max_rows=50)
    else:
        doc.add_paragraph("(none extracted)")

    doc.add_heading("Appendix D – Logic Diagram Page Images", level=1)
    doc.add_paragraph("Each page: Page N – clean title – build/assets/page_NNNN.png")
    for p in pages:
        clean = _clean_title_for_appendix(p.title, p.page_num)
        doc.add_paragraph(f"Page {p.page_num} – {clean} – build/assets/page_{p.page_num:04d}.png")

    doc.add_heading("Appendix E – Cause & Effect Matrix", level=1)
    ce_matrix = [
        {"Cause (Event)": "E-Stop Active", "Effect (System Response)": "All fuel valves close; system enters Fault"},
        {"Cause (Event)": "Flame Failure", "Effect (System Response)": "Trip burner; inhibit restart"},
        {"Cause (Event)": "Analyzer Bad Quality", "Effect (System Response)": "Force Track mode; alarm operator"},
        {"Cause (Event)": "FGR Damper Feedback Lost", "Effect (System Response)": "Freeze demand; alarm; inhibit Auto"},
        {"Cause (Event)": "PLC → I/O Comms Loss", "Effect (System Response)": "Outputs de-energize"},
        {"Cause (Event)": "BMS Permissive Lost", "Effect (System Response)": "Transition to safe state; inhibit firing"},
        {"Cause (Event)": "HMI Comms Loss", "Effect (System Response)": "Control continues; alarm \"HMI Offline\""},
        {"Cause (Event)": "WAN / Upstream Network Loss", "Effect (System Response)": "No control impact; enter \"Offline Mode\" banner"},
    ]
    _add_table(doc, ce_matrix, ["Cause (Event)", "Effect (System Response)"], max_rows=20)

    doc.add_heading("Appendix F – Raw Cause/Effect Extracted Data", level=1)
    doc.add_paragraph(
        "The following rows were extracted from the logic diagrams. Duplicates have been collapsed. "
        "The curated Cause & Effect matrix is in Section 7 and Appendix E."
    )
    if cause_effect_rows:
        seen = set()
        deduped = []
        for r in cause_effect_rows:
            key = (
                str(r.get("FunctionArea", ""))[:40],
                str(r.get("CauseSignal", ""))[:60],
                str(r.get("EffectDescription", ""))[:60],
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(r)
        cols = ["FunctionArea", "CauseSignal", "Condition/Threshold", "TimerDelay", "EffectSignal", "EffectDescription", "SourcePage"]
        _add_table(doc, deduped, cols, max_rows=80)
    else:
        doc.add_paragraph("(none extracted)")

    doc.save(out_path)
