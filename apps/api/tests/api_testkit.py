"""Shared API test helpers: a fake model that answers every structured call offline (TEST-3)."""

from __future__ import annotations

from onko_ai import DocExtraction, DocMetaDraft
from onko_ai.models import Certainty, ClinicalReview, FieldClaim, FieldPath, ReferenceMatches
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


class FakeGateway:
    active = "fake"

    def __init__(self, fields: list[FieldClaim] | None = None):
        self.fields = fields if fields is not None else [ALLERGIES]

    def complete(self, messages, schema=None, *, slot=None):
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
