"""Problems the completeness/consistency check raises on a case."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field, model_validator

from .common import Evidence, Model


class FindingKind(StrEnum):
    MISSING = "missing"  # required value not in any document
    CONFLICT = "conflict"  # two sources disagree on a value
    TEMPORAL = "temporal"  # impossible / suspicious ordering of dates
    IDENTITY = "identity"  # RČ vs birth date / sex / age, insurer code
    UNATTACHED_REFERENCE = "unattached_reference"  # a report is cited but not attached
    TREND = "trend"  # notable change across documents (informational)
    # The model quoted text that is not in the document verbatim; the value was dropped (D-2) and
    # the evidence is the nearest chunk of that document (Q-I19)
    UNVERIFIED_QUOTE = "unverified_quote"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    BLOCKER = "blocker"  # must be resolved before the MDT


class SuggestedAction(StrEnum):
    REQUEST = "request"  # Vyžádat from someone
    FILL_IN = "fill_in"  # Doplnit manually
    REVIEW = "review"  # a human must look and decide


class ResolutionKind(StrEnum):
    RESOLVED = "resolved"  # the gap was filled / the conflict clarified
    OVERRIDDEN = "overridden"  # a blocker accepted as-is, with a note (Q-C2)
    DISMISSED = "dismissed"  # not a real problem


class Resolution(Model):
    kind: ResolutionKind
    note: str | None = None
    by: str
    at: datetime

    @model_validator(mode="after")
    def _note_for_override(self) -> Resolution:
        if self.kind is ResolutionKind.OVERRIDDEN and not self.note:
            raise ValueError("an override needs a note")
        return self


class Finding(Model):
    id: str
    kind: FindingKind
    severity: Severity
    fields: list[str] = Field(default_factory=list, description="Handover paths, e.g. 'performance_status'")
    message_cs: str
    evidence: list[Evidence] = Field(default_factory=list)
    suggested_action: SuggestedAction = SuggestedAction.REVIEW
    advisory: bool = Field(
        default=False, description="Clinical-judgement hint from the LLM review, not a data gap (Q-C3)"
    )
    overridable: bool = Field(
        default=True, description="A blocker the coordinator may override with a note (Q-C2)"
    )
    resolved: bool = False
    resolution: Resolution | None = Field(default=None, description="Who resolved it, how, why")
