"""
Orchestrate parsing, narrative generation, and all exports.
"""
import os
from pathlib import Path
from typing import Optional

from .parser import parse_logic_pdf, parse_template_pdf, export_pages_to_png
from .extractors import build_tag_dictionary, build_cause_effect_table
from .narrative import build_full_narrative_md, setpoint_rows_from_pages
from .export_docx import export_docx
from .export_pdf import export_pdf_from_md


def run(
    logic_pdf: str,
    template_pdf: Optional[str],
    out_dir: str,
    project: str,
    customer: str,
    author: str = "[Author Name]",
    organization: str = "[Your Company Name]",
    system_name: str = "",
    purpose: str = "",
    audience: str = "",
) -> dict:
    """
    Run full pipeline: parse -> narrative -> tag/cause-effect -> md, docx, pdf, csv, diagrams.
    Returns dict with keys: md_path, docx_path, pdf_path, tag_csv_path, cause_effect_csv_path, diagram_paths, errors.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    results = {
        "md_path": None,
        "docx_path": None,
        "pdf_path": None,
        "tag_csv_path": None,
        "cause_effect_csv_path": None,
        "diagram_paths": [],
        "errors": [],
    }

    # 1) Parse logic PDF
    try:
        pages = parse_logic_pdf(logic_pdf)
    except Exception as e:
        results["errors"].append(f"Parse logic PDF: {e}")
        return results

    if not pages:
        results["errors"].append("No pages extracted from logic PDF")
        return results

    # 2) Optional: parse template (for structure; we use hardcoded sections)
    if template_pdf and Path(template_pdf).exists():
        parse_template_pdf(template_pdf)

    # 3) Tag dictionary and cause-effect
    tag_rows = build_tag_dictionary(pages)
    cause_effect_rows = build_cause_effect_table(pages)

    # 4) Narrative Markdown (Section 5 loop-based; cause/effect + setpoint tables embedded)
    md_content = build_full_narrative_md(pages, project=project, customer=customer, cause_effect_rows=cause_effect_rows)
    md_path = out / "control_narrative.md"
    md_path.write_text(md_content, encoding="utf-8")
    results["md_path"] = str(md_path)

    # 5) Export diagrams (PNG per page)
    diagrams_dir = out / "diagrams"
    try:
        diagram_paths = export_pages_to_png(logic_pdf, str(diagrams_dir))
        results["diagram_paths"] = diagram_paths
    except Exception as e:
        results["errors"].append(f"Export diagrams: {e}")

    # 6) DOCX
    docx_path = out / "control_narrative.docx"
    try:
        setpoint_rows = setpoint_rows_from_pages(pages)
        export_docx(
            md_content=md_content,
            tag_rows=tag_rows,
            cause_effect_rows=cause_effect_rows,
            setpoint_rows=setpoint_rows,
            diagrams_dir=str(diagrams_dir),
            out_path=str(docx_path),
            project=project,
            customer=customer,
            pages=pages,
            author=author,
            organization=organization,
            system_name=system_name or project,
            purpose=purpose,
            audience=audience,
        )
        results["docx_path"] = str(docx_path)
    except Exception as e:
        results["errors"].append(f"DOCX export: {e}")

    # 7) PDF (optional) — skip on any error so MD/DOCX/CSVs/diagrams still return
    pdf_path = out / "control_narrative.pdf"
    try:
        if export_pdf_from_md(md_content, str(pdf_path), project, customer):
            results["pdf_path"] = str(pdf_path)
        else:
            results["errors"].append(
                "PDF export skipped: install reportlab and ensure content is valid, or use DOCX/MD."
            )
    except Exception as e:
        results["errors"].append(f"PDF export failed: {e}")

    # 8) Tag dictionary CSV
    try:
        import pandas as pd
        tag_csv_path = out / "tag_dictionary.csv"
        pd.DataFrame(tag_rows).to_csv(tag_csv_path, index=False)
        results["tag_csv_path"] = str(tag_csv_path)
    except ImportError:
        import csv
        tag_csv_path = out / "tag_dictionary.csv"
        with open(tag_csv_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["LoopPage", "Tag", "Description", "SourcePage"])
            w.writeheader()
            w.writerows(tag_rows)
        results["tag_csv_path"] = str(tag_csv_path)
    except Exception as e:
        results["errors"].append(f"Tag CSV: {e}")

    # 9) Cause-effect CSV
    try:
        import pandas as pd
        ce_path = out / "cause_effect.csv"
        pd.DataFrame(cause_effect_rows).to_csv(ce_path, index=False)
        results["cause_effect_csv_path"] = str(ce_path)
    except ImportError:
        import csv
        ce_path = out / "cause_effect.csv"
        cols = ["FunctionArea", "CauseSignal", "Condition/Threshold", "TimerDelay", "EffectSignal", "EffectDescription", "SourcePage"]
        with open(ce_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(cause_effect_rows)
        results["cause_effect_csv_path"] = str(ce_path)
    except Exception as e:
        results["errors"].append(f"Cause-effect CSV: {e}")

    return results
