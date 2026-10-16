"""HTML -> PDF with fpdf2 and the bundled DejaVu Sans, so Czech diacritics render without system
fonts (the slim Docker image has none)."""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF
from fpdf.fonts import TextStyle

FONTS = Path(__file__).resolve().parent.parent / "fonts"
FAMILY = "DejaVu"
BLACK = (0, 0, 0)

# fpdf2 colours headings and list bullets by default; the clinical layouts are black on white.
TAG_STYLES = {
    "h1": TextStyle(font_family=FAMILY, font_style="B", font_size_pt=15, color=BLACK,
                    t_margin=2, b_margin=3),
    "h2": TextStyle(font_family=FAMILY, font_style="B", font_size_pt=12, color=BLACK,
                    t_margin=4, b_margin=2),
    "h3": TextStyle(font_family=FAMILY, font_style="B", font_size_pt=10, color=BLACK,
                    t_margin=3, b_margin=1),
}


def html_to_pdf(title: str, html: str) -> bytes:
    """A4 PDF of the simple HTML fpdf2 supports (headings, paragraphs, bold, tables, lists)."""
    pdf = FPDF(format="A4")
    pdf.set_title(title)
    pdf.set_creator("Onko-koordinace")
    pdf.add_font(FAMILY, "", FONTS / "DejaVuSans.ttf")
    pdf.add_font(FAMILY, "B", FONTS / "DejaVuSans-Bold.ttf")
    pdf.set_font(FAMILY, size=10)
    pdf.set_auto_page_break(True, margin=15)
    pdf.add_page()
    pdf.write_html(html, font_family=FAMILY, tag_styles=TAG_STYLES, li_prefix_color=BLACK,
                   table_line_separators=True)
    return bytes(pdf.output())
