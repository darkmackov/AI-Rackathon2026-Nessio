"""Shared API test helpers: a fake model that answers every structured call offline (TEST-3)."""

from __future__ import annotations

import re
import unicodedata
import zlib

from onko_ai import DocExtraction, DocMetaDraft
from onko_ai.models import (
    AnswerDraft,
    Certainty,
    ClinicalReview,
    FieldClaim,
    FieldPath,
    QuoteRef,
    ReferenceMatches,
)
from onko_contracts import DocumentType

# Claims the fake makes about the GP's referral 07; each quote is verbatim in the document.
ALLERGIES = FieldClaim(
    path=FieldPath.ALLERGIES,
    value="neguje",
    items=None,
    quotes=["AA: neguje"],
    certainty=Certainty.UNSPECIFIED,
)


def claim(path: FieldPath, value: str, quote: str) -> FieldClaim:
    return FieldClaim(path=path, value=value, items=None, quotes=[quote], certainty=Certainty.UNSPECIFIED)


def bag_of_words(text: str, dim: int = 64) -> list[float]:
    """Deterministic stand-in for an embedding: hashed word counts, diacritics and case ignored."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold()
    vector = [0.0] * dim
    for word in re.findall(r"\w{3,}", folded):
        vector[zlib.crc32(word.encode()) % dim] += 1.0
    return vector


class FakeGateway:
    """`answer_quote`: what 'ask the case' quotes from every excerpt it is shown (verified after)."""

    active = "fake"

    def __init__(self, fields: list[FieldClaim] | None = None, *, can_embed: bool = True,
                 answer_quote: str = "AA: neguje"):
        self.fields = fields if fields is not None else [ALLERGIES]
        self.can_embed = can_embed
        self.answer_quote = answer_quote

    def embed(self, texts):
        assert self.can_embed
        return [bag_of_words(t) for t in texts]

    def _answer(self, messages) -> AnswerDraft:
        ids = re.findall(r"\[document ([^\]]+)\]", messages[-1]["content"])
        return AnswerDraft(quotes=[QuoteRef(document_id=i, quote=self.answer_quote)
                                   for i in dict.fromkeys(ids)])

    def complete(self, messages, schema=None, *, slot=None):
        if schema is AnswerDraft:
            return self._answer(messages)
        return {
            DocMetaDraft: DocMetaDraft(
                title="Epikríza a žádost",
                doc_type=DocumentType.REFERRAL,
                document_date="2026-10-02",
                facility="Ordinace PL",
                department=None,
                author="MUDr. Tomáš Řezníček",
                ordered_by=None,
            ),
            DocExtraction: DocExtraction(
                fields=self.fields,
                examinations=[],
                labs=[],
                epicrisis_start_quote=None,
                epicrisis_end_quote=None,
                events=[],
                referenced_results=[],
            ),
            ReferenceMatches: ReferenceMatches(matches=[]),
            ClinicalReview: ClinicalReview(notes=[]),
        }[schema]
