# AI rules: bench (`onko_bench`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** Scores every model slot on every reference case → leaderboard.

**May depend on:** contracts, ai, llm_gateway. Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- Reads reference cases from `data/vzp-structured` and `data/reference-2` (`reports/` + `reference/`). Writes only to `bench-results/` (gitignored).
- Uses `ai` and `llm_gateway` only through their public API (MOD-2).
