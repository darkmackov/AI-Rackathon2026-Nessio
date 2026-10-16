"""The AI pipeline: metadata, extraction (map -> verify -> merge), checks, drafts (MOD-10 split)."""

from __future__ import annotations

import datetime as dt

from onko_contracts import Finding, Handover, ParsedDocument
from onko_llm_gateway import Gateway

from ..models import CheckContext, ExtractionResult
from .checks import build_checks, check, reconcile_findings
from .extract import LlmExtractor, apply_metadata, extract_metadata, keep_manual, merge
from .quotes import locate


def analyse_case(
    case_id: str,
    documents: list[ParsedDocument],
    *,
    gateway: Gateway,
    as_of: dt.date,
    now: dt.datetime,
    previous_handover: Handover | None = None,
    previous_findings: list[Finding] | None = None,
) -> tuple[Handover, list[Finding], ExtractionResult]:
    """Whole-case run: extract, keep people's manual values, check, keep people's resolutions.

    `documents` must already be the snapshot (received_at <= as_of) with AI metadata applied."""
    result = LlmExtractor(gateway).extract_all(case_id, documents, as_of)
    handover = keep_manual(previous_handover, result.handover)
    ctx = CheckContext(handover, documents, result.extractions, as_of)
    findings = reconcile_findings(previous_findings or [], check(ctx, build_checks(gateway)), now)
    return handover, findings, result


def draft(kind: str, handover: Handover, findings: list[Finding]) -> str:
    """Draft text for the coordinator to edit: 'epicrisis_summary' (Q-F15), 'mdt_question' (Q-F14),
    'mdt_conclusion' (Q-F12). TODO S5."""
    raise NotImplementedError


__all__ = [
    "LlmExtractor",
    "analyse_case",
    "apply_metadata",
    "build_checks",
    "check",
    "draft",
    "extract_metadata",
    "keep_manual",
    "locate",
    "merge",
    "reconcile_findings",
]
