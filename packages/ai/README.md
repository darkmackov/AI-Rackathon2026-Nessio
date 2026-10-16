# ai (stream A)

Documents → `Handover` with verbatim evidence → `Finding`s. Drafts for humans to edit.

**Done when:**
- [x] `Extractor`: map per document + merge (conflict status on disagreement); evidence quotes verified against the source text
- [x] Checks: required fields, temporal impossibility, identity (RČ ↔ birth date/sex/age, insurer), unattached references, trends, advisory LLM clinical review
- [ ] Reference case: matches `expected_handover.json` and finds F01–F12 without the listed false positives (docs/reference-case.md)
- [ ] `draft('epicrisis_summary' | 'mdt_question' | 'mdt_conclusion')`
- [ ] Bonus: task suggestions, only when specific and quote-backed (Q-F1, Q-F3)

**How it works** (`analyse_case`):
1. One structured model call per document returns a `DocExtraction`: field claims with verbatim quotes, examinations (start/end quotes), lab panels, the GP's epikríza span, dated events and cited results.
2. Every quote is located in the document text (only whitespace may differ). A claim without a verified quote is dropped. Full-text fields are sliced from the source, so they are verbatim by construction.
3. `merge` is deterministic: identity fields take the majority (a misprint becomes an identity finding), allergies and insurer become `conflict` on disagreement, everything else takes the newest document. Sex may come from the RČ (Q-C5).
4. `build_checks`: required fields, conflicts, provisional diagnosis, temporal, unattached references (model matches citations to attached documents), identity, trends/stale weight, and the advisory clinical review. `reconcile_findings` keeps people's resolutions and resolves findings that no longer appear.
