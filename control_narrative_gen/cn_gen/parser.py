"""
Parse logic diagram PDF (logic/functional style) and narrative template PDF.
Extract pages, titles, text, tags, and structure.
"""
import re
import os
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field

# Prefer pdfplumber for text; fallback to PyMuPDF
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    import fitz  # PyMuPDF
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False


@dataclass
class PageContent:
    page_num: int
    text: str
    title: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    timers: list[dict] = field(default_factory=list)
    cause_effect_hints: list[dict] = field(default_factory=list)


# Known functional area patterns (from 777-style logic)
FUNCTIONAL_AREA_PATTERNS = [
    r"Steam\s*Pressure\s*Control",
    r"Steam\s*Pressure\s*Control\s*Discrete\s*Logic",
    r"Fuel\s*&\s*Combustion\s*Air\s*Flow\s*Setpoints",
    r"Combustion\s*Air\s*Flow\s*Control",
    r"Combustion\s*Air\s*Flow\s*.*Discrete\s*Logic",
    r"Fuel\s*Gas\s*Flow\s*Control",
    r"Fuel\s*Gas\s*Flow\s*.*Discrete\s*Logic",
    r"Oxygen\s*Trim\s*Control",
    r"Oxygen\s*Trim\s*.*Discrete\s*Logic",
    r"Furnace\s*Draft.*Pressure\s*Control",
    r"Furnace\s*Pressure.*Discrete\s*Logic",
    r"Combustion\s*Control\s*System\s*Failure\s*Logic",
    r"Drum\s*Level\s*Control",
    r"Drum\s*Level\s*.*Discrete\s*Logic",
    r"FGR\s*/\s*Fresh\s*Air\s*Damper\s*Control",
    r"FGR.*Damper",
    r"Discrete\s*Logic",
]

# Tag/signal regex: alphanumeric + underscores, common P&ID style (e.g. 63PC4102, MasterDemand, BmsRelToMod)
TAG_PATTERN = re.compile(
    r"\b([A-Z]{2,}[a-zA-Z0-9_]*|"
    r"\d{2}[A-Z]{2}\d{4}[A-Za-z0-9_]*|"
    r"[A-Z][a-z]+[A-Z][a-zA-Z0-9_]*|"
    r"[A-Za-z_][A-Za-z0-9_]{2,})\b"
)

# Timer extraction: "ON DELAY TIMER 15 sec", "5 sec", "30 sec delay"
TIMER_PATTERN = re.compile(
    r"(?:ON\s*DELAY\s*TIMER|OFF\s*DELAY|TIMER|DELAY)\s*[:\s]*(\d+)\s*(sec|s|min|m)?",
    re.IGNORECASE
)
TIMER_SIMPLE = re.compile(r"\b(\d+)\s*(sec|s|min|minute)\b", re.IGNORECASE)

# Cause/effect keywords
CAUSE_EFFECT_KEYWORDS = [
    "trip", "alarm", "AL ", "permissive", "To BMS", "Release to modulate",
    "Release to Modulate", "Purge", "Burner firing", "bad quality", "deviation",
    "interlock", "fail", "shutdown", "block"
]


def _extract_with_pdfplumber(pdf_path: str) -> list[PageContent]:
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, pg in enumerate(pdf.pages):
            pnum = i + 1
            text = pg.extract_text() or ""
            title = _detect_title(text)
            tags = list(dict.fromkeys(TAG_PATTERN.findall(text)))
            timers = _extract_timers(text)
            hints = _extract_cause_effect_hints(text, pnum)
            pages.append(PageContent(
                page_num=pnum,
                text=text,
                title=title,
                tags=tags,
                timers=timers,
                cause_effect_hints=hints
            ))
    return pages


def _extract_with_fitz(pdf_path: str) -> list[PageContent]:
    pages = []
    doc = fitz.open(pdf_path)
    for i in range(len(doc)):
        page = doc[i]
        pnum = i + 1
        text = page.get_text()
        title = _detect_title(text)
        tags = list(dict.fromkeys(TAG_PATTERN.findall(text)))
        timers = _extract_timers(text)
        hints = _extract_cause_effect_hints(text, pnum)
        pages.append(PageContent(
            page_num=pnum,
            text=text,
            title=title,
            tags=tags,
            timers=timers,
            cause_effect_hints=hints
        ))
    doc.close()
    return pages


def _detect_title(text: str) -> Optional[str]:
    """Detect sheet/loop title from first lines or known patterns."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for line in lines[:8]:
        for pat in FUNCTIONAL_AREA_PATTERNS:
            if re.search(pat, line, re.IGNORECASE):
                return line
    if lines:
        # First non-empty line is often the title
        first = lines[0]
        if len(first) < 80 and not first.startswith("http"):
            return first
    return None


def _extract_timers(text: str) -> list[dict]:
    out = []
    for m in TIMER_PATTERN.finditer(text):
        val, unit = m.group(1), (m.group(2) or "sec").lower()
        out.append({"value": int(val), "unit": unit, "context": m.group(0)[:60]})
    for m in TIMER_SIMPLE.finditer(text):
        val, unit = m.group(1), (m.group(2) or "sec").lower()
        # Avoid random numbers (e.g. line numbers)
        if int(val) <= 300:
            out.append({"value": int(val), "unit": unit, "context": m.group(0)})
    return out


def _extract_cause_effect_hints(text: str, page_num: int) -> list[dict]:
    hints = []
    upper = text.upper()
    for kw in CAUSE_EFFECT_KEYWORDS:
        if kw.upper() in upper:
            # Find sentence or line containing keyword
            for line in text.splitlines():
                if kw.lower() in line.lower():
                    hints.append({
                        "keyword": kw,
                        "line": line.strip()[:200],
                        "page": page_num
                    })
                    break
    return hints


def parse_logic_pdf(pdf_path: str) -> list[PageContent]:
    """Parse logic diagram PDF (777). Returns list of PageContent."""
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"Logic PDF not found: {pdf_path}")
    if HAS_PDFPLUMBER:
        return _extract_with_pdfplumber(str(path))
    if HAS_FITZ:
        return _extract_with_fitz(str(path))
    raise RuntimeError("Need pdfplumber or PyMuPDF (fitz). Install with: pip install pdfplumber pymupdf")


def parse_template_pdf(pdf_path: str) -> list[PageContent]:
    """Parse narrative template PDF for structure reference."""
    path = Path(pdf_path)
    if not path.exists():
        return []
    if HAS_PDFPLUMBER:
        return _extract_with_pdfplumber(str(path))
    if HAS_FITZ:
        return _extract_with_fitz(str(path))
    return []


def export_pages_to_png(pdf_path: str, out_dir: str) -> list[str]:
    """Export each page of PDF to PNG. Returns list of output paths."""
    if not HAS_FITZ:
        return []
    path = Path(pdf_path)
    if not path.exists():
        return []
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    doc = fitz.open(str(path))
    for i in range(len(doc)):
        page = doc[i]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        png_path = out / f"page_{i+1:04d}.png"
        pix.save(str(png_path))
        paths.append(str(png_path))
    doc.close()
    return paths
