"""Interfaces of the AI module: extractors and checks plug in here."""

from __future__ import annotations

from datetime import date
from typing import Protocol

from onko_contracts import Finding, Handover, ParsedDocument

from .models import CheckContext


class Extractor(Protocol):
    def extract(self, case_id: str, documents: list[ParsedDocument], as_of: date) -> Handover:
        """Map: each document -> partial Handover with quotes. Reduce: merge, newest valid value
        wins, disagreement -> FieldStatus.CONFLICT. Then drop any evidence whose quote is not
        found verbatim in its document."""
        ...


class Check(Protocol):
    """One generic consistency/completeness check. Register in `build_checks`."""

    id: str

    def run(self, ctx: CheckContext) -> list[Finding]: ...
