"""Bench: score every configured model on every reference case.

Owner: stream B. A reference case is a folder with `manifest.json`, `expected_handover.json`,
`expected_findings.json` (see data/vzp-structured/reference). Metrics per model:
- field accuracy: found/missing status and value match per handover leaf
- evidence validity: share of quotes found verbatim in the cited document
- gap/conflict recall: expected findings matched by kind + fields
- false positives: findings raised that the reference lists as non-issues
- latency and tokens (from the gateway log)

Run: `uv run onko-bench` -> leaderboard CSV in bench-results/. TODO stream B.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .service import main

__all__ = ["main"]
