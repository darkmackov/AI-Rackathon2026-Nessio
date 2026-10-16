"""Documents module: turn uploaded files into text the AI pipeline can read, and render outputs.

Owner: stream A. Contract: `onko_contracts.ParsedDocument`.
"""

from __future__ import annotations

from collections.abc import Callable

from .office import docx_to_md, pptx_to_md

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF = "application/pdf"


def _pdf_to_text(data: bytes) -> str:
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


PARSERS: dict[str, Callable[[bytes], str]] = {
    DOCX: docx_to_md,
    PPTX: pptx_to_md,
    PDF: _pdf_to_text,
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


__all__ = ["DOCX", "PARSERS", "PDF", "PPTX", "docx_to_md", "parse", "pptx_to_md", "render_pdf"]
