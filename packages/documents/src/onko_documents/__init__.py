"""Documents module: turn uploaded files into text the AI pipeline can read, and render outputs.

Owner: stream A. Contract: `onko_contracts.ParsedDocument`.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .adapters.office import CONVERTERS, docx_to_md, pptx_to_md
from .service import DOCX, PARSERS, PDF, PPTX, parse, render_pdf

__all__ = [
    "CONVERTERS",
    "DOCX",
    "PARSERS",
    "PDF",
    "PPTX",
    "docx_to_md",
    "parse",
    "pptx_to_md",
    "render_pdf",
]
