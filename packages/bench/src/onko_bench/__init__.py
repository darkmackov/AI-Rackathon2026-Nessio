"""Bench: score every configured model on every reference case.

Owner: stream B. A reference case is a folder with `reports/*.md` and `reference/` holding
`manifest.json`, `expected_handover.json`, `expected_findings.json` (data/vzp-structured,
data/reference-2). Each model runs AI metadata + `analyse_case` on the documents received by the
MDT. Metrics per model and case (share of hits):
- metadata: doc_type and document_date per document
- fields: status per handover leaf, plus the value (exact for codes/dates/numbers, token F1 for text)
- examinations: one per expected date, full text verbatim; labs: each expected value in its panel
- evidence: share of quotes found verbatim in the cited document
- findings: open in-scope expected findings matched by kind + a shared field (findings on data
  outside the handover, `referring_doctor.*` / `mdt_record.*`, are S3/S5 and not scored)
- false positives (an open finding the reference has as resolved), extras (matching nothing)
- seconds and tokens (from the gateway log)

Run: `uv run onko-bench [--models a,b] [--cases …]` -> bench-results/<time>/leaderboard.csv
plus one JSON per run with the misses and the full output.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .service import main

__all__ = ["main"]
