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
    """Metadata of an uploaded document. Everything except filename/received_at is AI-extracted
    after upload (decision 16. 10.: AI extract), so it is optional until the ingest job finishes."""

    id: str
    case_id: str | None = None
    filename: str
    title: str | None = None
    doc_type: DocumentType = DocumentType.OTHER
    document_date: date | None = Field(default=None, description="Date of the examination / issue")
    facility: str | None = None
    department: str | None = None
    author: str | None = None
    ordered_by: str | None = Field(default=None, description="Indikující / odesílající lékař")
    received_at: datetime | None = Field(
        default=None, description="When the document entered the case; drives the MDT snapshot"
    )
    uploaded_by: str | None = Field(default=None, description="Actor id")
    mime_type: str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class ParsedDocument(Model):
    """Output of a parser: plain text (tables as Markdown) for the AI pipeline."""

    meta: DocumentMeta
    text: str
