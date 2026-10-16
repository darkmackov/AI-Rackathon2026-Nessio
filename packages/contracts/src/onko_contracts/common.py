"""Building blocks shared by every contract: provenance, field status, sourced values."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

T = TypeVar("T")


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)


class FieldStatus(StrEnum):
    """State of one handover value."""

    FOUND = "found"
    MISSING = "missing"  # not in any document available at the time, or marked "not available"
    CONFLICT = "conflict"  # documents disagree, a human must decide


class Origin(StrEnum):
    """Who produced a value."""

    AI = "ai"  # extracted from documents; must carry evidence
    MANUAL = "manual"  # typed in by a person; must carry `entered`


class Stamp(Model):
    by: str = Field(description="Actor id")
    at: datetime


class Evidence(Model):
    """Where an AI value came from: a verbatim quote from a case document."""

    document_id: str
    quote: str = Field(description="Verbatim text from the source document")
    document_date: date | None = None
    start: int | None = Field(default=None, description="Char offset of the quote in the document text")
    end: int | None = Field(default=None, description="Char offset after the quote")


class Sourced(Model, Generic[T]):
    """A value plus its provenance and status. AI proposes it, a human validates it.

    An empty `Sourced()` means "not extracted yet" (status missing).
    """

    value: T | None = None
    status: FieldStatus = FieldStatus.MISSING
    origin: Origin = Origin.AI
    evidence: list[Evidence] = Field(default_factory=list)
    entered: Stamp | None = Field(default=None, description="Who typed it in (origin=manual)")
    note: str | None = Field(default=None, description="Why missing / what conflicts, in Czech")

    @model_validator(mode="after")
    def _provenance(self) -> Sourced[T]:
        if self.origin is Origin.MANUAL and self.entered is None:
            raise ValueError("manual values need `entered`")
        if self.status is FieldStatus.FOUND:
            if self.value is None:
                raise ValueError("status found needs a value")
            if self.origin is Origin.AI and not self.evidence:
                raise ValueError("AI values need evidence")
        return self


class Actor(Model):
    """A person taking part in the case. Users are the referring doctor and the coordinator;
    MDT members and reviewing doctors are information only (Q-F21)."""

    id: str
    name: str
    role: str = Field(
        description="referring_doctor | coordinator | specialist | mdt_member | reviewing_doctor"
    )
    organization_id: str | None = None
    phone: str | None = None
    email: str | None = None
