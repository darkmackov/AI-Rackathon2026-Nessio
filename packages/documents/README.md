# documents (stream A)

Upload → text for the AI. Office files go through stdlib `office.py` (Word tables become Markdown), PDFs through pypdf. Add new formats in `PARSERS`.

**Done when:**
- [x] docx/pptx parsing
- [ ] PDF parsing tested
- [ ] `render_pdf` for the MDT record (`MDT_zapis` layout) and conclusion (`MDT_zaver` layout)
- [ ] image/scan parsing via a vision model (Phase 2)
