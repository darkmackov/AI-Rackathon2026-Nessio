# AI rules: documents (`onko_documents`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** Upload → text (`parse`), and rendering of output documents (`render_pdf`, `render_mdt_record`, `render_mdt_conclusion`).

**May depend on:** contracts, repository (port only). Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- One parser per format in `adapters/` (`office.py`, `pdf.py`), registered in `PARSERS` (`service.py`) by MIME type.
- Parsers keep tables as Markdown and never drop clinical text.
- Rendering uses fpdf2 with the bundled DejaVu fonts (Q-K13). Its HTML tables take plain text cells only (newlines for line breaks); missing values print as 'neuvedeno'.
