"""
Extract tag dictionary and cause-effect table from parsed logic pages.
Tag hygiene (regex + stopwords) is applied so tag/signal lists exclude random words.
"""
import re
from collections import defaultdict
from .parser import PageContent, TAG_PATTERN, CAUSE_EFFECT_KEYWORDS
from .narrative import apply_tag_hygiene


def build_tag_dictionary(pages: list[PageContent]) -> list[dict]:
    """Build tag dictionary: Loop/Page, Tag, Description (placeholder), SourcePage. Uses tag hygiene."""
    rows = []
    seen = set()
    for p in pages:
        area = p.title or f"Page_{p.page_num}"
        tags = apply_tag_hygiene(p.tags)
        for tag in tags:
            key = (area, tag)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "LoopPage": area,
                "Tag": tag,
                "Description": "",  # Could enrich from context later
                "SourcePage": p.page_num,
            })
    return rows


def build_cause_effect_table(pages: list[PageContent]) -> list[dict]:
    """Build cause-effect CSV: FunctionArea, CauseSignal, Condition, TimerDelay, EffectSignal, EffectDescription, SourcePage."""
    rows = []
    for p in pages:
        area = p.title or f"Page_{p.page_num}"
        for h in p.cause_effect_hints:
            # Try to infer cause/effect from line and nearby tags
            line = h.get("line", "")
            tags_in_line = TAG_PATTERN.findall(line)
            cause = tags_in_line[0] if tags_in_line else ""
            effect = tags_in_line[1] if len(tags_in_line) > 1 else h.get("keyword", "")
            cond = line[:150] if line else h.get("keyword", "")
            timer = _extract_timer_from_line(line)
            rows.append({
                "FunctionArea": area,
                "CauseSignal": cause,
                "Condition/Threshold": cond,
                "TimerDelay": timer,
                "EffectSignal": effect,
                "EffectDescription": line[:200] if line else "",
                "SourcePage": p.page_num,
            })
    return rows


def _extract_timer_from_line(line: str) -> str:
    m = re.search(r"(\d+)\s*(sec|s|min)", line, re.IGNORECASE)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return ""
