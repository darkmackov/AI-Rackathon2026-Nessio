# AI rules: cases (`onko_cases`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** State machine, dashboard queue, on-hold flag, tasks and task sets, time to treatment, audit.

**May depend on:** contracts, repository (port only). Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- Transitions only through `ALLOWED_TRANSITIONS` (in contracts). Never set `Case.state` directly elsewhere.
- Task sets are user data from the UI, never config files.
- Pass `now: datetime` in (PY-4). Module-local types and errors go in `models.py`.
