"""DTOs for findings. Mirror `onko_contracts.findings`."""

from __future__ import annotations

from pydantic import Field

from ..findings import FindingKind, Severity, SuggestedAction
from .common import Dto, EvidenceDto


class FindingDto(Dto):
    id: str
    kind: FindingKind
    severity: Severity
    fields: list[str] = Field(description="Handover paths, e.g. 'performance_status'")
    message_cs: str
    evidence: list[EvidenceDto]
    suggested_action: SuggestedAction
    advisory: bool = Field(description="Clinical-judgement hint, not a data gap (Q-C3)")
    overridable: bool = Field(description="A blocker the coordinator may override (Q-C2)")
    resolved: bool
