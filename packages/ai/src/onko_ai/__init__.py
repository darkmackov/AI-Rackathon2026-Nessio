"""AI module: documents -> Handover with evidence -> Findings. Drafts for humans to edit.

Owner: stream A. Rules:
- Never infer. A value without a verbatim quote from a case document is not a value.
- Only documents passed in are used. The caller decides the snapshot (received_at <= as_of).
- Output is a proposal; `validated_by_referrer` / `confirmed_by_coordinator` stay None until a person confirms.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .ports import Check, Extractor
from .service import CHECKS, check, draft

__all__ = ["CHECKS", "Check", "Extractor", "check", "draft"]
