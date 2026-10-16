"""DTO base and the building blocks shared by every DTO."""

from __future__ import annotations

from datetime import date, datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from ..common import FieldStatus

T = TypeVar("T")


class Dto(BaseModel):
    """Base of every DTO. `from_attributes` lets the API mappers build a DTO from a domain model."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)


class EvidenceDto(Dto):
    document_id: str
    quote: str = Field(description="Verbatim text from the source document")
    document_date: date | None


class SourcedDto(Dto, Generic[T]):
    value: T | None
    status: FieldStatus
    evidence: list[EvidenceDto]
    note: str | None = Field(description="Why missing / what conflicts, in Czech")


class StampDto(Dto):
    by: str
    at: datetime


class HealthDto(Dto):
    ok: bool
    iris_configured: bool
