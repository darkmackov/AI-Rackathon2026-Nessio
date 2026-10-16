"""Clinical documents attached to a case (maps to FHIR DocumentReference)."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import Field

from .common import Model


class DocumentType(StrEnum):
    REFERRAL = "referral"  # žádost o převzetí
    EPICRISIS = "epicrisis"
    OUTPATIENT_REPORT = "outpatient_report"  # ambulantní zpráva
    LAB = "lab"
    IMAGING = "imaging"
    PROCEDURE = "procedure"  # protokol o výkonu
    HISTOLOGY = "histology"
    MDT_RECORD = "mdt_record"
    MDT_CONCLUSION = "mdt_conclusion"
    OTHER = "other"


class DocumentMeta(Model):
    id: str
    case_id: str | None = None
    filename: str
    title: str
    doc_type: DocumentType
    document_date: date = Field(description="Date of the examination / issue")
    facility: str
    department: str | None = None
    author: str | None = None
    ordered_by: str | None = Field(default=None, description="Indikující / odesílající lékař")
    received_at: datetime | None = Field(
        default=None, description="When the document entered the case; drives the MDT snapshot"
    )
    mime_type: str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class ParsedDocument(Model):
    """Output of a parser: plain text (tables as Markdown) for the AI pipeline."""

    meta: DocumentMeta
    text: str
