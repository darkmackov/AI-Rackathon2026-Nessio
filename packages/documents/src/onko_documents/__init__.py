"""Documents module: turn uploaded files into text the AI pipeline can read, and render outputs:
the MDT record (`MDT_zapis`) and the MDT conclusion (`MDT_zaver`) as PDF from Typst templates,
with bundled DejaVu fonts for Czech text (S5, Q-K13).

Owner: stream A. Contract: `onko_contracts.ParsedDocument`.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .adapters.office import CONVERTERS, docx_to_md, pptx_to_md
from .service import (
    DOCX,
    PARSERS,
    PDF,
    PPTX,
    RENDER_KINDS,
    parse,
    render_mdt_conclusion,
    render_mdt_record,
    render_pdf,
)

__all__ = [
    "CONVERTERS",
    "DOCX",
    "PARSERS",
    "PDF",
    "PPTX",
    "RENDER_KINDS",
    "docx_to_md",
    "parse",
    "pptx_to_md",
    "render_mdt_conclusion",
    "render_mdt_record",
    "render_pdf",
]
