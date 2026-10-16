"""Building blocks shared by every contract: evidence, field status, sourced values."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)


class FieldStatus(StrEnum):
    """Extraction state of one handover value."""

    FOUND = "found"
    MISSING = "missing"  # not in any document available at the time
    CONFLICT = "conflict"  # documents disagree, a human must decide


class Evidence(Model):
    """Where a value came from. Every AI-extracted value carries at least one."""

    document_id: str
    quote: str = Field(description="Verbatim text from the source document")
    document_date: date | None = None


class Sourced(Model, Generic[T]):
    """A value plus its provenance and status. AI proposes it, a human validates it."""

    value: T | None = None
    status: FieldStatus = FieldStatus.FOUND
    evidence: list[Evidence] = Field(default_factory=list)
    note: str | None = Field(default=None, description="Why missing / what conflicts, in Czech")


class Actor(Model):
    """A person or organisation taking part in the case."""

    id: str
    name: str
    role: str = Field(description="e.g. referring_doctor, coordinator, mdt_doctor, reviewing_doctor")
    organization: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None


class Stamp(Model):
    by: str
    at: datetime
