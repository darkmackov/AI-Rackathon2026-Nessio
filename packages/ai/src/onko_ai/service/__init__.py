"""The AI pipeline: metadata, extraction (map -> verify -> merge), checks, drafts, vector search
(MOD-10 split)."""

from __future__ import annotations

import datetime as dt

from onko_contracts import Finding, Handover, ParsedDocument
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository

from ..models import CheckContext, ExtractionResult
from .checks import build_checks, check, reconcile_findings
from .drafts import draft, draft_results, handover_digest
from .extract import LlmExtractor, apply_metadata, extract_metadata, keep_manual, merge
from .normalize import normalize_handover
from .quotes import locate
from .search import (
    ask_case,
    chunk_document,
    code_candidates,
    index_document,
    index_missing,
    load_codes,
    unverified_quote_findings,
)


def analyse_case(
    case_id: str,
    documents: list[ParsedDocument],
    *,
    gateway: Gateway,
    as_of: dt.date,
    now: dt.datetime,
    previous_handover: Handover | None = None,
    previous_findings: list[Finding] | None = None,
    repo: CaseRepository | None = None,
) -> tuple[Handover, list[Finding], ExtractionResult]:
    """Whole-case run: extract, keep people's manual values, check, flag quotes not found verbatim
    (with the nearest chunk from `repo` when the documents are indexed, Q-I19), keep people's
    resolutions.

    `documents` must already be the snapshot (received_at <= as_of) with AI metadata applied."""
    result = LlmExtractor(gateway).extract_all(case_id, documents, as_of)
    handover = normalize_handover(keep_manual(previous_handover, result.handover))  # Q-C13
    ctx = CheckContext(
        handover, documents, result.extractions, as_of, previous=previous_findings or []
    )
    current = check(ctx, build_checks(gateway))
    current += unverified_quote_findings(result.extractions, repo, gateway)
    findings = reconcile_findings(previous_findings or [], current, now)
    return handover, findings, result


__all__ = [
    "LlmExtractor",
    "analyse_case",
    "apply_metadata",
    "ask_case",
    "build_checks",
    "check",
    "chunk_document",
    "code_candidates",
    "draft",
    "draft_results",
    "extract_metadata",
    "handover_digest",
    "index_document",
    "index_missing",
    "keep_manual",
    "load_codes",
    "locate",
    "merge",
    "normalize_handover",
    "reconcile_findings",
]
