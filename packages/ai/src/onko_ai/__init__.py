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
`build_checks`, with earlier resolutions carried over. A field claim whose quotes are all missing
from the text is dropped and flagged (`unverified_quote`) with the nearest chunk of its document.

Vector search (S8, Q-I19): `chunk_document` cuts a parsed document along its sections, `index_document`
embeds and stores the chunks; `ask_case` answers only with verbatim quotes ('not found' otherwise);
`code_candidates` proposes MKN-10 codes from the list `load_codes` stored (Q-C11).
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
    ask_case,
    build_checks,
    check,
    chunk_document,
    code_candidates,
    draft,
    draft_results,
    extract_metadata,
    handover_digest,
    index_document,
    index_missing,
    keep_manual,
    load_codes,
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
    "reconcile_findings",
]
