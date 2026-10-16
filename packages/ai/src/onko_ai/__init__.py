"""AI module: documents -> Handover with evidence -> Findings. Drafts for humans to edit.

Owner: stream A. Rules:
- Never infer. A value without a verbatim quote from a case document is not a value.
- Only documents passed in are used. The caller decides the snapshot (received_at <= as_of).
- Output is a proposal; `validated_by_referrer` / `confirmed_by_coordinator` stay None until a person confirms.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from onko_contracts import Finding, Handover, ParsedDocument


class Extractor(Protocol):
    def extract(self, case_id: str, documents: list[ParsedDocument], as_of: date) -> Handover:
        """Map: each document -> partial Handover with quotes. Reduce: merge, newest valid value
        wins, disagreement -> FieldStatus.CONFLICT. Then drop any evidence whose quote is not
        found verbatim in its document."""
        ...


class Check(Protocol):
    """One generic consistency/completeness check. Register in CHECKS."""

    id: str

    def run(self, handover: Handover, documents: list[ParsedDocument]) -> list[Finding]: ...


CHECKS: list[Check] = []  # TODO stream A: required fields, temporal, identity, references, trends


def check(handover: Handover, documents: list[ParsedDocument]) -> list[Finding]:
    return [f for c in CHECKS for f in c.run(handover, documents)]


def draft(kind: str, handover: Handover, findings: list[Finding]) -> str:
    """Draft text for a human to edit: 'mdt_conclusion', 'document_request', ... TODO stream A."""
    raise NotImplementedError


__all__ = ["CHECKS", "Check", "Extractor", "check", "draft"]
