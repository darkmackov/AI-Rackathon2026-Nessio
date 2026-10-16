# AI rules: ai (`onko_ai`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** Extraction of documents into a `Handover` with verbatim evidence, checks → `Finding`s, and drafts for humans.

**May depend on:** contracts, llm_gateway, repository (port only). Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- Never infer. A value without a verbatim quote from a case document is `missing` (DM-8).
- Model calls go only through `onko_llm_gateway.Gateway`.
- Checks are generic: nothing specific to the reference case (PY-6). Register new checks in `CHECKS` (`service.py`); interfaces are in `ports.py`.
- Output is a proposal. Never set `validated_by_referrer` / `confirmed_by_coordinator`.
