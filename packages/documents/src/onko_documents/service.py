"""Parse uploads by MIME type; render output documents."""

from __future__ import annotations

from collections.abc import Callable

from .adapters.office import docx_to_md, pptx_to_md
from .adapters.pdf import pdf_to_text

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF = "application/pdf"

PARSERS: dict[str, Callable[[bytes], str]] = {
    DOCX: docx_to_md,
    PPTX: pptx_to_md,
    PDF: pdf_to_text,
}


def parse(data: bytes, mime_type: str) -> str:
    """Return plain text / Markdown for a document. Register new formats in PARSERS."""
    try:
        return PARSERS[mime_type](data)
    except KeyError:
        raise ValueError(f"No parser for {mime_type}") from None


def render_pdf(kind: str, html: str) -> bytes:
    """Render an output document (MDT record, MDT conclusion) to PDF. TODO stream A."""
    raise NotImplementedError
