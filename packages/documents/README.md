# documents (stream A)

Upload → text for the AI. Office files go through stdlib `office.py` (Word tables become Markdown), PDFs through pypdf. Add new formats in `PARSERS`. Output documents are rendered from simple HTML with fpdf2 and the bundled DejaVu Sans (`fonts/`, Q-K13), so Czech text needs no system fonts.

**Done when:**
- [x] docx/pptx parsing
- [ ] PDF parsing tested
- [x] `render_pdf` for the MDT record (`MDT_zapis` layout) and conclusion (`MDT_zaver` layout): `render_mdt_record`, `render_mdt_conclusion` (S5)
- [ ] image/scan parsing via a vision model (Phase 2)
