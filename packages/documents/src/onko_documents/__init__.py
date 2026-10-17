"""Documents module: turn uploaded files into text the AI pipeline can read, warn about duplicate
uploads (SHA-256 for exact copies, word-shingle overlap for near ones, Q-I22), and render outputs:
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
    find_duplicates,
    parse,
    render_mdt_conclusion,
    render_mdt_record,
    render_pdf,
    sha256,
)

__all__ = [
    "CONVERTERS",
    "DOCX",
    "PARSERS",
    "PDF",
    "PPTX",
    "RENDER_KINDS",
    "docx_to_md",
    "find_duplicates",
    "parse",
    "pptx_to_md",
    "render_mdt_conclusion",
    "render_mdt_record",
    "render_pdf",
    "sha256",
]
