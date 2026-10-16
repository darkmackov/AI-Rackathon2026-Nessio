"""PDF to plain text through pypdf."""

from __future__ import annotations

import io

from pypdf import PdfReader


def pdf_to_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)
