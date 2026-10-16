# AI rules: repository (`onko_repository`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** The only code that talks to IRIS: the `CaseRepository` port, the in-memory fake, and the IRIS adapter (app state as JSON documents in IRIS SQL, FHIR projection where needed, Q-A7).

**May depend on:** contracts. Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- Follow PER-1 … PER-12 in data.md. The port speaks domain models only.
- `adapters/memory.py` is the behavioural reference. `adapters/iris.py` must pass the same tests.
- The FHIR projection follows `docs/data-model.md` exactly. Add new resources, profiles or identifier systems there first. Vector chunks are Phase 2.
- Secrets only through `settings.py` (`SecretStr`). Never log or commit them.
