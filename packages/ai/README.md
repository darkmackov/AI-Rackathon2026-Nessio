# ai (stream A)

Documents → `Handover` with verbatim evidence → `Finding`s. Drafts for humans to edit.

**Done when:**
- [ ] `Extractor`: map per document + merge (conflict status on disagreement); evidence quotes verified against the source text
- [ ] Checks: required fields, temporal impossibility, identity (RČ ↔ birth date/sex/age, insurer), unattached references, trends, advisory LLM clinical review
- [ ] Reference case: matches `expected_handover.json` and finds F01–F12 without the listed false positives (docs/reference-case.md)
- [ ] `draft('epicrisis_summary' | 'mdt_question' | 'mdt_conclusion')`
- [ ] Bonus: task suggestions, only when specific and quote-backed (Q-F1, Q-F3)
