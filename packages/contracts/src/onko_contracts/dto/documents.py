"""DTOs for documents. Mirror `onko_contracts.documents`."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from ..documents import DocumentType
from .common import Dto


class DocumentMetaDto(Dto):
    id: str
    case_id: str | None
    filename: str
    title: str
    doc_type: DocumentType
    document_date: date
    facility: str
    department: str | None
    author: str | None
    ordered_by: str | None
    received_at: datetime | None = Field(description="When the document entered the case")
    mime_type: str


class DocumentTextDto(Dto):
    id: str
    text: str
