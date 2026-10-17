# documents (stream A)

Upload → text for the AI. Office files go through stdlib `office.py` (Word tables become Markdown), PDFs through pypdf. Add new formats in `PARSERS`. Output documents are rendered by Typst from `templates/<kind>.typ` with the data passed as JSON, using the bundled DejaVu Sans (`fonts/`, Q-K13), so Czech text needs no system fonts. Add a new output kind as a template plus an entry in `RENDER_KINDS`.

**Done when:**
- [x] docx/pptx parsing
- [x] duplicate-upload warning: SHA-256 for exact copies, 5-word shingles (Jaccard ≥ 0.8) for near ones, within the case (`find_duplicates`, Q-I22)
- [ ] PDF parsing tested
- [x] `render_pdf` for the MDT record (`MDT_zapis` layout, sections 1–5 plus the rest of the frozen handover snapshot; never the conclusion) and conclusion (`MDT_zaver` layout): `render_mdt_record`, `render_mdt_conclusion` (S5)
- [ ] image/scan parsing via a vision model (Phase 2)
