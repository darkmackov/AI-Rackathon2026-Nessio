# AI rules: documents (`onko_documents`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** Upload → text (`parse`), and rendering of output documents (`render_pdf`, `render_mdt_record`, `render_mdt_conclusion`).

**May depend on:** contracts, repository (port only). Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- One parser per format in `adapters/` (`office.py`, `pdf.py`), registered in `PARSERS` (`service.py`) by MIME type.
- Parsers keep tables as Markdown and never drop clinical text.
- Rendering uses Typst (`typst` package) with the bundled DejaVu fonts (Q-K13). One template per output kind in `templates/<kind>.typ` (shared helpers in `common.typ`); Python passes the contract models as JSON and keeps business rules (e.g. only a confirmed conclusion), the template owns the layout. Never build Typst markup from user text. Missing values print as 'neuvedeno'.
