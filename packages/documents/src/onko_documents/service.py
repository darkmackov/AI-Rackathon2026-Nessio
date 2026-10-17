"""Parse uploads by MIME type; warn about duplicate uploads; render output documents (MDT record,
MDT conclusion)."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from onko_contracts import DuplicateKind, DuplicateMatch, MdtConclusion, MdtRecord, match_text
from onko_repository import CaseRepository

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


# Duplicate uploads (Q-I22): exact copies by hash, near copies by word-shingle overlap of the text
SHINGLE_WORDS = 5
NEAR_DUPLICATE = 0.8  # Jaccard; a resent report matches, reports sharing a template mostly don't


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def shingles(text: str, size: int = SHINGLE_WORDS) -> set[tuple[str, ...]]:
    """Runs of `size` words of the text normalized for matching (case ignored); a shorter text is
    one shingle."""
    words = re.findall(r"\w+", match_text(text).text.casefold())
    if len(words) <= size:
        return {tuple(words)} if words else set()
    return {tuple(words[i : i + size]) for i in range(len(words) - size + 1)}


def similarity(a: set[tuple[str, ...]], b: set[tuple[str, ...]]) -> float:
    """Jaccard overlap of two shingle sets."""
    return len(a & b) / len(a | b) if a and b else 0.0


def find_duplicates(
    repo: CaseRepository, case_id: str, data: bytes, text: str
) -> list[DuplicateMatch]:
    """The case's earlier documents a new upload duplicates, closest first. A warning only, never a
    reason to refuse the upload (Q-I22). Not by embeddings: reports from one department share a
    template and would all look alike."""
    digest = sha256(data)
    new = shingles(text)
    matches = []
    for meta in repo.list_documents(case_id):
        earlier = meta.sha256 or sha256(repo.document_data(meta.id) or b"")
        if earlier == digest:
            matches.append(DuplicateMatch(document_id=meta.id, filename=meta.filename,
                                          kind=DuplicateKind.EXACT, similarity=1.0))
            continue
        score = similarity(new, shingles(repo.document_text(meta.id)))
        if score >= NEAR_DUPLICATE:
            matches.append(DuplicateMatch(document_id=meta.id, filename=meta.filename,
                                          kind=DuplicateKind.NEAR, similarity=round(score, 3)))
    return sorted(matches, key=lambda m: -m.similarity)


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
