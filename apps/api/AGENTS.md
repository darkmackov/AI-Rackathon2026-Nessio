# AI rules: api (`onko_api`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** FastAPI routes over the modules, domain ↔ DTO mappers, reference-case seed.

**May depend on:** contracts (incl. `dto`), cases, repository, documents, ai, messaging. Import other modules only through their package root (MOD-2).

**Rules:**
- **Routes take and return DTOs only** (`onko_contracts.dto`), with the DTO as the return annotation (DTO-1, API-2).
- Map in `mappers.py` only (`<model>_to_dto`, `<model>_from_dto`), and cover each mapper in `tests/test_mappers.py` (DTO-9, DTO-10).
- Routes are thin: no business logic (API-1). The function name is the client name: verb + noun (API-3).
- Errors: `HTTPException(status, "…")`, no error DTO (DTO-11).
- After any route/DTO change, run `uv run python scripts/export_openapi.py` and `npm --prefix apps/web run gen:api`, and commit both (DTO-12).
