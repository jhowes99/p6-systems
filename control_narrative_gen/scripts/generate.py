#!/usr/bin/env python3
"""
CLI: Generate control narratives from Logic/functional diagrams PDF (and optional template).
Usage:
  python scripts/generate.py --logic inputs/logic_diagrams.pdf [--template inputs/template.pdf] --out exports --project "..." --customer "..."
"""
import argparse
import sys
from pathlib import Path

# Run from project root (control_narrative_gen); add parent so cn_gen is importable
_root = Path(__file__).resolve().parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from cn_gen.runner import run


def main():
    ap = argparse.ArgumentParser(description="Generate control narratives from Logic/functional diagrams PDF (template optional).")
    ap.add_argument("--logic", required=True, help="Path to logic/functional diagrams PDF (e.g. inputs/logic_diagrams.pdf)")
    ap.add_argument("--template", default=None, help="Path to control narrative template PDF (optional; e.g. inputs/template.pdf)")
    ap.add_argument("--out", default="exports", help="Output directory (default: exports)")
    ap.add_argument("--project", default="Combustion Control System, Fully Metered", help="Project name")
    ap.add_argument("--customer", default="TotalEnergies Port Arthur, TX.", help="Customer name")
    args = ap.parse_args()

    res = run(
        logic_pdf=args.logic,
        template_pdf=args.template if args.template else None,
        out_dir=args.out,
        project=args.project,
        customer=args.customer,
    )

    # Write result for server (e.g. PDF created, warnings)
    try:
        import json
        result_path = Path(args.out) / ".narrative_result.json"
        result_path.write_text(
            json.dumps({
                "pdf_created": bool(res.get("pdf_path")),
                "errors": res.get("errors", []),
            }),
            encoding="utf-8",
        )
    except Exception:
        pass

    # Print outputs
    for k in ["md_path", "docx_path", "pdf_path", "tag_csv_path", "cause_effect_csv_path"]:
        if res.get(k):
            print(f"Created: {res[k]}")
    if res.get("diagram_paths"):
        print(f"Diagrams: {len(res['diagram_paths'])} PNGs in exports/diagrams/")

    if res.get("errors"):
        for e in res["errors"]:
            print(f"Warning: {e}", file=sys.stderr)

    # Exit 0 if we produced at least MD + one of DOCX/CSV
    ok = bool(res.get("md_path") and (res.get("docx_path") or res.get("tag_csv_path")))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
