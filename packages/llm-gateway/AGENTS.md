# AI rules: llm_gateway (`onko_llm_gateway`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** The only client for our OpenAI-compatible model endpoints: one active model + one embedding model (an endpoint, or `local`: fastembed in-process, Q-M2), logging.

**May depend on:** contracts. Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- Every model call in the repo goes through `Gateway`. Nobody else imports `openai` or `fastembed`.
- Slots come from env via `from_env()` / `load_slots()` only (PY-8). Never log API keys.
- Endpoint-specific code belongs in `adapters/`.
