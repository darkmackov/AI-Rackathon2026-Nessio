"""Module-local types of `ai`: what the model is asked to return, and what checks get.

The LLM-facing schemas are deliberately flat and strict-JSON friendly (every field required,
optional ones nullable). They are not the `Handover` contract: code turns them into a `Handover`
after verifying every quote against the source text, so the model never writes evidence offsets.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import StrEnum

from onko_contracts import DocumentType, Finding, Handover, ParsedDocument
from pydantic import BaseModel, Field


class FieldPath(StrEnum):
    """Scalar handover fields the model may fill. Lists (`comorbidities`, `medications`) use `items`."""

    FIRST_NAME = "patient.first_name"
    LAST_NAME = "patient.last_name"
    BIRTH_NUMBER = "patient.birth_number"
    BIRTH_DATE = "patient.birth_date"
    AGE = "patient.age"
    SEX = "patient.sex"
    INSURANCE_CODE = "patient.insurance_code"
    ADDRESS = "patient.address"
    PATIENT_PHONE = "contacts.patient_phone"
    PATIENT_EMAIL = "contacts.patient_email"
    CONTACT_PERSON = "contacts.contact_person"
    CONTACT_PERSON_PHONE = "contacts.contact_person_phone"
    DIAGNOSIS = "diagnosis"
    DIAGNOSIS_CODE = "diagnosis_code"
    MDT_QUESTION = "mdt_question"
    COMORBIDITIES = "comorbidities"
    MEDICATIONS = "medications"
    ALLERGIES = "allergies"
    PERFORMANCE_STATUS = "performance_status"
    WEIGHT_KG = "weight_kg"
    HEIGHT_CM = "height_cm"
    SYMPTOMS = "symptoms"
    HISTOLOGY = "histology"
    OTHER = "other"


LIST_FIELDS = {FieldPath.COMORBIDITIES, FieldPath.MEDICATIONS}


class Certainty(StrEnum):
    CONFIRMED = "confirmed"
    SUSPECTED = "suspected"  # "suspektní", "susp.", "podezření na", "v.s."
    UNSPECIFIED = "unspecified"


class FieldClaim(BaseModel):
    path: FieldPath
    value: str | None = Field(
        description="Normalised value; dates as YYYY-MM-DD, numbers without units"
    )
    items: list[str] | None = Field(
        description="Only for comorbidities / medications: one entry per item"
    )
    quotes: list[str] = Field(
        description="Verbatim excerpts from the document supporting the value"
    )
    certainty: Certainty


class ExamClaim(BaseModel):
    """An examination whose result this document reports (not one only mentioned or planned)."""

    date: str = Field(description="YYYY-MM-DD")
    place: str
    type: str
    start_quote: str = Field(description="Verbatim first words of the first clinical section")
    end_quote: str = Field(
        description="Verbatim last words of the last clinical section, before the signature"
    )
    key_quote: str = Field(description="One short verbatim sentence from the result")


class LabValueClaim(BaseModel):
    name: str
    value: str
    unit: str | None
    reference_range: str | None
    flag: str | None = Field(description="H / L exactly as printed, else null")


class LabClaim(BaseModel):
    date: str = Field(description="Sample date, YYYY-MM-DD")
    place: str
    date_quote: str = Field(description="Verbatim text giving the sample date")
    values: list[LabValueClaim]


class EventKind(StrEnum):
    PROCEDURE = "procedure"  # an examination / intervention that took place
    SAMPLE_TAKEN = "sample_taken"  # material / blood collected
    LAST_DOSE = "last_dose"  # a drug last taken / stopped
    RESULT_ISSUED = "result_issued"  # a result or report released
    PLANNED = "planned"  # anything scheduled or recommended for the future
    OTHER = "other"


class DatedEvent(BaseModel):
    kind: EventKind
    date: str = Field(description="YYYY-MM-DD")
    description: str
    quote: str = Field(description="Verbatim text containing the date")


class ReferencedResult(BaseModel):
    """An examination or report this document cites as already done, whose full result is elsewhere."""

    description: str
    doc_type: DocumentType
    date: str | None = Field(description="YYYY-MM-DD if stated")
    quote: str


class DocExtraction(BaseModel):
    """Everything the model reads out of one document in one call."""

    fields: list[FieldClaim]
    examinations: list[ExamClaim]
    labs: list[LabClaim]
    epicrisis_start_quote: str | None = Field(
        description="Referring doctor's epikríza: verbatim start"
    )
    epicrisis_end_quote: str | None = Field(description="Referring doctor's epikríza: verbatim end")
    events: list[DatedEvent]
    referenced_results: list[ReferencedResult]


class DocMetaDraft(BaseModel):
    title: str | None
    doc_type: DocumentType
    document_date: str | None = Field(description="Date of the examination / issue, YYYY-MM-DD")
    facility: str | None
    department: str | None
    author: str | None = Field(description="Who signed the document")
    ordered_by: str | None = Field(description="Indicating / referring doctor, if named")


class ReferenceMatch(BaseModel):
    reference: int = Field(description="Index of the reference in the given list")
    document_id: str | None = Field(description="Attached document holding that result, or null")


class ReferenceMatches(BaseModel):
    matches: list[ReferenceMatch]


class QuoteRef(BaseModel):
    document_id: str
    quote: str = Field(description="Verbatim text from that document")


class ReviewNote(BaseModel):
    message_cs: str
    fields: list[str] = Field(description="Handover paths the note is about")
    quotes: list[QuoteRef]


class ClinicalReview(BaseModel):
    notes: list[ReviewNote]


class ResultLine(BaseModel):
    index: int = Field(description="Index of the result row in the given list")
    result: str = Field(description="One Czech line with the row's key findings, only from its text")


class ResultLines(BaseModel):
    """The `mdt_results` draft: one line per MDT record result row (S5)."""

    lines: list[ResultLine]


class AnswerDraft(BaseModel):
    """'Ask the case' (Q-I19): the model answers only with quotes from the chunks it was given."""

    quotes: list[QuoteRef] = Field(description="Verbatim passages that answer the question; empty if none")


@dataclass(frozen=True)
class Extraction:
    """Per-document model output, already quote-verified, with the document it came from."""

    document: ParsedDocument
    output: DocExtraction


@dataclass(frozen=True)
class ExtractionResult:
    handover: Handover
    extractions: list[Extraction] = field(default_factory=list)


@dataclass(frozen=True)
class CheckContext:
    """What every check gets: the merged handover, the documents and per-document extractions."""

    handover: Handover
    documents: list[ParsedDocument]
    extractions: list[Extraction]
    as_of: dt.date
    prior: list[Finding] = field(default_factory=list)  # findings of the checks that ran before
