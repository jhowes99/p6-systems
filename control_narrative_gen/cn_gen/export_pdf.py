"""
Optional PDF export. Uses reportlab for simple narrative text.
We do not replicate full DOCX layout here; we produce a readable text PDF.
Markdown tables (e.g. Cause & Effect Matrix, Revision History) are rendered as
structured reportlab Tables with header styling and grid.
If reportlab is missing or causes issues, PDF is skipped and the CLI documents why.
"""
from pathlib import Path
import html


def _esc(s: str) -> str:
    """Escape <, >, & for reportlab Paragraph markup so raw narrative text doesn't break the parser."""
    return html.escape(s, quote=True)


def _flush_table(story, table_rows, styles, inch):
    """Build a reportlab Table from buffered markdown table rows and append to story."""
    if not table_rows:
        return
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors

    # Normalize column count (in case separator row was skipped, we already have consistent rows)
    ncols = max(len(r) for r in table_rows)
    data = []
    for i, row in enumerate(table_rows):
        cells = list(row) + [""] * (ncols - len(row))
        cell_style = styles["TableHeader"] if i == 0 else styles["TableBody"]
        data.append([Paragraph(_esc(c), cell_style) for c in cells])

    # Reasonable column widths: ~6.5" usable width
    avail = 6.5 * inch
    col_widths = [avail / ncols] * ncols
    # Cause & Effect (2 cols): give more space to Effect
    if ncols == 2:
        col_widths = [2.0 * inch, 4.5 * inch]

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.grey),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 12))


def export_pdf_from_md(md_content: str, out_path: str, project: str, customer: str) -> bool:
    """Generate a simple PDF from markdown narrative. Returns True if successful."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.units import inch
    except ImportError:
        return False

    try:
        path = Path(out_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        doc = SimpleDocTemplate(
            str(path),
            pagesize=letter,
            rightMargin=inch,
            leftMargin=inch,
            topMargin=inch,
            bottomMargin=inch,
        )
        styles = getSampleStyleSheet()
        styles.add(ParagraphStyle(name="Small", fontSize=9, spaceAfter=6))
        styles.add(ParagraphStyle(name="TableHeader", fontSize=9, fontName="Helvetica-Bold", spaceAfter=0, spaceBefore=0))
        styles.add(ParagraphStyle(name="TableBody", fontSize=9, spaceAfter=0, spaceBefore=0))

        story = []
        table_rows = []  # buffer consecutive markdown table rows

        for line in md_content.splitlines():
            line_stripped = line.strip()

            if "|" in line_stripped and line_stripped.startswith("|"):
                cells = [c.strip() for c in line_stripped.split("|") if c.strip()]
                if cells:
                    # Skip separator rows (---)
                    if all(c.replace("-", "").strip() == "" for c in cells):
                        continue
                    table_rows.append(cells)
                continue

            # Non-table line: flush any buffered table, then handle the line
            if table_rows:
                _flush_table(story, table_rows, styles, inch)
                table_rows = []

            if not line_stripped:
                story.append(Spacer(1, 6))
                continue
            if line_stripped.startswith("# "):
                story.append(Paragraph(_esc(line_stripped[2:]), styles["Heading1"]))
            elif line_stripped.startswith("## "):
                story.append(Paragraph(_esc(line_stripped[3:]), styles["Heading2"]))
            elif line_stripped.startswith("**") and line_stripped.endswith("**"):
                story.append(Paragraph("<b>" + _esc(line_stripped[2:-2]) + "</b>", styles["Normal"]))
            elif line_stripped.startswith("- "):
                story.append(Paragraph("&#8226; " + _esc(line_stripped[2:]), styles["Normal"]))
            else:
                t = line_stripped
                if "**" in t:
                    parts = []
                    rest = t
                    while rest:
                        i = rest.find("**")
                        if i < 0:
                            parts.append(_esc(rest))
                            break
                        parts.append(_esc(rest[:i]))
                        rest = rest[i + 2:]
                        j = rest.find("**")
                        if j < 0:
                            parts.append(_esc("**" + rest))
                            break
                        parts.append("<b>" + _esc(rest[:j]) + "</b>")
                        rest = rest[j + 2:]
                    t = "".join(parts)
                else:
                    t = _esc(t)
                story.append(Paragraph(t, styles["Normal"]))

        if table_rows:
            _flush_table(story, table_rows, styles, inch)

        doc.build(story)
        return True
    except Exception:
        return False
