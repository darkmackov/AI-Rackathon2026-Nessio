"""Offline test helpers: small invented documents and a fake gateway that returns canned model output."""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
import zlib
from collections.abc import Callable

from onko_ai import DocExtraction
from onko_ai.models import Certainty, FieldClaim, FieldPath
from onko_contracts import DocumentMeta, DocumentType, ParsedDocument
from pydantic import BaseModel

NOW = dt.datetime(2026, 11, 2, 9, 0)


def make_doc(
    doc_id: str,
    text: str,
    date: dt.date,
    doc_type: DocumentType = DocumentType.OUTPATIENT_REPORT,
    title: str | None = None,
) -> ParsedDocument:
    meta = DocumentMeta(
        id=doc_id,
        filename=f"{doc_id}.docx",
        title=title or f"Zpráva {doc_id}",
        doc_type=doc_type,
        document_date=date,
        received_at=dt.datetime.combine(date, dt.time(12)),
    )
    return ParsedDocument(meta=meta, text=text)


def bag_of_words(text: str, dim: int = 64) -> list[float]:
    """A deterministic stand-in for an embedding: hashed word counts (diacritics and case ignored),
    so texts sharing words are close."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold()
    vector = [0.0] * dim
    for word in re.findall(r"\w{3,}", folded):
        vector[zlib.crc32(word.encode()) % dim] += 1.0
    return vector


class FakeGateway:
    """Answers `complete` by schema: `answers[Schema]` is a value or a function of the messages.
    `embed` is `bag_of_words`."""

    can_embed = True

    def __init__(self, answers: dict[type[BaseModel], object]):
        self.answers = answers
        self.seen: list[tuple[type[BaseModel] | None, list[dict]]] = []
        self.embedded: list[str] = []

    def embed(self, texts):
        self.embedded.extend(texts)
        return [bag_of_words(t) for t in texts]

    def complete(self, messages, schema=None, *, slot=None):
        self.seen.append((schema, messages))
        answer = self.answers[schema]
        return answer(messages) if isinstance(answer, Callable) else answer


def claim(
    path: FieldPath, value: str | None, *quotes: str, items=None, certainty=Certainty.UNSPECIFIED
) -> FieldClaim:
    return FieldClaim(path=path, value=value, items=items, quotes=list(quotes), certainty=certainty)


def out(*fields: FieldClaim, **kw) -> DocExtraction:
    """A model answer for one document: the given field claims plus any other parts as keywords."""
    base = {
        "fields": list(fields),
        "examinations": [],
        "labs": [],
        "epicrisis_start_quote": None,
        "epicrisis_end_quote": None,
        "events": [],
        "referenced_results": [],
    }
    return DocExtraction(**(base | kw))
