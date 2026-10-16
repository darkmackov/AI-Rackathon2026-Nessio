"""AI module: documents -> Handover with evidence -> Findings. Drafts for humans to edit.

Owner: stream A. Rules:
- Never infer. A value without a verbatim quote from a case document is not a value.
- Only documents passed in are used. The caller decides the snapshot (received_at <= as_of).
- Output is a proposal; `validated_by_referrer` / `confirmed_by_coordinator` stay None until a person confirms.
- Drafts (S5) cover what the MDT receives: the epikríza summary, the MDT question and one-line
  result rows. They are text to edit, never written to the case here; the MDT's decision is never
  drafted (Q-F37).
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.

Pipeline (`analyse_case`): one structured model call per document (`DocExtraction`), every quote
verified against the text, a deterministic merge (identity: majority; allergies / insurer:
conflict on disagreement; everything else: newest document wins), then the checks of
`build_checks`, with earlier resolutions carried over.
"""

from __future__ import annotations

from .models import (
    CheckContext,
    DocExtraction,
    DocMetaDraft,
    Extraction,
    ExtractionResult,
    ResultLine,
    ResultLines,
)
from .ports import Check, Extractor
from .service import (
    LlmExtractor,
    analyse_case,
    apply_metadata,
    build_checks,
    check,
    draft,
    draft_results,
    extract_metadata,
    handover_digest,
    keep_manual,
    locate,
    merge,
    reconcile_findings,
)

__all__ = [
    "Check",
    "CheckContext",
    "DocExtraction",
    "DocMetaDraft",
    "Extraction",
    "ExtractionResult",
    "Extractor",
    "LlmExtractor",
    "ResultLine",
    "ResultLines",
    "analyse_case",
    "apply_metadata",
    "build_checks",
    "check",
    "draft",
    "draft_results",
    "extract_metadata",
    "handover_digest",
    "keep_manual",
    "locate",
    "merge",
    "reconcile_findings",
]
