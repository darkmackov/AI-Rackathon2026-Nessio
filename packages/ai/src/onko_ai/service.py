"""Checks registry and drafting."""

from __future__ import annotations

from onko_contracts import Finding, Handover, ParsedDocument

from .ports import Check

CHECKS: list[Check] = []  # TODO stream A: required fields, temporal, identity, references, trends


def check(handover: Handover, documents: list[ParsedDocument]) -> list[Finding]:
    return [f for c in CHECKS for f in c.run(handover, documents)]


def draft(kind: str, handover: Handover, findings: list[Finding]) -> str:
    """Draft text for a human to edit: 'mdt_conclusion', 'document_request', ... TODO stream A."""
    raise NotImplementedError
