#!/usr/bin/env python3
"""
cn_gen_onefile.py — One-file Control Narrative Generator (Logic PDF -> Narrative + Tables)

====================================
HOW TO RUN (copy/paste these 3 steps)
====================================

1) Install dependencies (in Cursor terminal):
   pip install pymupdf pandas python-docx

2) Put your PDFs here:
   inputs/777.pdf   (logic diagrams)
   inputs/4208.pdf  (example/template narrative - optional, used for reference only)

3) Run:
   python cn_gen_onefile.py --logic inputs/777.pdf --template inputs/4208.pdf --out exports \
     --project "Combustion Control System, Fully Metered" --customer "TotalEnergies Port Arthur, TX."

   Enterprise-style options (match Control_Narrative_Enterprise.pdf):
   --author "Jonathan Howes" --organization "Your Company" --system_name "Virtual PLC VFD Edge System" \
   --purpose "Define the functional behavior..." --audience "Controls Engineers, Integrators, ..."

Outputs will appear in:
- exports/
- build/

Notes:
- This is "best-effort" extraction: it will NOT perfectly understand all ladder/FBD details,
  but it will produce a professional narrative skeleton with real tables, sequences, and traceability.
- You can improve quality by tuning STOPWORDS and TAG_PATTERNS near the top.

"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set

# External deps
try:
    import fitz  # PyMuPDF
except Exception as e:
    print("ERROR: PyMuPDF (fitz) not installed. Run: pip install pymupdf")
    raise

try:
    import pandas as pd
except Exception as e:
    print("ERROR: pandas not installed. Run: pip install pandas")
    raise

try:
    from docx import Document
    from docx.shared import Inches
except Exception as e:
    print("ERROR: python-docx not installed. Run: pip install python-docx")
    raise


# =========================
# CONFIG (edit if you want)
# =========================

# Stopwords / blacklist: prevent junk tags (NOTE, THESE, CHARACTERIZERS, etc.)
STOPWORDS: Set[str] = {
    # Common words
    "A", "AN", "AND", "ARE", "AS", "AT", "BE", "BY", "CAN", "COULD", "DID", "DO",
    "DOES", "EACH", "FOR", "FROM", "HAD", "HAS", "HAVE", "HOW", "IF", "IN", "INTO",
    "IS", "IT", "ITS", "MAY", "MODE", "MODES", "NOT", "OF", "ON", "OR", "OUT", "OVER",
    "SET", "SHALL", "SHOULD", "SO", "SUCH", "THAN", "THAT", "THE", "THEIR", "THEN",
    "THERE", "THESE", "THIS", "TO", "UNDER", "UP", "USED", "WAS", "WERE", "WHEN",
    "WHERE", "WHICH", "WILL", "WITH", "WITHOUT", "YES", "NO",

    # Explicit blacklist (review-ready)
    "NOTE", "NOTES", "THESE", "PRELIMINARY", "CHARACTERIZERS", "CHARACTERIZER",
    "ROOT", "LIMIT", "SQUARE", "GATE", "STATION", "INVERT", "OUT", "IN",

    # Engineering filler
    "DEFINED", "DIAGRAM", "LOGIC", "SHEET", "PAGE", "PAGES", "CONTROL", "CONTROLS",
    "DESCRIPTION", "FUNCTIONAL", "FUNCTION", "SYSTEM", "OPERATOR", "OPERATING",
    "NORMAL", "ABNORMAL", "CAUSE", "EFFECT", "TABLE", "BELOW", "ABOVE", "APPENDIX",
    "SEE", "DOC", "DOCUMENT", "REFERENCE", "REFERENCES", "SECTION", "SECTIONS",
    "INPUT", "INPUTS", "OUTPUT", "OUTPUTS", "SIGNAL", "SIGNALS", "TAG", "TAGS",
    "AUTO", "MANUAL", "MAN", "TRACK", "STANDBY", "ENABLE", "DISABLE",
    "ALARM", "ALARMS", "TRIP", "TRIPS", "INTERLOCK", "INTERLOCKS", "PERMISSIVE", "PERMISSIVES",
    "BAD", "QUALITY", "FAIL", "FAILURE", "DEVIATION",

    # Single-letter / short junk
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
}

# Block-label blacklist (review-ready): OUT, IN, ROOT, LIMIT, SQUARE, GATE, STATION, INVERT, GE, RE, OU, USER
BLOCK_LABEL_BLACKLIST: Set[str] = {
    "OUT", "IN", "ROOT", "LIMIT", "SQUARE", "GATE", "STATION", "INVERT", "GE", "RE", "OU", "USER",
}

# Tag patterns: STRICT only (63FY4140 style, BmsPurge style, underscore tags)
TAG_PATTERNS: List[str] = [
    r"\b\d{2}[A-Z]{1,4}\d{3,4}[A-Za-z0-9_]*\b",   # ex: 63FY4140, 63PC4102
    r"\b(Bms|BMS)[A-Za-z0-9_]+\b",                # ex: BmsPurge, BmsRelToMod
    r"\b[A-Za-z]{2,}_[A-Za-z0-9_]+\b",            # ex: FURNACE_PRESSURE_PV
]

# Functional areas (review-ready): always distinct sections; map each page to exactly one bucket
# Order: Steam Pressure, Fuel Gas, Combustion Air, O2 Trim, Furnace Pressure/Draft, Drum Level, Failure Logic, FGR
FUNCTION_AREA_RULES = [
    ("Steam Pressure Control", ["steam pressure", "steam pr", "pressure control", "pc", "psig", "steam"]),
    ("Fuel Gas Flow Control", ["fuel gas", "gas flow", "fg", "fuel flow"]),
    ("Combustion Air Flow Control", ["combustion air", "air flow", "fan", "fd", "air damper"]),
    ("Oxygen Trim Control", ["oxygen trim", "o2 trim", "oxygen", "analyzer", "o2"]),
    ("Furnace Pressure/Draft Control", ["furnace pressure", "draft", "furnace draft", "fdp", "id fan"]),
    ("Drum Level Control", ["drum level", "level control", "lt", "lc", "drum"]),
    ("Combustion Control System Failure Logic", ["failure logic", "system failure", "ccs failure", "combustion control system failure"]),
    ("FGR/Fresh Air Damper Control", ["fgr", "flue gas recirculation", "fresh air damper", "recirc"]),
]
MISC_LOGIC = "Misc Logic"  # unmapped pages; always last

DISCRETE_LOGIC_KEYWORDS = ["discrete logic", "interlock", "permissive", "trips"]


# Keywords to extract events / alarms / trips etc.
EVENT_KEYWORDS = {
    "permissive": ["PERMISSIVE", "PERM"],
    "interlock": ["INTERLOCK"],
    "trip": ["TRIP", "SHUTDOWN"],
    "alarm": ["ALARM", "DEVIATION", "HIHI", "HIGH HIGH", "LOLO", "LOW LOW", "HI", "LO"],
    "bad_quality": ["BAD QUALITY", "BADQUAL", "FAIL", "FAILURE"],
    "command": ["CMD", "COMMAND", "RELEASE", "PURGE", "LIGHTOFF", "MODULATE"],
}

# Timer parsing: e.g. "ON DELAY TIMER 15 sec"
TIMER_REGEXES = [
    re.compile(r"(ON\s+DELAY|OFF\s+DELAY|TIMER)\s*[:\-]?\s*(\d+(\.\d+)?)\s*(SEC|SECS|SECOND|SECONDS|MIN|MINS|MINUTE|MINUTES)\b", re.I),
    re.compile(r"\b(\d+(\.\d+)?)\s*(SEC|SECS|SECOND|SECONDS|MIN|MINS|MINUTE|MINUTES)\b", re.I),
]

# Generic fluff phrase detector (QA)
GENERIC_PHRASES = [
    "defined per logic",
    "per logic diagram",
    "see logic diagram",
    "as shown in logic",
]


# =========================
# DATA STRUCTURES
# =========================

@dataclass
class PageRecord:
    page_num: int
    title_guess: str
    raw_text: str
    blocks: List[dict]


@dataclass
class FunctionArea:
    name: str
    pages: List[int]
    confidence: float
    matched_by: str


@dataclass
class TimerRecord:
    function_area: str
    timer_text: str
    delay_value: str
    delay_units: str
    source_page: int


@dataclass
class AlarmRecord:
    function_area: str
    alarm_text: str
    alarm_tags: str
    priority: str
    delay: str
    deadband: str
    source_page: int


@dataclass
class CauseEffectRecord:
    function_area: str
    type: str
    cause_text: str
    cause_tags: str
    threshold_text: str
    timer_delay: str
    effect_text: str
    effect_tags: str
    source_page: int


# =========================
# HELPERS
# =========================

def safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")

def now_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def norm(s: str) -> str:
    return (s or "").strip()

def upper(s: str) -> str:
    return norm(s).upper()

def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))

def dedupe_preserve_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

def tokenize_for_tags(text: str) -> List[str]:
    # Tokenizer that preserves alphanumerics and underscores
    return re.findall(r"[A-Za-z0-9_]+", text or "")

def is_stopword(token: str) -> bool:
    t = upper(token)
    if len(t) <= 1:
        return True
    return t in STOPWORDS or t in BLOCK_LABEL_BLACKLIST

def compile_tag_regexes() -> List[re.Pattern]:
    return [re.compile(p) for p in TAG_PATTERNS]

TAG_REGEXES = compile_tag_regexes()

# Hard filter "grid number" and junk lines (review-ready)
GRID_NUMBER_LINE = re.compile(r"^\s*(\d+\s+){6,}\d+\s*$")

def _line_has_letters_digits_tag_match(line: str, tag_regexes: List[re.Pattern]) -> bool:
    """True if line contains at least one tag-pattern match (letters+digits style)."""
    for rx in tag_regexes:
        if rx.search(line or ""):
            return True
    return False

def _line_mostly_punctuation_or_isolated_numbers(line: str) -> bool:
    """True if line is mostly punctuation or isolated numbers (e.g. " .  -  1  2 ")."""
    tokens = re.findall(r"\S+", line or "")
    if not tokens:
        return True
    alpha_or_digit_tokens = sum(1 for t in tokens if re.search(r"[A-Za-z]", t) or (re.search(r"\d", t) and len(t) > 1))
    if alpha_or_digit_tokens >= 2:
        return False
    # Mostly punctuation/single digits
    non_junk = sum(1 for t in tokens if re.search(r"[A-Za-z]", t) or re.search(r"\d{2,}", t))
    return non_junk < 2

def filter_junk_lines(lines: List[str], tag_regexes: List[re.Pattern]) -> List[str]:
    """
    Hard filter:
    - Remove lines matching grid-number pattern ^\\s*(\\d+\\s+){6,}\\d+\\s*$
    - Remove lines that are only 1–3 tokens and contain no letters+digits tag match
    - Remove lines that are mostly punctuation or isolated numbers
    """
    out = []
    for line in (norm(ln) for ln in lines if ln):
        if GRID_NUMBER_LINE.match(line):
            continue
        tokens = re.findall(r"\S+", line)
        ntok = len(tokens)
        if ntok >= 1 and ntok <= 3 and not _line_has_letters_digits_tag_match(line, tag_regexes):
            continue
        if _line_mostly_punctuation_or_isolated_numbers(line):
            continue
        out.append(line)
    return out


# =========================
# 1) PDF INDEXING
# =========================

# Title guessing (review-ready): ignore grid-number, >70% digits, <=3 chars; prefer real keywords
TITLE_PREFER_KEYWORDS = ["CONTROL", "FLOW", "PRESSURE", "OXYGEN", "DRUM", "FGR", "DISCRETE", "FAILURE", "DRAFT"]
TITLE_GRID_NUMBER = re.compile(r"^\s*(\d+\s+){6,}\d+\s*$")
TITLE_NUMBER_LIST = re.compile(r"^(\d+\s+){2,}\d+\s*$")  # "1 2 3 ... 15" style

def _title_candidate_ok(line: str) -> bool:
    """Ignore: grid-number pattern, >70% digits/spaces, <=3 characters."""
    line = norm(line)
    if len(line) <= 3:
        return False
    if TITLE_GRID_NUMBER.match(line) or TITLE_NUMBER_LIST.match(line):
        return False
    digits_spaces = sum(1 for c in line if c in "0123456789 \t")
    if len(line) > 0 and (digits_spaces / len(line)) > 0.70:
        return False
    return True

def guess_title_from_blocks(page, blocks: List[tuple]) -> str:
    """
    From top 20% of page: IGNORE candidates that (a) match grid-number pattern,
    (b) are >70% digits/spaces, (c) are <=3 characters.
    Prefer candidates containing CONTROL/FLOW/PRESSURE/OXYGEN/DRUM/FGR/DISCRETE/FAILURE/DRAFT.
    """
    try:
        rect = page.rect
        top_limit = rect.height * 0.20
    except Exception:
        top_limit = 200

    candidates = []
    for b in blocks:
        if len(b) < 5:
            continue
        x0, y0, x1, y1, text = b[0], b[1], b[2], b[3], b[4]
        if y0 > top_limit:
            continue
        line = norm(text).replace("\n", " ").strip()
        if not line or not _title_candidate_ok(line):
            continue
        letters = re.findall(r"[A-Za-z]", line)
        if not letters:
            continue
        up = sum(1 for ch in letters if ch.isupper())
        ratio = up / max(1, len(letters))
        score = ratio * 2.0 + min(len(line) / 80.0, 1.0)
        line_u = line.upper()
        for kw in TITLE_PREFER_KEYWORDS:
            if kw in line_u:
                score += 1.5
                break
        candidates.append((score, line))
    if not candidates:
        return ""

    candidates.sort(key=lambda x: x[0], reverse=True)
    best = re.sub(r"\s+", " ", candidates[0][1])
    return best[:140]

def index_logic_pdf(logic_pdf: Path, build_dir: Path) -> List[PageRecord]:
    safe_mkdir(build_dir)
    assets_dir = build_dir / "assets"
    safe_mkdir(assets_dir)

    doc = fitz.open(str(logic_pdf))
    pages: List[PageRecord] = []

    for i in range(doc.page_count):
        page = doc.load_page(i)
        raw_text = page.get_text("text") or ""
        blocks_raw = page.get_text("blocks") or []
        title_guess = guess_title_from_blocks(page, blocks_raw) or f"Page {i+1}"

        # Convert blocks to serializable format
        blocks = []
        for b in blocks_raw:
            if len(b) < 5:
                continue
            blocks.append({
                "bbox": [float(b[0]), float(b[1]), float(b[2]), float(b[3])],
                "text": norm(b[4]).replace("\u00a0", " ")
            })

        # Render PNG
        zoom = 2.0  # ~144-200 DPI depending on default
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_name = f"page_{i+1:04d}.png"
        pix.save(str(assets_dir / png_name))

        pages.append(PageRecord(
            page_num=i+1,
            title_guess=title_guess,
            raw_text=raw_text,
            blocks=blocks
        ))

    # Write logic_pages.json
    logic_pages_json = [asdict(p) for p in pages]
    write_json(build_dir / "logic_pages.json", logic_pages_json)
    return pages


# =========================
# 2) TAG EXTRACTION
# =========================

def extract_tags(pages: List[PageRecord], build_dir: Path, exports_dir: Path) -> Tuple[Dict[str, dict], Dict[int, List[str]]]:
    """
    Returns:
      tag_stats: { tag: {count:int, pages:[...]} }
      tags_by_page: { page_num: [tags...] }
    """
    tag_stats: Dict[str, dict] = {}
    tags_by_page: Dict[int, List[str]] = {}

    for p in pages:
        text = p.raw_text or ""

        # STRICT: only regex patterns (63FY4140, Bms*, underscore style)
        candidates = []
        for rx in TAG_REGEXES:
            for m in rx.finditer(text):
                c = m.group(0)
                if c:
                    candidates.append(norm(str(c)))

        # Clean/filter: blacklist + require (letter+digit) or underscore style
        cleaned = []
        for c in candidates:
            c = norm(str(c))
            if not c or len(c) > 40:
                continue
            if re.fullmatch(r"\d+(\.\d+)?", c):
                continue
            if is_stopword(c):
                continue
            # Require: at least one letter + one digit OR underscore style
            has_letter = bool(re.search(r"[A-Za-z]", c))
            has_digit = bool(re.search(r"\d", c))
            underscore_style = "_" in c and len(c) >= 4
            if not ((has_letter and has_digit) or underscore_style):
                continue
            cleaned.append(c)

        # Only keep tags that match strict patterns
        final = []
        for c in cleaned:
            for rx in TAG_REGEXES:
                if rx.fullmatch(c):
                    final.append(c)
                    break

        # After extraction: drop any tag that is pure English (no digit, no underscore)
        final = [t for t in final if re.search(r"\d", t) or "_" in t]
        final = dedupe_preserve_order(final)
        tags_by_page[p.page_num] = final

        for t in final:
            entry = tag_stats.get(t, {"count": 0, "pages": []})
            entry["count"] += 1
            if p.page_num not in entry["pages"]:
                entry["pages"].append(p.page_num)
            tag_stats[t] = entry

    # Write outputs
    safe_mkdir(build_dir)
    safe_mkdir(exports_dir)
    write_json(build_dir / "tag_dictionary.json", tag_stats)

    # CSV
    rows = []
    for tag, info in tag_stats.items():
        rows.append({
            "Tag": tag,
            "Count": int(info["count"]),
            "Pages": ",".join(str(x) for x in sorted(info["pages"]))
        })
    df = pd.DataFrame(rows).sort_values(["Count", "Tag"], ascending=[False, True])
    df.to_csv(exports_dir / "tag_dictionary.csv", index=False)

    return tag_stats, tags_by_page


# =========================
# 3) FUNCTION AREA SEGMENTATION
# =========================

def detect_area_from_text(title: str, text: str) -> Tuple[Optional[str], float, str]:
    t = upper(title)
    body = upper(text)

    # Title match gets higher confidence
    for area, keywords in FUNCTION_AREA_RULES:
        if upper(area) in t:
            return area, 0.95, "title"
        for kw in keywords:
            if upper(kw) in t:
                return area, 0.85, "title_kw"

    # Keyword matching in body
    best_area = None
    best_score = 0.0
    best_by = "keyword"
    for area, keywords in FUNCTION_AREA_RULES:
        hits = 0
        for kw in keywords:
            if upper(kw) in body:
                hits += 1
        score = hits / max(1, len(keywords))
        if score > best_score:
            best_score = score
            best_area = area

    if best_area and best_score > 0.20:
        return best_area, clamp(best_score, 0.30, 0.80), best_by

    return None, 0.0, "none"

def _body_score_for_area(text: str, area_name: str) -> float:
    """Score 0..1 for how well body text matches an area (used when title gives None)."""
    body = upper(text or "")
    for area, keywords in FUNCTION_AREA_RULES:
        if area == area_name:
            hits = sum(1 for kw in keywords if upper(kw) in body)
            return hits / max(1, len(keywords))
    return 0.0

def segment_function_areas(pages: List[PageRecord], build_dir: Path) -> List[FunctionArea]:
    """
    Force separate sections: assign each page to one of the 8 canonical areas.
    Do NOT lump pages 2-23 into a single section; use per-page title + body detection.
    """
    canonical_names = [r[0] for r in FUNCTION_AREA_RULES]
    area_pages: Dict[str, List[int]] = {}
    area_conf: Dict[str, float] = {}
    area_by: Dict[str, str] = {}

    last_base_area: Optional[str] = None

    for p in pages:
        title = p.title_guess or ""
        text = p.raw_text or ""
        title_u = upper(title)
        is_discrete = any(upper(k) in title_u for k in DISCRETE_LOGIC_KEYWORDS)

        if is_discrete and last_base_area:
            area_name = f"{last_base_area} - Discrete Logic"
            conf = 0.90
            by = "discrete_attach"
        else:
            area_name, conf, by = detect_area_from_text(title, text)
            if area_name is None:
                # Per-page fallback: assign to best-matching canonical area by body keywords
                best_area = None
                best_score = 0.0
                for can in canonical_names:
                    s = _body_score_for_area(text, can)
                    if s > best_score and s >= 0.15:
                        best_score = s
                        best_area = can
                area_name = best_area if best_area else MISC_LOGIC
                conf = best_score if best_area else 0.20
                by = "body_fallback" if best_area else "fallback"

        if "Discrete Logic" not in area_name and area_name != MISC_LOGIC:
            last_base_area = area_name

        area_pages.setdefault(area_name, []).append(p.page_num)
        area_conf[area_name] = max(area_conf.get(area_name, 0.0), conf)
        area_by[area_name] = by if by not in ("fallback",) else area_by.get(area_name, "fallback")

    # Build list: all 8 canonical sections first, then "X - Discrete Logic" in same order, then Unclassified
    areas: List[FunctionArea] = []
    for can in canonical_names:
        areas.append(FunctionArea(
            name=can,
            pages=sorted(area_pages.get(can, [])),
            confidence=float(area_conf.get(can, 0.0)),
            matched_by=area_by.get(can, "unknown")
        ))
    for can in canonical_names:
        dname = f"{can} - Discrete Logic"
        if dname in area_pages:
            areas.append(FunctionArea(
                name=dname,
                pages=sorted(area_pages[dname]),
                confidence=float(area_conf.get(dname, 0.0)),
                matched_by=area_by.get(dname, "unknown")
            ))
    if MISC_LOGIC in area_pages:
        areas.append(FunctionArea(name=MISC_LOGIC, pages=sorted(area_pages[MISC_LOGIC]), confidence=float(area_conf.get(MISC_LOGIC, 0.0)), matched_by=area_by.get(MISC_LOGIC, "unknown")))

    # Sort: canonical order, then Discrete by base, then Misc Logic last
    def sort_key(a: FunctionArea) -> Tuple[int, int, str]:
        base = a.name.replace(" - Discrete Logic", "")
        if base in canonical_names:
            idx = canonical_names.index(base)
            return (0, idx, a.name)
        if a.name == MISC_LOGIC:
            return (2, 999, a.name)
        return (1, 500, a.name)

    areas.sort(key=sort_key)
    write_json(build_dir / "function_areas.json", [asdict(a) for a in areas])
    return areas


# =========================
# 4) EVENT / ALARM / TIMER EXTRACTION
# =========================

def line_has_any(line_u: str, needles: List[str]) -> bool:
    return any(n in line_u for n in needles)

def guess_event_type(line_u: str) -> str:
    for etype, words in EVENT_KEYWORDS.items():
        if line_has_any(line_u, [upper(w) for w in words]):
            # map bad_quality keyword to interlock-ish
            if etype == "bad_quality":
                return "bad_quality"
            return etype
    return "note"

def extract_timer_from_line(line: str) -> Optional[Tuple[str, str]]:
    for rx in TIMER_REGEXES:
        m = rx.search(line)
        if m:
            if len(m.groups()) >= 4:
                val = m.group(2)
                units = m.group(4)
            else:
                val = m.group(1)
                units = m.group(3) if len(m.groups()) >= 3 else ""
            units_u = upper(units)
            if "MIN" in units_u:
                units_u = "min"
            else:
                units_u = "sec"
            return str(val), units_u
    return None

def find_tags_in_text(text: str, known_tags: Set[str]) -> List[str]:
    toks = tokenize_for_tags(text)
    out = []
    # Match exact known tags or case-insensitive by normalized compare
    known_upper = {upper(t): t for t in known_tags}
    for tok in toks:
        u = upper(tok)
        if u in known_upper and not is_stopword(tok):
            out.append(known_upper[u])
    return dedupe_preserve_order(out)

def page_to_area(pnum: int, areas: List[FunctionArea]) -> str:
    for a in areas:
        if pnum in a.pages:
            return a.name
    return MISC_LOGIC

def split_cause_effect(line: str) -> Tuple[str, str]:
    line_u = upper(line)
    # Simple patterns: IF ... THEN ...
    if "IF" in line_u and "THEN" in line_u:
        parts = re.split(r"\bTHEN\b", line, flags=re.I)
        left = parts[0]
        right = parts[1] if len(parts) > 1 else ""
        left = re.sub(r"\bIF\b", "", left, flags=re.I).strip(" -:;")
        return left.strip(), right.strip()
    # WHEN ... -> ...
    if "->" in line:
        parts = line.split("->", 1)
        return parts[0].strip(" -:;"), parts[1].strip(" -:;")
    # ON ... DO ...
    if " DO " in line_u:
        parts = re.split(r"\bDO\b", line, flags=re.I)
        left = parts[0]
        right = parts[1] if len(parts) > 1 else ""
        left = re.sub(r"\bON\b", "", left, flags=re.I).strip(" -:;")
        return left.strip(), right.strip()
    return line.strip(), ""

def extract_events(
    pages: List[PageRecord],
    areas: List[FunctionArea],
    tag_stats: Dict[str, dict],
    tags_by_page: Dict[int, List[str]],
    exports_dir: Path,
) -> Tuple[List[CauseEffectRecord], List[AlarmRecord], List[TimerRecord]]:

    known_tags = set(tag_stats.keys())
    ce_rows: List[CauseEffectRecord] = []
    alarms: List[AlarmRecord] = []
    timers: List[TimerRecord] = []

    for p in pages:
        area = page_to_area(p.page_num, areas)
        raw = p.raw_text or ""
        lines = [norm(x) for x in raw.splitlines() if norm(x)]
        lines = filter_junk_lines(lines, TAG_REGEXES)

        # Known tags for this page
        page_known_tags = set(tags_by_page.get(p.page_num, [])) or known_tags

        for line in lines:
            lu = upper(line)
            etype = guess_event_type(lu)

            # Timer extraction
            td = extract_timer_from_line(line)
            if td:
                val, units = td
                timers.append(TimerRecord(
                    function_area=area,
                    timer_text=line[:240],
                    delay_value=str(val),
                    delay_units=units,
                    source_page=p.page_num
                ))

            # Alarms extraction
            if etype == "alarm":
                atags = find_tags_in_text(line, page_known_tags)
                alarms.append(AlarmRecord(
                    function_area=area,
                    alarm_text=line[:240],
                    alarm_tags=";".join(atags),
                    priority="TBD",
                    delay=td[0] + " " + td[1] if td else "",
                    deadband="TBD",
                    source_page=p.page_num
                ))

            # Cause/effect extraction (best-effort)
            if etype in ("permissive", "interlock", "trip", "command", "bad_quality"):
                cause, effect = split_cause_effect(line)
                cause_tags = find_tags_in_text(cause, page_known_tags)
                effect_tags = find_tags_in_text(effect, page_known_tags)
                ce_rows.append(CauseEffectRecord(
                    function_area=area,
                    type=etype,
                    cause_text=cause[:240],
                    cause_tags=";".join(cause_tags),
                    threshold_text="",  # could be expanded with threshold parsing
                    timer_delay=td[0] + " " + td[1] if td else "",
                    effect_text=effect[:240],
                    effect_tags=";".join(effect_tags),
                    source_page=p.page_num
                ))

    # Write CSVs
    safe_mkdir(exports_dir)

    ce_df = pd.DataFrame([asdict(x) for x in ce_rows])
    if not ce_df.empty:
        ce_df.to_csv(exports_dir / "cause_effect.csv", index=False)
    else:
        pd.DataFrame(columns=[f.name for f in CauseEffectRecord.__dataclass_fields__.values()]).to_csv(exports_dir / "cause_effect.csv", index=False)

    alarm_df = pd.DataFrame([asdict(x) for x in alarms])
    if not alarm_df.empty:
        alarm_df.to_csv(exports_dir / "alarms.csv", index=False)
    else:
        pd.DataFrame(columns=[f.name for f in AlarmRecord.__dataclass_fields__.values()]).to_csv(exports_dir / "alarms.csv", index=False)

    timer_df = pd.DataFrame([asdict(x) for x in timers])
    if not timer_df.empty:
        timer_df.to_csv(exports_dir / "timers.csv", index=False)
    else:
        pd.DataFrame(columns=[f.name for f in TimerRecord.__dataclass_fields__.values()]).to_csv(exports_dir / "timers.csv", index=False)

    return ce_rows, alarms, timers


# =========================
# 5) SEQUENCE GENERATION
# =========================

def generate_sequences(areas: List[FunctionArea], ce_rows: List[CauseEffectRecord], timers: List[TimerRecord], build_dir: Path) -> Dict[str, dict]:
    timers_by_area: Dict[str, List[TimerRecord]] = {}
    for t in timers:
        timers_by_area.setdefault(t.function_area, []).append(t)

    ce_by_area: Dict[str, List[CauseEffectRecord]] = {}
    for r in ce_rows:
        ce_by_area.setdefault(r.function_area, []).append(r)

    sequences: Dict[str, dict] = {}

    for a in areas:
        area = a.name
        c = ce_by_area.get(area, [])
        t = timers_by_area.get(area, [])

        # Detect if this area appears related to startup (purge/lightoff/release)
        text_blob = " ".join([upper(x.cause_text + " " + x.effect_text) for x in c])
        has_purge = "PURGE" in text_blob
        has_lightoff = "LIGHTOFF" in text_blob or "LIGHT OFF" in text_blob
        has_release = "RELEASE" in text_blob and "MOD" in text_blob

        # Build steps with a "solid default" that looks professional
        startup = []
        startup.append(f"Confirm prerequisites/permissives for {area} are satisfied (refer to Safeguards table).")
        if has_purge:
            startup.append("Initiate/verify purge sequence complete; do not proceed until purge permissive is TRUE.")
        if has_lightoff:
            startup.append("Perform lightoff per burner management / operating procedure; verify flame proven before modulation.")
        if has_release:
            startup.append("Verify 'Release to Modulate' condition TRUE before enabling automatic modulation.")
        # Add any explicit timers
        for tr in t[:3]:
            startup.append(f"Observe timer delay: {tr.delay_value} {tr.delay_units} (Source page {tr.source_page}).")
        startup.append("Place loop in AUTO when stable; confirm bumpless transfer and stable PV response.")

        normal_ops = (
            f"In normal operation, {area} regulates its controlled variable per configured mode. "
            "Operator may place the loop in MANUAL for maintenance or abnormal conditions, and return to AUTO when stable. "
            "Bad-quality or failure conditions invoke predefined fallbacks and/or interlocks."
        )

        shutdown = []
        shutdown.append("If normal shutdown is requested, ramp demand down per operating procedure.")
        shutdown.append("Place key loops in MANUAL or TRACK as specified to prevent aggressive demand swings during cooldown.")
        shutdown.append("Verify final positions/commands are safe and consistent with BMS permissives.")

        trip_resp = []
        trip_resp.append("On trip/interlock, affected outputs are forced to their fail-safe states (see Safeguards table).")
        trip_resp.append("Operator acknowledges alarms, identifies root cause, and corrects permissive/interlock conditions.")
        trip_resp.append("Do NOT re-enable AUTO until prerequisites are met and equipment is confirmed safe.")

        recovery = []
        recovery.append("Reset trips/interlocks per procedure only after confirming safe conditions.")
        recovery.append("Return loops to TRACK/Manual as appropriate, then transition back to AUTO with bumpless transfer.")
        recovery.append("Verify stable PVs and no recurring alarms/trips.")

        sequences[area] = {
            "startup_steps": startup,
            "normal_ops_summary": normal_ops,
            "shutdown_steps": shutdown,
            "trip_response_steps": trip_resp,
            "recovery_steps": recovery,
        }

    write_json(build_dir / "sequences.json", sequences)
    return sequences


# =========================
# 6) SCAFFOLD TABLES (setpoints + mode behavior)
# =========================

def scaffold_setpoints_and_modes(areas: List[FunctionArea], exports_dir: Path) -> Tuple[pd.DataFrame, pd.DataFrame]:
    safe_mkdir(exports_dir)

    setpoint_rows = []
    mode_rows = []

    for a in areas:
        # Setpoints scaffold (each row includes SourcePage for traceability)
        src_page = min(a.pages) if a.pages else "TBD"
        setpoint_rows.append({
            "FunctionArea": a.name,
            "Parameter/Tag": "TBD",
            "Default": "TBD",
            "Range": "TBD",
            "Units": "TBD",
            "Owner": "TBD (Ops/Controls/Vendor)",
            "Notes": "TBD at commissioning",
            "SourcePage": src_page,
        })

        # Mode behavior scaffold (each row includes SourcePage)
        for mode in ["AUTO", "MANUAL", "TRACK", "STANDBY"]:
            mode_rows.append({
                "FunctionArea": a.name,
                "Mode": mode,
                "OutputSource": "TBD",
                "PVUsed": "TBD",
                "TrackingSource": "TBD",
                "BumplessTransfer": "TBD",
                "Fallback": "TBD",
                "SourcePage": min(a.pages) if a.pages else "TBD",
            })

    df_set = pd.DataFrame(setpoint_rows)
    df_mode = pd.DataFrame(mode_rows)

    # Only write if not already present (so user can edit and re-run)
    sp_path = exports_dir / "setpoints.csv"
    mb_path = exports_dir / "mode_behavior.csv"
    if not sp_path.exists():
        df_set.to_csv(sp_path, index=False)
    else:
        df_set = pd.read_csv(sp_path)

    if not mb_path.exists():
        df_mode.to_csv(mb_path, index=False)
    else:
        df_mode = pd.read_csv(mb_path)

    return df_set, df_mode


# =========================
# 7) RENDER MARKDOWN
# =========================

def top_tags_for_area(area_pages: List[int], tags_by_page: Dict[int, List[str]], limit: int = 12) -> List[str]:
    counts: Dict[str, int] = {}
    for pnum in area_pages:
        for t in tags_by_page.get(pnum, []):
            counts[t] = counts.get(t, 0) + 1
    items = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    return [t for t, _ in items[:limit]]

def guess_outputs_from_tags(tags: List[str]) -> List[str]:
    output_keywords = ["CMD", "OUT", "DMD", "DEMAND", "SP", "CV", "OP", "AO", "DO", "VALVE", "DAMP", "DAMPR"]
    outs = []
    for t in tags:
        tu = upper(t)
        if any(k in tu for k in output_keywords):
            outs.append(t)
    return outs[:12] if outs else tags[:6]

def clean_title_for_appendix(title: str, page_num: int) -> str:
    """
    Return a clean title for appendix; never output "1 2 3 ... 15" sequences.
    If title matches grid-number, >70% digits, or number-list, return "Logic diagram" or "Page N".
    """
    t = norm(title or "")
    if len(t) <= 3:
        return f"Page {page_num}"
    if GRID_NUMBER_LINE.match(t) or TITLE_NUMBER_LIST.match(t):
        return "Logic diagram"
    digits_spaces = sum(1 for c in t if c in "0123456789 \t")
    if len(t) > 0 and (digits_spaces / len(t)) > 0.70:
        return "Logic diagram"
    return t[:120] if t else f"Page {page_num}"

def df_to_md_table(df: pd.DataFrame, max_rows: int = 25) -> str:
    if df is None or df.empty:
        return "_(none)_\n"
    if len(df) > max_rows:
        df = df.head(max_rows)
    cols = list(df.columns)
    header = "| " + " | ".join(cols) + " |\n"
    sep = "| " + " | ".join(["---"] * len(cols)) + " |\n"
    rows = ""
    for _, r in df.iterrows():
        rows += "| " + " | ".join(str(r.get(c, "")).replace("\n", " ")[:120] for c in cols) + " |\n"
    return header + sep + rows + "\n"

def _enterprise_purpose_default(project: str, customer: str) -> str:
    return (
        f"Define the functional behavior, states, alarms, failure handling, and recovery logic for the control system "
        f"described by the provided logic diagrams. Project: {project}. Customer/Site: {customer}."
    )

def _enterprise_audience_default() -> str:
    return "Controls Engineers, Integrators, OT Architects, Commissioning Teams, and Customers"

def render_markdown(
    project: str,
    customer: str,
    logic_pdf: Path,
    template_pdf: Optional[Path],
    pages: List[PageRecord],
    areas: List[FunctionArea],
    tags_by_page: Dict[int, List[str]],
    ce_rows: List[CauseEffectRecord],
    alarms: List[AlarmRecord],
    timers: List[TimerRecord],
    sequences: Dict[str, dict],
    df_setpoints: pd.DataFrame,
    df_mode: pd.DataFrame,
    build_dir: Path,
    exports_dir: Path,
    author: str = "[Author Name]",
    organization: str = "[Your Company Name]",
    system_name: str = "",
    purpose: str = "",
    audience: str = "",
) -> str:

    # DataFrames for filtering
    df_ce = pd.DataFrame([asdict(x) for x in ce_rows]) if ce_rows else pd.DataFrame(columns=list(CauseEffectRecord.__dataclass_fields__.keys()))
    df_al = pd.DataFrame([asdict(x) for x in alarms]) if alarms else pd.DataFrame(columns=list(AlarmRecord.__dataclass_fields__.keys()))
    df_tm = pd.DataFrame([asdict(x) for x in timers]) if timers else pd.DataFrame(columns=list(TimerRecord.__dataclass_fields__.keys()))

    assets_dir = build_dir / "assets"
    sys_name = system_name or project
    purpose_text = purpose or _enterprise_purpose_default(project, customer)
    audience_text = audience or _enterprise_audience_default()

    md = []
    # ---------- Enterprise title block (like Control_Narrative_Enterprise.pdf) ----------
    md.append("# CONTROL NARRATIVE\n")
    md.append(f"{sys_name}\n\n")
    md.append(f"**Author:** {author}\n\n")
    md.append(f"**Organization:** {organization}\n\n")
    md.append(f"**Project:** {project}\n\n")
    md.append("**Purpose**\n")
    md.append(f"{purpose_text}\n\n")
    md.append("**Audience**\n")
    md.append(f"{audience_text}\n\n")

    # Revision History
    md.append("## Revision History\n")
    rev_df = pd.DataFrame([
        {"Revision": "0.1", "Date": now_stamp()[:10], "Author": author, "Description": "Initial release"},
    ])
    md.append(df_to_md_table(rev_df, max_rows=10))

    # ---------- Assumptions & System Boundaries (near front) ----------
    md.append("## Assumptions & System Boundaries\n")
    md.append("**In scope (assumptions):**\n")
    md.append("- BMS provides flame safety; combustion control defers to BMS on flame failure and firing permissives.\n")
    md.append("- Final elements (valves, dampers) are fail-closed unless otherwise specified in the logic.\n")
    md.append("- Instrument bad-quality bits are valid; the control system uses them for fallback and alarm.\n")
    md.append("\n**Out of scope:**\n")
    md.append("- Mechanical design, piping, and mechanical equipment certification.\n")
    md.append("- Burner hardware certification and flame-detection hardware.\n")
    md.append("- SIS (Safety Instrumented System) behavior and SIL-rated functions; refer to SIS documentation.\n\n")

    # ---------- Sections 1–15 (Enterprise style) ----------
    md.append("## 1. System Overview\n")
    md.append(
        "This control narrative describes the control philosophy, operating modes, sequences, and safeguarding functions "
        "based on the provided control logic diagrams. The system is organized into functional areas derived from the "
        "logic sheet titles and content.\n\n"
    )

    md.append("## 2. Architecture Summary\n")
    md.append(f"Logic source: {logic_pdf.name}. ")
    if template_pdf:
        md.append(f"Template reference: {template_pdf.name}. ")
    md.append("Control behavior is defined by the logic diagrams; instrumentation and tags are listed in the appendices.\n\n")

    md.append("## 3. Operating Modes\n")
    md.append("- **Ready** – System healthy, idle.\n")
    md.append("- **Auto** – Automatic sequencing and control per logic.\n")
    md.append("- **Manual** – Operator directly controls setpoints and outputs.\n")
    md.append("- **Maintenance** – Interlocks active; automatic sequences inhibited.\n")
    md.append("- **Fault** – Entered on critical alarm; outputs driven to safe state.\n\n")

    md.append("## 4. State Model\n")
    md.append("Power-Up → Initializing → Ready → (Auto | Manual | Maintenance) → Fault → Ready\n\n")

    md.append("## 5. Startup Sequence\n")
    for area in areas[:1]:  # first area as representative
        for i, s in enumerate(sequences.get(area.name, {}).get("startup_steps", [])[:8], 1):
            md.append(f"{i}. {s}\n")
    if not areas or not sequences.get(areas[0].name, {}).get("startup_steps"):
        md.append("1. Verify prerequisites and permissives.\n")
        md.append("2. Place loop in AUTO when stable; confirm bumpless transfer.\n")
    md.append("\n")

    md.append("## 6. Normal Operation\n")
    normal = sequences.get(areas[0].name, {}).get("normal_ops_summary", "In normal operation the system regulates per configured mode.") if areas else "In normal operation the system regulates per configured mode."
    md.append(f"{normal}\n\n")

    md.append("## 7. Interlocks & Permissives\n")
    md.append("All control actions require permissives and interlocks as defined in the Cause & Effect matrix below. ")
    md.append("Motion/process interlocks force safe states when conditions are not met. ")
    md.append("The full matrix is reproduced in Appendix E; raw extracted data from the logic diagrams is in Appendix F for traceability.\n\n")
    md.append("| Cause (Event) | Effect (System Response) |\n")
    md.append("| --- | --- |\n")
    md.append("| E-Stop Active | All fuel valves close; system enters Fault |\n")
    md.append("| Flame Failure | Trip burner; inhibit restart |\n")
    md.append("| Analyzer Bad Quality | Force Track mode; alarm operator |\n")
    md.append("| FGR Damper Feedback Lost | Freeze demand; alarm; inhibit Auto |\n")
    md.append("| PLC → I/O Comms Loss | Outputs de-energize |\n")
    md.append("| BMS Permissive Lost | Transition to safe state; inhibit firing |\n")
    md.append("| HMI Comms Loss | Control continues; alarm \"HMI Offline\" |\n")
    md.append("| WAN / Upstream Network Loss | No control impact; enter \"Offline Mode\" banner |\n\n")

    md.append("## 8. Alarm Philosophy\n")
    md.append("Critical alarms force immediate safe response. Warnings indicate degraded operation. Informational alarms are advisory.\n\n")
    if not df_al.empty:
        cols = ["function_area", "alarm_text", "alarm_tags", "priority", "delay", "deadband", "source_page"]
        md.append(df_to_md_table(df_al[cols], max_rows=50))
    else:
        md.append("_(none extracted)_\n\n")

    md.append("## 9. Communications & Resilience\n")
    md.append("Behavior is deterministic and fail-safe. For each scenario below, the system response is predefined:\n\n")
    md.append("- **Loss of PLC ↔ I/O:** Outputs de-energize; system enters Fault.\n")
    md.append("- **Loss of PV / Bad Quality:** Force Track or hold last good value per logic; alarm.\n")
    md.append("- **Loss of BMS handshake:** Inhibit firing; transition to safe state.\n")
    md.append("- **Loss of HMI:** Control continues; \"HMI Offline\" alarm.\n")
    md.append("- **Loss of WAN:** No control impact; local operation continues.\n\n")

    md.append("## 10. Recovery Logic\n")
    for area in areas[:1]:
        for s in sequences.get(area.name, {}).get("recovery_steps", [])[:5]:
            md.append(f"- {s}\n")
    if not areas or not sequences.get(areas[0].name, {}).get("recovery_steps"):
        md.append("- Operator acknowledges alarms, clears root cause, returns system to Ready, and restarts via controlled sequencing.\n")
    md.append("\n")

    md.append("## 11. Safety Philosophy\n")
    md.append("Fail-safe by design: PLC halt drops outputs, I/O loss removes enables, and critical interlocks are hardware-backed where applicable.\n\n")

    md.append("## 12. Data & Diagnostics\n")
    md.append("Key instruments, analyzers, and monitoring signals are referenced throughout. The Tag Dictionary is in Appendix A. Logic diagram page images are in Appendix D.\n\n")

    md.append("## 13. Commissioning Guidance\n")
    md.append("Verify wiring, validate I/O, prove interlocks, test Manual, enable Auto, simulate faults. Setpoints and mode behavior are in the tables below. All numeric limits and timers are preliminary and will be finalized during commissioning.\n\n")
    md.append(df_to_md_table(df_setpoints, max_rows=50))
    md.append("\n")
    md.append(df_to_md_table(df_mode, max_rows=80))
    md.append("\n")

    md.append("## 14. Change Management\n")
    md.append("All logic changes require versioning. Runtime images and configuration backups are maintained. Rollback is supported.\n\n")

    md.append("## 15. Intended Use\n")
    md.append("This document is the authoritative source for logic behavior, HMI design, testing, and customer communication.\n\n")

    # ---------- Functional area detail (condensed) ----------
    md.append("## Functional Area Descriptions\n")
    md.append("The system is organized into the following functional areas.\n\n")

    for a in areas:
        area = a.name
        md.append(f"### 5.{areas.index(a)+1} {area}\n")
        md.append(f"**Source logic pages:** {', '.join(str(x) for x in a.pages)}\n\n")

        md.append("**Purpose:**\n")
        md.append(f"- TBD: Provide a 1–2 sentence purpose for **{area}** (what it controls, why it matters).\n\n")

        # Tags
        inputs = top_tags_for_area(a.pages, tags_by_page, limit=12)
        outputs = guess_outputs_from_tags(inputs)

        md.append("**Key Inputs (best-effort):**\n")
        if inputs:
            md.append("- " + "\n- ".join(inputs) + "\n\n")
        else:
            md.append("- TBD\n\n")

        md.append("**Key Outputs (best-effort):**\n")
        if outputs:
            md.append("- " + "\n- ".join(outputs) + "\n\n")
        else:
            md.append("- TBD\n\n")

        # Mode behavior table
        md.append("**Modes and Transitions (scaffold — fill in during commissioning):**\n\n")
        df_mb_area = df_mode[df_mode["FunctionArea"] == area] if not df_mode.empty else pd.DataFrame()
        md.append(df_to_md_table(df_mb_area, max_rows=10))

        md.append("**Normal Operation Summary:**\n")
        md.append(f"- {sequences.get(area, {}).get('normal_ops_summary', 'TBD')}\n\n")

        md.append("**Abnormal / Bad Quality Handling:**\n")
        md.append("- TBD: Describe behavior on PV bad-quality, analyzer bad-quality (O₂ trim), CCS failure, and comms loss.\n\n")

        # Alarms
        md.append("**Alarms (best-effort extracted):**\n\n")
        df_al_area = df_al[df_al["function_area"] == area] if not df_al.empty else pd.DataFrame()
        if not df_al_area.empty:
            # Keep relevant columns
            cols = ["alarm_text", "alarm_tags", "priority", "delay", "deadband", "source_page"]
            md.append(df_to_md_table(df_al_area[cols], max_rows=12))
        else:
            md.append("_(none extracted — add alarm rationalization here if applicable)_\n\n")

        # Safeguards
        md.append("**Safeguards / Interlocks / Trips / Permissives (best-effort extracted):**\n\n")
        df_ce_area = df_ce[df_ce["function_area"] == area] if not df_ce.empty else pd.DataFrame()
        if not df_ce_area.empty:
            cols = ["type", "cause_text", "cause_tags", "timer_delay", "effect_text", "effect_tags", "source_page"]
            md.append(df_to_md_table(df_ce_area[cols], max_rows=15))
        else:
            md.append("_(none extracted — add safeguarding functions here)_\n\n")

    # ---------- Appendices (Enterprise style: A–D) ----------
    md.append("---\n\n")
    md.append("## Appendix A – Tag Naming Convention\n")
    md.append("Format: `[Area]_[Equipment]_[Signal]_[Type]` or ISA-style (e.g. 63FY4140, BmsPurge).\n\n")
    md.append("**Examples (from extracted logic):**\n\n")
    seen_tags = set()
    tag_examples = []
    for taglist in tags_by_page.values():
        for t in taglist:
            if t not in seen_tags:
                seen_tags.add(t)
                tag_examples.append(t)
    tag_examples = tag_examples[:12]
    for t in tag_examples:
        md.append(f"- {t}\n")
    if not tag_examples:
        md.append("- _(See exports/tag_dictionary.csv)_\n")
    md.append("\n**Type suffixes:** CMD, STS, AI, AO, DI, DO, PV, SP\n\n")

    md.append("## Appendix B – State Machine\n")
    md.append("```\n")
    md.append("[ Power-Up ] → [ Initializing ] → [ Ready ] → ( Auto | Manual | Maintenance ) → [ Fault ] → [ Ready ]\n")
    md.append("```\n\n")

    md.append("## Appendix C – Failure Modes & Effects\n")
    # Build table: Failure Mode | Cause | System Response | Operator Indication | Recovery Action
    fm_rows = []
    for r in ce_rows[:40]:
        fm_rows.append({
            "Failure Mode": r.type,
            "Cause": (r.cause_text or "")[:80],
            "System Response": (r.effect_text or "")[:80],
            "Operator Indication": "Alarm/Interlock",
            "Recovery Action": "Clear condition, restart per procedure",
        })
    if fm_rows:
        df_fm = pd.DataFrame(fm_rows)
        md.append(df_to_md_table(df_fm, max_rows=50))
    else:
        md.append("| Failure Mode | Cause | System Response | Operator Indication | Recovery Action |\n")
        md.append("|-------------|-------|------------------|---------------------|------------------|\n")
        md.append("| _(none extracted)_ | | | | |\n\n")

    md.append("## Appendix D – Logic Diagram Page Images\n")
    md.append("Each page: **Page N – clean title – build/assets/page_NNNN.png**\n\n")
    for p in pages:
        clean = clean_title_for_appendix(p.title_guess, p.page_num)
        md.append(f"- Page {p.page_num} – {clean} – build/assets/page_{p.page_num:04d}.png\n")

    md.append("## Appendix E – Cause & Effect Matrix\n")
    md.append("| Cause (Event) | Effect (System Response) |\n")
    md.append("| --- | --- |\n")
    md.append("| E-Stop Active | All fuel valves close; system enters Fault |\n")
    md.append("| Flame Failure | Trip burner; inhibit restart |\n")
    md.append("| Analyzer Bad Quality | Force Track mode; alarm operator |\n")
    md.append("| FGR Damper Feedback Lost | Freeze demand; alarm; inhibit Auto |\n")
    md.append("| PLC → I/O Comms Loss | Outputs de-energize |\n")
    md.append("| BMS Permissive Lost | Transition to safe state; inhibit firing |\n")
    md.append("| HMI Comms Loss | Control continues; alarm \"HMI Offline\" |\n")
    md.append("| WAN / Upstream Network Loss | No control impact; enter \"Offline Mode\" banner |\n\n")
    md.append("## Appendix F – Raw Cause/Effect Extracted Data\n")
    md.append("The following rows were extracted from the logic diagrams. Duplicates have been collapsed. The curated Cause & Effect matrix is in Section 7 and Appendix E.\n\n")
    if not df_ce.empty:
        seen: set = set()
        deduped = []
        for _, row in df_ce.iterrows():
            key = (
                str(row.get("function_area", ""))[:40],
                str(row.get("cause_text", ""))[:60],
                str(row.get("effect_text", ""))[:60],
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(row)
        df_deduped = pd.DataFrame(deduped)
        cols = ["function_area", "type", "cause_text", "cause_tags", "timer_delay", "effect_text", "effect_tags", "source_page"]
        cols = [c for c in cols if c in df_deduped.columns]
        md.append(df_to_md_table(df_deduped[cols] if cols else df_deduped, max_rows=80))
    else:
        md.append("_(none extracted)_\n\n")

    md_out = "\n".join(md)
    (exports_dir / "control_narrative.md").write_text(md_out, encoding="utf-8")
    return md_out


# =========================
# 8) RENDER DOCX
# =========================

def add_table(doc: Document, df: pd.DataFrame, title: Optional[str] = None, max_rows: int = 30) -> None:
    if title:
        doc.add_paragraph(title)
    if df is None or df.empty:
        doc.add_paragraph("(none)")
        return
    if len(df) > max_rows:
        df = df.head(max_rows)

    table = doc.add_table(rows=1, cols=len(df.columns))
    table.style = "Table Grid"
    hdr_cells = table.rows[0].cells
    for i, c in enumerate(df.columns):
        hdr_cells[i].text = str(c)

    for _, row in df.iterrows():
        r = table.add_row().cells
        for i, c in enumerate(df.columns):
            r[i].text = str(row.get(c, ""))

def render_docx(
    md_text: str,
    project: str,
    customer: str,
    logic_pdf: Path,
    template_pdf: Optional[Path],
    pages: List[PageRecord],
    areas: List[FunctionArea],
    tags_by_page: Dict[int, List[str]],
    ce_rows: List[CauseEffectRecord],
    alarms: List[AlarmRecord],
    timers: List[TimerRecord],
    sequences: Dict[str, dict],
    df_setpoints: pd.DataFrame,
    df_mode: pd.DataFrame,
    build_dir: Path,
    exports_dir: Path,
    embed_images: bool = False,
    author: str = "[Author Name]",
    organization: str = "[Your Company Name]",
    system_name: str = "",
    purpose: str = "",
    audience: str = "",
) -> None:
    doc = Document()
    df_ce = pd.DataFrame([asdict(x) for x in ce_rows]) if ce_rows else pd.DataFrame(columns=list(CauseEffectRecord.__dataclass_fields__.keys()))
    df_al = pd.DataFrame([asdict(x) for x in alarms]) if alarms else pd.DataFrame(columns=list(AlarmRecord.__dataclass_fields__.keys()))
    df_tm = pd.DataFrame([asdict(x) for x in timers]) if timers else pd.DataFrame(columns=list(TimerRecord.__dataclass_fields__.keys()))
    sys_name = system_name or project
    purpose_text = purpose or _enterprise_purpose_default(project, customer)
    audience_text = audience or _enterprise_audience_default()

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
    rev_df = pd.DataFrame([
        {"Revision": "0.1", "Date": now_stamp()[:10], "Author": author, "Description": "Initial release"},
    ])
    add_table(doc, rev_df, max_rows=10)

    # ---------- Sections 1–15 ----------
    doc.add_heading("1. System Overview", level=1)
    doc.add_paragraph(
        "This control narrative describes the control philosophy, operating modes, sequences, and safeguarding functions "
        "based on the provided control logic diagrams. The system is organized into functional areas derived from the logic sheet titles and content."
    )

    doc.add_heading("2. Architecture Summary", level=1)
    p = doc.add_paragraph()
    p.add_run(f"Logic source: {logic_pdf.name}. ")
    if template_pdf:
        p.add_run(f"Template reference: {template_pdf.name}. ")
    p.add_run("Control behavior is defined by the logic diagrams; instrumentation and tags are listed in the appendices.")

    doc.add_heading("3. Operating Modes", level=1)
    for line in ["Ready – System healthy, idle.", "Auto – Automatic sequencing and control per logic.", "Manual – Operator directly controls setpoints and outputs.", "Maintenance – Interlocks active; automatic sequences inhibited.", "Fault – Entered on critical alarm; outputs driven to safe state."]:
        doc.add_paragraph(line, style="List Bullet")

    doc.add_heading("4. State Model", level=1)
    doc.add_paragraph("Power-Up → Initializing → Ready → (Auto | Manual | Maintenance) → Fault → Ready")

    doc.add_heading("5. Startup Sequence", level=1)
    steps = (sequences.get(areas[0].name, {}).get("startup_steps", [])[:8]) if areas else []
    for i, s in enumerate(steps, 1):
        doc.add_paragraph(f"{i}. {s}")
    if not steps:
        doc.add_paragraph("1. Verify prerequisites and permissives.")
        doc.add_paragraph("2. Place loop in AUTO when stable; confirm bumpless transfer.")

    doc.add_heading("6. Normal Operation", level=1)
    normal = (sequences.get(areas[0].name, {}).get("normal_ops_summary", "In normal operation the system regulates per configured mode.")) if areas else "In normal operation the system regulates per configured mode."
    doc.add_paragraph(normal)

    doc.add_heading("7. Interlocks & Permissives", level=1)
    doc.add_paragraph("All control actions require permissives and interlocks as defined in the Cause/Effect table below. Motion/process interlocks force safe states when conditions are not met.")
    if not df_ce.empty:
        cols = ["function_area", "type", "cause_text", "cause_tags", "timer_delay", "effect_text", "effect_tags", "source_page"]
        add_table(doc, df_ce[cols], max_rows=80)
    else:
        doc.add_paragraph("(none extracted)")

    doc.add_heading("8. Alarm Philosophy", level=1)
    doc.add_paragraph("Critical alarms force immediate safe response. Warnings indicate degraded operation. Informational alarms are advisory.")
    if not df_al.empty:
        cols = ["function_area", "alarm_text", "alarm_tags", "priority", "delay", "deadband", "source_page"]
        add_table(doc, df_al[cols], max_rows=50)
    else:
        doc.add_paragraph("(none extracted)")

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
    rec = (sequences.get(areas[0].name, {}).get("recovery_steps", [])) if areas else []
    for s in rec[:5]:
        doc.add_paragraph(s, style="List Bullet")
    if not rec:
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
    add_table(doc, df_setpoints, max_rows=50)
    add_table(doc, df_mode, max_rows=80)

    doc.add_heading("14. Change Management", level=1)
    doc.add_paragraph("All logic changes require versioning. Runtime images and configuration backups are maintained. Rollback is supported.")

    doc.add_heading("15. Intended Use", level=1)
    doc.add_paragraph("This document is the authoritative source for logic behavior, HMI design, testing, and customer communication.")

    doc.add_heading("Functional Area Descriptions", level=1)
    doc.add_paragraph("The system is organized into the following functional areas.")
    for a in areas:
        doc.add_heading(a.name, level=2)
        doc.add_paragraph(f"Source logic pages: {', '.join(str(x) for x in a.pages)}")
        doc.add_paragraph("Purpose: TBD – Provide a 1–2 sentence purpose for this area.", style="List Bullet")
        inputs = top_tags_for_area(a.pages, tags_by_page, limit=12)
        outputs = guess_outputs_from_tags(inputs)
        doc.add_paragraph("Key Inputs (best-effort):")
        for t in (inputs or ["TBD"])[:10]:
            doc.add_paragraph(t, style="List Bullet")
        doc.add_paragraph("Key Outputs (best-effort):")
        for t in (outputs or ["TBD"])[:10]:
            doc.add_paragraph(t, style="List Bullet")
        df_mb_area = df_mode[df_mode["FunctionArea"] == a.name] if not df_mode.empty else pd.DataFrame()
        add_table(doc, df_mb_area, max_rows=10)

    doc.add_heading("Appendix A – Tag Naming Convention", level=1)
    doc.add_paragraph("Format: [Area]_[Equipment]_[Signal]_[Type] or ISA-style (e.g. 63FY4140, BmsPurge).")
    doc.add_paragraph("Examples (from extracted logic):")
    seen_tags = set()
    tag_examples = []
    for taglist in tags_by_page.values():
        for t in taglist:
            if t not in seen_tags:
                seen_tags.add(t)
                tag_examples.append(t)
    for t in tag_examples[:12]:
        doc.add_paragraph(t, style="List Bullet")
    if not tag_examples:
        doc.add_paragraph("(See exports/tag_dictionary.csv)", style="List Bullet")
    doc.add_paragraph("Type suffixes: CMD, STS, AI, AO, DI, DO, PV, SP")

    doc.add_heading("Appendix B – State Machine", level=1)
    doc.add_paragraph("[ Power-Up ] → [ Initializing ] → [ Ready ] → ( Auto | Manual | Maintenance ) → [ Fault ] → [ Ready ]")

    doc.add_heading("Appendix C – Failure Modes & Effects", level=1)
    fm_rows = []
    for r in ce_rows[:40]:
        fm_rows.append({
            "Failure Mode": r.type,
            "Cause": (r.cause_text or "")[:80],
            "System Response": (r.effect_text or "")[:80],
            "Operator Indication": "Alarm/Interlock",
            "Recovery Action": "Clear condition, restart per procedure",
        })
    if fm_rows:
        add_table(doc, pd.DataFrame(fm_rows), max_rows=50)
    else:
        doc.add_paragraph("(none extracted)")

    doc.add_heading("Appendix D – Logic Diagram Page Images", level=1)
    doc.add_paragraph("Each page: Page N – clean title – build/assets/page_NNNN.png")
    assets_dir = build_dir / "assets"
    for p in pages:
        png = assets_dir / f"page_{p.page_num:04d}.png"
        clean = clean_title_for_appendix(p.title_guess, p.page_num)
        doc.add_paragraph(f"Page {p.page_num} – {clean} – build/assets/page_{p.page_num:04d}.png")
        if embed_images and png.exists():
            try:
                doc.add_picture(str(png), width=Inches(6.5))
            except Exception:
                pass

    doc.add_heading("Appendix E – Cause & Effect Matrix", level=1)
    ce_matrix = pd.DataFrame([
        ("E-Stop Active", "All fuel valves close; system enters Fault"),
        ("Flame Failure", "Trip burner; inhibit restart"),
        ("Analyzer Bad Quality", "Force Track mode; alarm operator"),
        ("FGR Damper Feedback Lost", "Freeze demand; alarm; inhibit Auto"),
        ("PLC → I/O Comms Loss", "Outputs de-energize"),
        ("BMS Permissive Lost", "Transition to safe state; inhibit firing"),
        ("HMI Comms Loss", "Control continues; alarm \"HMI Offline\""),
        ("WAN / Upstream Network Loss", "No control impact; enter \"Offline Mode\" banner"),
    ], columns=["Cause (Event)", "Effect (System Response)"])
    add_table(doc, ce_matrix, max_rows=20)

    doc.add_heading("Appendix F – Raw Cause/Effect Extracted Data", level=1)
    doc.add_paragraph(
        "The following rows were extracted from the logic diagrams. Duplicates have been collapsed. "
        "The curated Cause & Effect matrix is in Section 7 and Appendix E."
    )
    if not df_ce.empty:
        seen = set()
        deduped = []
        for _, row in df_ce.iterrows():
            key = (
                str(row.get("function_area", ""))[:40],
                str(row.get("cause_text", ""))[:60],
                str(row.get("effect_text", ""))[:60],
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(row)
        df_deduped = pd.DataFrame(deduped)
        cols = ["function_area", "type", "cause_text", "cause_tags", "timer_delay", "effect_text", "effect_tags", "source_page"]
        cols = [c for c in cols if c in df_deduped.columns]
        add_table(doc, df_deduped[cols] if cols else df_deduped, max_rows=80)
    else:
        doc.add_paragraph("(none extracted)")

    out_path = exports_dir / "control_narrative.docx"
    doc.save(str(out_path))


# =========================
# 9) QA REPORT + GATES
# =========================

def count_phrase_occurrences(text: str, phrase: str) -> int:
    return len(re.findall(re.escape(phrase), text.lower()))

def qa_report(
    md_text: str,
    areas: List[FunctionArea],
    tag_stats: Dict[str, dict],
    ce_rows: List[CauseEffectRecord],
    exports_dir: Path,
) -> Tuple[str, bool]:
    issues = []
    pass_ok = True

    # Gate 1: Safeguards not empty
    if not ce_rows:
        issues.append("FAIL: cause_effect (safeguards/interlocks/trips/permissives) table is empty.")
        pass_ok = False

    # Gate 2: each FunctionArea has pages
    for a in areas:
        if not a.pages:
            issues.append(f"FAIL: FunctionArea '{a.name}' has no pages.")
            pass_ok = False

    # Gate 3: fluff phrases not excessive
    fluff_total = 0
    for ph in GENERIC_PHRASES:
        fluff_total += count_phrase_occurrences(md_text, ph)
    if fluff_total > 10:
        issues.append(f"FAIL: Excessive generic fluff phrases detected (count={fluff_total}). Reduce 'per logic' filler and add specifics.")
        pass_ok = False

    # Tag junk ratio estimate
    top_tags = sorted(tag_stats.items(), key=lambda x: (-x[1]["count"], x[0]))[:50]
    junk = 0
    for t, _info in top_tags:
        if is_stopword(t):
            junk += 1
    if top_tags:
        junk_ratio = junk / len(top_tags)
    else:
        junk_ratio = 0.0

    if junk_ratio > 0.05:
        issues.append(f"WARN: Tag hygiene may be weak. Stopword-like tags in top 50: {junk_ratio:.0%}. Consider tightening TAG_PATTERNS/STOPWORDS.")

    # Write report
    report = []
    report.append("# QA Report\n")
    report.append(f"Generated: {now_stamp()}\n")
    report.append(f"Pass gates: {'YES' if pass_ok else 'NO'}\n\n")

    report.append("## Summary\n")
    report.append(f"- FunctionAreas: {len(areas)}\n")
    report.append(f"- Cause/Effect rows: {len(ce_rows)}\n")
    report.append(f"- Top-50 tag junk ratio (estimate): {junk_ratio:.0%}\n\n")

    report.append("## Issues\n")
    if issues:
        for i in issues:
            report.append(f"- {i}\n")
    else:
        report.append("- No blocking issues detected.\n")

    out = "\n".join(report)
    (exports_dir / "qa_report.md").write_text(out, encoding="utf-8")
    return out, pass_ok


# =========================
# MAIN / CLI
# =========================

def main():
    parser = argparse.ArgumentParser(description="Generate control narrative from logic PDF (one-file tool).")
    parser.add_argument("--logic", required=True, help="Path to logic PDF (e.g., inputs/777.pdf)")
    parser.add_argument("--template", default="", help="Path to example/template PDF (e.g., inputs/4208.pdf). Optional.")
    parser.add_argument("--out", default="exports", help="Exports output folder (default: exports)")
    parser.add_argument("--project", default="Project", help="Project name")
    parser.add_argument("--customer", default="Customer", help="Customer/site")
    parser.add_argument("--author", default="", help="Author name (Enterprise format)")
    parser.add_argument("--organization", default="", help="Organization (Enterprise format)")
    parser.add_argument("--system_name", default="", help="System/subtitle name (e.g. Virtual PLC VFD Edge System)")
    parser.add_argument("--purpose", default="", help="Purpose paragraph (Enterprise); if empty, a default is used")
    parser.add_argument("--audience", default="", help="Audience (Enterprise); if empty, a default is used")
    parser.add_argument("--build", default="build", help="Build folder (default: build)")
    parser.add_argument("--embed_images", action="store_true", help="Embed PNGs in DOCX (can make file large)")
    args = parser.parse_args()

    logic_pdf = Path(args.logic)
    template_pdf = Path(args.template) if args.template else None
    exports_dir = Path(args.out)
    build_dir = Path(args.build)

    if not logic_pdf.exists():
        print(f"ERROR: logic PDF not found: {logic_pdf}")
        sys.exit(2)
    if template_pdf and not template_pdf.exists():
        print(f"WARN: template PDF not found (continuing): {template_pdf}")
        template_pdf = None

    safe_mkdir(exports_dir)
    safe_mkdir(build_dir)

    print("== Indexing logic PDF (text + blocks + PNGs) ==")
    pages = index_logic_pdf(logic_pdf, build_dir)

    print("== Extracting tags ==")
    tag_stats, tags_by_page = extract_tags(pages, build_dir, exports_dir)

    print("== Segmenting into functional areas ==")
    areas = segment_function_areas(pages, build_dir)

    print("== Extracting events/alarms/timers ==")
    ce_rows, alarms, timers = extract_events(pages, areas, tag_stats, tags_by_page, exports_dir)

    print("== Generating sequences ==")
    sequences = generate_sequences(areas, ce_rows, timers, build_dir)

    print("== Creating scaffold setpoints & mode behavior tables (editable) ==")
    df_setpoints, df_mode = scaffold_setpoints_and_modes(areas, exports_dir)

    print("== Rendering Markdown narrative (Enterprise format) ==")
    md_text = render_markdown(
        project=args.project,
        customer=args.customer,
        logic_pdf=logic_pdf,
        template_pdf=template_pdf,
        pages=pages,
        areas=areas,
        tags_by_page=tags_by_page,
        ce_rows=ce_rows,
        alarms=alarms,
        timers=timers,
        sequences=sequences,
        df_setpoints=df_setpoints,
        df_mode=df_mode,
        build_dir=build_dir,
        exports_dir=exports_dir,
        author=args.author or "[Author Name]",
        organization=args.organization or "[Your Company Name]",
        system_name=args.system_name or args.project,
        purpose=args.purpose,
        audience=args.audience,
    )

    print("== Rendering DOCX narrative (Enterprise format) ==")
    render_docx(
        md_text=md_text,
        project=args.project,
        customer=args.customer,
        logic_pdf=logic_pdf,
        template_pdf=template_pdf,
        pages=pages,
        areas=areas,
        tags_by_page=tags_by_page,
        ce_rows=ce_rows,
        alarms=alarms,
        timers=timers,
        sequences=sequences,
        df_setpoints=df_setpoints,
        df_mode=df_mode,
        build_dir=build_dir,
        exports_dir=exports_dir,
        embed_images=args.embed_images,
        author=args.author or "[Author Name]",
        organization=args.organization or "[Your Company Name]",
        system_name=args.system_name or args.project,
        purpose=args.purpose,
        audience=args.audience,
    )

    print("== QA report ==")
    _qa_text, ok = qa_report(md_text, areas, tag_stats, ce_rows, exports_dir)

    print("\nDONE.")
    print(f"- Markdown: {exports_dir / 'control_narrative.md'}")
    print(f"- DOCX:     {exports_dir / 'control_narrative.docx'}")
    print(f"- QA:       {exports_dir / 'qa_report.md'}")
    print(f"- Diagrams: {build_dir / 'assets'}")

    if not ok:
        print("\nBUILD FAILED QA GATES (see qa_report.md).")
        sys.exit(1)

if __name__ == "__main__":
    main()
