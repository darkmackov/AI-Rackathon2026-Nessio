"""Offline test helpers: small invented documents and a fake gateway that returns canned model output."""

from __future__ import annotations

import datetime as dt
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


class FakeGateway:
    """Answers `complete` by schema: `answers[Schema]` is a value or a function of the messages."""

    def __init__(self, answers: dict[type[BaseModel], object]):
        self.answers = answers
        self.seen: list[tuple[type[BaseModel] | None, list[dict]]] = []

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
