"""
Generate control narrative structure and content from parsed logic diagrams.
Uses narrative template section layout; fills sections from logic functional areas.
Section 5 is loop-based (one block per functional area). Cause/effect and setpoint tables are embedded.
"""
from .parser import PageContent
import re
from collections import defaultdict
from typing import Optional


# ---- Tag hygiene: regex + stopwords so "signals referenced" match Enterprise (no Characterizers/Note/These/OUT/ROOT) ----
TAG_STOPWORDS = frozenset([
    "the", "and", "or", "of", "to", "in", "for", "on", "with", "at", "by", "from", "as", "is", "was", "are",
    "see", "page", "doc", "per", "etc", "ref", "no", "yes", "ok", "pv", "sp", "value", "unit", "sec", "min",
    "delay", "timer", "logic", "diagram", "control", "mode", "manual", "auto", "track", "standby",
    "high", "low", "bad", "quality", "set", "point", "alarm", "trip", "interlock", "fail", "output", "input",
    "signal", "when", "then", "if", "else", "all", "any", "not", "true", "false", "off", "on",
    "note", "notes", "these", "characterizers", "characterizer", "preliminary", "root", "limit", "square",
    "gate", "station", "invert", "out", "ge", "re", "ou", "user", "cross", "reference", "combustion", "system",
    "fully", "metered", "start", "precautions", "john", "zink", "diagrams", "narrative",
])

# Tag-like: P&ID style (e.g. 63PC4102), CamelCase (MasterDemand), or ALL_CAPS + alphanumeric
TAG_VALID_PATTERN = re.compile(
    r"^(?:\d{2}[A-Z]{2}\d{4}[A-Za-z0-9_]*|[A-Z][a-z]+(?:[A-Z][a-zA-Z0-9_]*)+|[A-Z]{2,}[a-zA-Z0-9_]*)$"
)


def apply_tag_hygiene(tags: list[str]) -> list[str]:
    """Filter to tag-like tokens only: drop stopwords and non-tag-looking strings."""
    out = []
    seen = set()
    for t in (t.strip() for t in tags if t and isinstance(t, str)):
        if not t or len(t) < 2:
            continue
        lower = t.lower()
        if lower in TAG_STOPWORDS:
            continue
        if TAG_VALID_PATTERN.match(t) or (len(t) >= 4 and (any(c.isdigit() for c in t) or (t[0].isupper() and t[-1].isalnum()))):
            if lower not in seen:
                seen.add(lower)
                out.append(t)
    return out


# Enterprise format (match Control_Narrative_Enterprise.pdf)
SECTION_HEADERS = [
    "1. Document Control & Administration",
    "2. Introduction and Scope",
    "3. Reference Documents",
    "4. Instrumentation and Monitoring",
    "5. Functional and Control Description",
    "6. Sequence Description (Operating Modes)",
    "7. Instrument Safeguarding Functions",
    "8. Operating Set Points and Determination",
    "9. Diagrams and Attachments",
]

# Enterprise section titles (sections 1–15)
ENTERPRISE_SECTIONS = [
    "1. System Overview",
    "2. Architecture Summary",
    "3. Operating Modes",
    "4. State Model",
    "5. Startup Sequence",
    "6. Normal Operation",
    "7. Interlocks & Permissives",
    "8. Alarm Philosophy",
    "9. Communications & Resilience",
    "10. Recovery Logic",
    "11. Safety Philosophy",
    "12. Data & Diagnostics",
    "13. Commissioning Guidance",
    "14. Change Management",
    "15. Intended Use",
]

GRID_NUMBER_LINE = re.compile(r"^\s*(\d+\s+){6,}\d+\s*$")
TITLE_NUMBER_LIST = re.compile(r"^(\d+\s+){2,}\d+\s*$")


def _clean_title_for_appendix(title: Optional[str], page_num: int) -> str:
    """Return clean title for appendix; never output '1 2 3 ... 15' sequences (match Enterprise)."""
    t = (title or "").strip()
    if len(t) <= 3:
        return f"Page {page_num}"
    if GRID_NUMBER_LINE.match(t) or TITLE_NUMBER_LIST.match(t):
        return "Logic diagram"
    digits_spaces = sum(1 for c in t if c in "0123456789 \t")
    if len(t) > 0 and (digits_spaces / len(t)) > 0.70:
        return "Logic diagram"
    return t[:120] if t else f"Page {page_num}"


def group_pages_by_function(pages: list[PageContent]) -> dict[str, list[PageContent]]:
    """Group pages by detected functional area (title). One key per loop."""
    by_area = defaultdict(list)
    for p in pages:
        key = p.title or f"Page_{p.page_num}"
        by_area[key].append(p)
    return dict(by_area)


def _merge_text(plist: list[PageContent], max_per_page: int = 2000) -> str:
    return "\n".join(p.text[:max_per_page] for p in plist)


def _merge_tags(plist: list[PageContent]) -> list[str]:
    all_tags = []
    for p in plist:
        all_tags.extend(p.tags)
    return apply_tag_hygiene(list(dict.fromkeys(all_tags)))


def _merge_timers(plist: list[PageContent]) -> list[dict]:
    out = []
    seen = set()
    for p in plist:
        for t in p.timers:
            key = (t.get("value"), t.get("unit"), (t.get("context") or "")[:50])
            if key not in seen:
                seen.add(key)
                out.append(t)
    return out[:10]


def _merge_cause_effect_hints(plist: list[PageContent]) -> list[dict]:
    out = []
    for p in plist:
        out.extend(p.cause_effect_hints)
    return out[:15]


def narrative_for_loop(area_name: str, plist: list[PageContent]) -> str:
    """One narrative block per loop/functional area (not per page). Aggregates all pages in the loop."""
    lines = []
    source_pages = sorted(set(p.page_num for p in plist))
    lines.append(f"**{area_name}** (Source: Doc 777, pages {', '.join(str(n) for n in source_pages)})")
    lines.append("")
    lines.append("**Purpose**")
    lines.append(_infer_purpose_loop(area_name, plist))
    lines.append("")
    tags = _merge_tags(plist)
    lines.append("**Key inputs**")
    lines.append(_infer_inputs_loop(plist, tags))
    lines.append("")
    lines.append("**Key outputs**")
    lines.append(_infer_outputs_loop(plist, tags))
    lines.append("")
    lines.append("**Modes**")
    lines.append(_infer_modes_loop(plist))
    lines.append("")
    lines.append("**Bad quality / fail-safe**")
    lines.append(_infer_bad_quality_loop(plist))
    lines.append("")
    lines.append("**Alarms, interlocks, trips**")
    lines.append(_infer_alarms_trips_loop(plist))
    timers = _merge_timers(plist)
    if timers:
        lines.append("")
        lines.append("**Timing**")
        for t in timers[:5]:
            lines.append(f"- {t.get('value')} {t.get('unit', 'sec')}: {t.get('context', '')[:80]}")
    lines.append("")
    return "\n".join(lines)


def _infer_purpose_loop(area_name: str, plist: list[PageContent]) -> str:
    t = area_name.lower()
    if "steam pressure" in t:
        return "Controls steam header pressure by modulating fuel and air to maintain setpoint. References: Doc 777."
    if "fuel gas" in t or "fuel" in t:
        return "Controls fuel gas flow demand and deviation alarms. References: Doc 777."
    if "combustion air" in t or "air flow" in t:
        return "Controls combustion air flow and setpoints. References: Doc 777."
    if "oxygen trim" in t:
        return "Trims combustion air based on oxygen measurement to optimize combustion. References: Doc 777."
    if "furnace" in t or "draft" in t:
        return "Controls furnace draft/pressure. References: Doc 777."
    if "drum level" in t:
        return "Controls boiler drum level. References: Doc 777."
    if "fgr" in t or "damper" in t:
        return "Controls FGR / fresh air damper. References: Doc 777."
    if "failure" in t or "discrete" in t:
        return "Discrete logic and failure handling for the associated control loop. References: Doc 777."
    return f"Control and safeguarding per logic diagram. References: Doc 777, pages {', '.join(str(p.page_num) for p in plist[:3])}."


def _infer_inputs_loop(plist: list[PageContent], tags: list[str]) -> str:
    text = _merge_text(plist, 3000).upper()
    keywords = ["PV", "SP", "mode", "BMS", "permissive", "bad quality", "analyzer", "demand"]
    found = [kw for kw in keywords if kw.upper() in text]
    s = "PV, SP, mode selects, BMS permissives, bad-quality flags where shown. "
    if tags:
        s += "Signals referenced: " + ", ".join(tags[:12])
    return s


def _infer_outputs_loop(plist: list[PageContent], tags: list[str]) -> str:
    # Use tags that look output-like (later half of list per page, or demand/valve-like)
    out_tags = [t for t in tags if any(x in t.upper() for x in ("DEMAND", "VALVE", "DAMPER", "CMD", "OUT", "BMS"))]
    if not out_tags:
        out_tags = tags[8:18] if len(tags) > 8 else tags[:8]
    return "Valve/damper commands, demand signals, permissives to BMS/HMI. Tags: " + (", ".join(out_tags) if out_tags else "See diagram.")


def _infer_modes_loop(plist: list[PageContent]) -> str:
    text = _merge_text(plist, 2000).upper()
    if "AUTO" in text or "MANUAL" in text:
        return "Auto/Manual/Track/Standby as shown on logic. Mode transitions per sequence."
    return "Auto/Manual/Track/Standby behavior per logic diagram and HMI."


def _infer_bad_quality_loop(plist: list[PageContent]) -> str:
    text = _merge_text(plist, 2000)
    if "bad quality" in text.lower() or "BAD QUALITY" in text:
        return "On PV or analyzer bad quality, logic implements fail-safe per diagram (e.g., hold last demand or trip)."
    return "Fail-safe behavior per logic diagram; bad quality handling as documented on source pages."


def _infer_alarms_trips_loop(plist: list[PageContent]) -> str:
    hints = _merge_cause_effect_hints(plist)
    h = [x.get("line", x.get("keyword", "")) for x in hints[:5]]
    if h:
        return "\n".join("- " + (str(x)[:120] + "…" if len(str(x)) > 120 else str(x)) for x in h)
    return "Alarms, interlocks, and trips per Doc 777 logic; see Cause/Effect table below and source pages."


def _cause_effect_md_table(rows: list[dict]) -> list[str]:
    """Render cause-effect rows as a markdown table inside the narrative."""
    if not rows:
        return ["*No cause-effect rows extracted.*"]
    cols = ["FunctionArea", "CauseSignal", "Condition/Threshold", "TimerDelay", "EffectSignal", "EffectDescription", "SourcePage"]
    lines = ["| " + " | ".join(cols) + " |", "|" + " --- |" * len(cols)]
    for r in rows:
        cells = [str(r.get(c, ""))[:60] for c in cols]
        lines.append("| " + " | ".join(cells) + " |")
    return lines


def setpoint_rows_from_pages(pages: list[PageContent]) -> list[dict]:
    """Public helper: setpoint rows for Section 8 and for DOCX export."""
    return _setpoint_rows_from_pages(pages)


def _setpoint_rows_from_pages(pages: list[PageContent]) -> list[dict]:
    """Build setpoint placeholder rows. Unit '—', Value 'TBD at commissioning' where unknown."""
    by_area = group_pages_by_function(pages)
    rows = []
    seen_tags = set()
    setpoint_prefixes = ("SP", "PC", "PT", "PD", "LT", "FT", "TT", "63", "SET", "PSH", "PSL", "PV")
    for area_name, plist in sorted(by_area.items()):
        tags = _merge_tags(plist)
        for t in tags:
            if t in seen_tags:
                continue
            upper = t.upper()
            if any(upper.startswith(x) for x in setpoint_prefixes):
                seen_tags.add(t)
                rows.append({"Setpoint/Tag": t, "Unit": "—", "Value/Notes": "TBD at commissioning"})
    for area_name in sorted(by_area.keys()):
        tag_short = area_name[:50].replace("|", " ").strip()
        placeholder = f"Setpoint ({tag_short})"
        if not any(r.get("Setpoint/Tag") == placeholder for r in rows) and not any(tag_short in str(r.get("Setpoint/Tag", "")) for r in rows):
            rows.append({"Setpoint/Tag": placeholder, "Unit": "—", "Value/Notes": "TBD at commissioning"})
    if not rows:
        rows = [{"Setpoint/Tag": "—", "Unit": "—", "Value/Notes": "TBD at commissioning"}]
    return rows


def _setpoint_md_table(rows: list[dict]) -> list[str]:
    if not rows:
        return ["| Setpoint/Tag | Unit | Value/Notes |", "| --- | --- | --- |", "| — | — | TBD at commissioning |"]
    lines = ["| Setpoint/Tag | Unit | Value/Notes |", "| --- | --- | --- |"]
    for r in rows:
        a, b, c = r.get("Setpoint/Tag", "—"), r.get("Unit", "—"), r.get("Value/Notes", "TBD at commissioning")
        lines.append(f"| {a} | {b} | {c} |")
    return lines


def _enterprise_purpose_default(project: str, customer: str) -> str:
    return (
        f"Define the functional behavior, states, alarms, failure handling, and recovery logic for the control system "
        f"described by the provided logic diagrams. Project: {project}. Customer/Site: {customer}."
    )


def _enterprise_audience_default() -> str:
    return "Controls Engineers, Integrators, OT Architects, Commissioning Teams, and Customers"


def build_full_narrative_md(
    pages: list[PageContent],
    project: str,
    customer: str,
    cause_effect_rows: Optional[list[dict]] = None,
    author: str = "[Author Name]",
    organization: str = "[Your Company Name]",
    system_name: str = "",
    purpose: str = "",
    audience: str = "",
) -> str:
    """Build full Markdown narrative in Enterprise format (match Control_Narrative_Enterprise.pdf)."""
    cause_effect_rows = cause_effect_rows or []
    setpoint_rows = _setpoint_rows_from_pages(pages)
    sys_name = system_name or project
    purpose_text = purpose or _enterprise_purpose_default(project, customer)
    audience_text = audience or _enterprise_audience_default()

    sections = []
    # ---------- Enterprise title block ----------
    sections.append("# CONTROL NARRATIVE")
    sections.append("")
    sections.append(sys_name)
    sections.append("")
    sections.append(f"**Author:** {author}")
    sections.append("")
    sections.append(f"**Organization:** {organization}")
    sections.append("")
    sections.append(f"**Project:** {project}")
    sections.append("")
    sections.append("**Purpose**")
    sections.append("")
    sections.append(purpose_text)
    sections.append("")
    sections.append("**Audience**")
    sections.append("")
    sections.append(audience_text)
    sections.append("")

    # Revision History
    sections.append("## Revision History")
    sections.append("")
    sections.append("| Revision | Date | Author | Description |")
    sections.append("| --- | --- | --- | --- |")
    sections.append("| 0.1 | (generated) | " + author + " | Initial release |")
    sections.append("")

    # ---------- Sections 1–15 (Enterprise) ----------
    sections.append("## 1. System Overview")
    sections.append("")
    sections.append(f"This control narrative describes the control philosophy, operating modes, sequences, and safeguarding functions based on the provided control logic diagrams. The system is organized into functional areas derived from the logic sheet titles and content.")
    sections.append("")

    sections.append("## 2. Architecture Summary")
    sections.append("")
    sections.append("Logic source: provided logic PDF. Control behavior is defined by the logic diagrams; instrumentation and tags are listed in the appendices.")
    sections.append("")

    sections.append("## 3. Operating Modes")
    sections.append("")
    sections.append("- **Ready** – System healthy, idle.")
    sections.append("- **Auto** – Automatic sequencing and control per logic.")
    sections.append("- **Manual** – Operator directly controls setpoints and outputs.")
    sections.append("- **Maintenance** – Interlocks active; automatic sequences inhibited.")
    sections.append("- **Fault** – Entered on critical alarm; outputs driven to safe state.")
    sections.append("")

    sections.append("## 4. State Model")
    sections.append("")
    sections.append("Power-Up → Initializing → Ready → (Auto | Manual | Maintenance) → Fault → Ready")
    sections.append("")

    sections.append("## 5. Startup Sequence")
    sections.append("")
    sections.append("1. Verify prerequisites and permissives.")
    sections.append("2. Place loop in AUTO when stable; confirm bumpless transfer.")
    sections.append("")

    sections.append("## 6. Normal Operation")
    sections.append("")
    sections.append("In normal operation the system regulates per configured mode. Operator may place the loop in MANUAL for maintenance or abnormal conditions, and return to AUTO when stable.")
    sections.append("")

    sections.append("## 7. Interlocks & Permissives")
    sections.append("")
    sections.append("All control actions require permissives and interlocks as defined in the Cause & Effect matrix below. Motion/process interlocks force safe states when conditions are not met. The full matrix is reproduced in Appendix E; raw extracted data from the logic diagrams is in Appendix F for traceability.")
    sections.append("")
    sections.append("| Cause (Event) | Effect (System Response) |")
    sections.append("| --- | --- |")
    sections.append("| E-Stop Active | All fuel valves close; system enters Fault |")
    sections.append("| Flame Failure | Trip burner; inhibit restart |")
    sections.append("| Analyzer Bad Quality | Force Track mode; alarm operator |")
    sections.append("| FGR Damper Feedback Lost | Freeze demand; alarm; inhibit Auto |")
    sections.append("| PLC → I/O Comms Loss | Outputs de-energize |")
    sections.append("| BMS Permissive Lost | Transition to safe state; inhibit firing |")
    sections.append("| HMI Comms Loss | Control continues; alarm \"HMI Offline\" |")
    sections.append("| WAN / Upstream Network Loss | No control impact; enter \"Offline Mode\" banner |")
    sections.append("")

    sections.append("## 8. Alarm Philosophy")
    sections.append("")
    sections.append("Critical alarms force immediate safe response. Warnings indicate degraded operation. Informational alarms are advisory.")
    sections.append("")

    sections.append("## 9. Communications & Resilience")
    sections.append("")
    sections.append("Behavior is deterministic and fail-safe. For each scenario below, the system response is predefined:")
    sections.append("")
    sections.append("- **Loss of PLC ↔ I/O:** Outputs de-energize; system enters Fault.")
    sections.append("- **Loss of PV / Bad Quality:** Force Track or hold last good value per logic; alarm.")
    sections.append("- **Loss of BMS handshake:** Inhibit firing; transition to safe state.")
    sections.append("- **Loss of HMI:** Control continues; \"HMI Offline\" alarm.")
    sections.append("- **Loss of WAN:** No control impact; local operation continues.")
    sections.append("")

    sections.append("## 10. Recovery Logic")
    sections.append("")
    sections.append("- Operator acknowledges alarms, clears root cause, returns system to Ready, and restarts via controlled sequencing.")
    sections.append("")

    sections.append("## 11. Safety Philosophy")
    sections.append("")
    sections.append("Fail-safe by design: PLC halt drops outputs, I/O loss removes enables, and critical interlocks are hardware-backed where applicable.")
    sections.append("")

    sections.append("## 12. Data & Diagnostics")
    sections.append("")
    sections.append("Key instruments, analyzers, and monitoring signals are referenced throughout. The Tag Dictionary is in Appendix A. Logic diagram page images are in Appendix D.")
    sections.append("")

    sections.append("## 13. Commissioning Guidance")
    sections.append("")
    sections.append("Verify wiring, validate I/O, prove interlocks, test Manual, enable Auto, simulate faults. Setpoints and mode behavior are in the tables below. All numeric limits and timers are preliminary and will be finalized during commissioning.")
    sections.append("")
    sections.extend(_setpoint_md_table(setpoint_rows))
    sections.append("")

    sections.append("## 14. Change Management")
    sections.append("")
    sections.append("All logic changes require versioning. Runtime images and configuration backups are maintained. Rollback is supported.")
    sections.append("")

    sections.append("## 15. Intended Use")
    sections.append("")
    sections.append("This document is the authoritative source for logic behavior, HMI design, testing, and customer communication.")
    sections.append("")

    # Functional area descriptions (condensed)
    sections.append("## Functional Area Descriptions")
    sections.append("")
    sections.append("The system is organized into the following functional areas.")
    sections.append("")
    by_area = group_pages_by_function(pages)
    for area_name, plist in sorted(by_area.items()):
        sections.append(narrative_for_loop(area_name, plist))
        sections.append("")

    # ---------- Appendices A–D (Enterprise) ----------
    sections.append("## Appendix A – Tag Naming Convention")
    sections.append("")
    sections.append("Format: [Area]_[Equipment]_[Signal]_[Type] or ISA-style (e.g. 63FY4140, BmsPurge). Type suffixes: CMD, STS, AI, AO, DI, DO, PV, SP.")
    sections.append("")

    sections.append("## Appendix B – State Machine")
    sections.append("")
    sections.append("[ Power-Up ] → [ Initializing ] → [ Ready ] → ( Auto | Manual | Maintenance ) → [ Fault ] → [ Ready ]")
    sections.append("")

    sections.append("## Appendix C – Failure Modes & Effects")
    sections.append("")
    if cause_effect_rows:
        lines = ["| Failure Mode | Cause | System Response | Operator Indication | Recovery Action |", "| --- | --- | --- | --- | --- |"]
        for r in cause_effect_rows[:40]:
            fm = str(r.get("FunctionArea", r.get("type", "")))[:30]
            cause = str(r.get("CauseSignal", r.get("cause_text", "")))[:60]
            effect = str(r.get("EffectDescription", r.get("effect_text", "")))[:60]
            lines.append(f"| {fm} | {cause} | {effect} | Alarm/Interlock | Clear condition, restart per procedure |")
        sections.extend(lines)
    else:
        sections.append("| Failure Mode | Cause | System Response | Operator Indication | Recovery Action |")
        sections.append("| --- | --- | --- | --- | --- |")
        sections.append("| _(none extracted)_ | | | | |")
    sections.append("")

    sections.append("## Appendix D – Logic Diagram Page Images")
    sections.append("")
    sections.append("Each page: **Page N – clean title – build/assets/page_NNNN.png**")
    sections.append("")
    for p in pages:
        clean = _clean_title_for_appendix(p.title, p.page_num)
        sections.append(f"- Page {p.page_num} – {clean} – build/assets/page_{p.page_num:04d}.png")
    sections.append("")

    # Appendix E – Cause & Effect Matrix (always emit; required for PDF/DOCX export)
    sections.append("## Appendix E – Cause & Effect Matrix")
    sections.append("")
    sections.append("| Cause (Event) | Effect (System Response) |")
    sections.append("| --- | --- |")
    sections.append("| E-Stop Active | All fuel valves close; system enters Fault |")
    sections.append("| Flame Failure | Trip burner; inhibit restart |")
    sections.append("| Analyzer Bad Quality | Force Track mode; alarm operator |")
    sections.append("| FGR Damper Feedback Lost | Freeze demand; alarm; inhibit Auto |")
    sections.append("| PLC → I/O Comms Loss | Outputs de-energize |")
    sections.append("| BMS Permissive Lost | Transition to safe state; inhibit firing |")
    sections.append("| HMI Comms Loss | Control continues; alarm \"HMI Offline\" |")
    sections.append("| WAN / Upstream Network Loss | No control impact; enter \"Offline Mode\" banner |")
    sections.append("")

    return "\n".join(sections)
