"""Parse uploads by MIME type; render output documents (MDT record, MDT conclusion)."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from onko_contracts import MdtConclusion, MdtRecord

from .adapters.office import docx_to_md, pptx_to_md
from .adapters.pdf import pdf_to_text
from .adapters.render import typst_to_pdf

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF = "application/pdf"

PARSERS: dict[str, Callable[[bytes], str]] = {
    DOCX: docx_to_md,
    PPTX: pptx_to_md,
    PDF: pdf_to_text,
}

# Output documents and their PDF titles; each has a Typst layout in `templates/<kind>.typ`.
RENDER_KINDS = {
    "mdt_record": "Zápis k jednání multidisciplinárního týmu (MDT)",
    "mdt_conclusion": "Zápis z jednání multidisciplinárního týmu (MDT)",
}


def parse(data: bytes, mime_type: str) -> str:
    """Return plain text / Markdown for a document. Register new formats in PARSERS."""
    try:
        return PARSERS[mime_type](data)
    except KeyError:
        raise ValueError(f"No parser for {mime_type}") from None


def render_pdf(kind: str, data: Mapping[str, Any]) -> bytes:
    """Render an output document (`mdt_record`, `mdt_conclusion`) from JSON-ready data to PDF.
    The layout lives in the Typst template; `title` is added from RENDER_KINDS."""
    if kind not in RENDER_KINDS:
        raise ValueError(f"No layout for {kind}")
    return typst_to_pdf(kind, {**data, "title": RENDER_KINDS[kind]})


def render_mdt_record(record: MdtRecord, conclusion: MdtConclusion | None = None) -> bytes:
    """The MDT record PDF in the `MDT_zapis` layout. Sections 6–7 come from a confirmed
    conclusion only."""
    confirmed = conclusion if conclusion is not None and conclusion.confirmed else None
    return render_pdf("mdt_record", {
        "record": record.model_dump(mode="json"),
        "conclusion": confirmed.model_dump(mode="json") if confirmed else None,
    })


def render_mdt_conclusion(
    conclusion: MdtConclusion, record: MdtRecord | None = None, *, header: Iterable[str] = ()
) -> bytes:
    """The MDT conclusion PDF in the `MDT_zaver` layout; `header` = KOC and board lines."""
    return render_pdf("mdt_conclusion", {
        "conclusion": conclusion.model_dump(mode="json"),
        "record": record.model_dump(mode="json") if record else None,
        "header": [line for line in header if line],
    })
