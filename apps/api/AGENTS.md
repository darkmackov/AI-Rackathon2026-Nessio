# AI rules: api (`onko_api`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions). Endpoints: [docs/api.md](../../docs/api.md), build order: [docs/slices.md](../../docs/slices.md).

**Owns:** FastAPI routes over the modules (`main.py` + `routes.py`), request bodies (`schemas.py`), reference-case seed.

**May depend on:** contracts, cases, repository, documents, ai, messaging. Import other modules only through their package root (MOD-2).

**Rules:**
- **Use the models that exist.** Responses are contract models from `onko_contracts`; request bodies are `Body` models in `schemas.py`, named `<Noun><Action>` (APIM-1 … APIM-3). Every route returns what api.md lists for it; new endpoints never return a `dict` or an ad-hoc model.
- Implementing a 501 stub keeps its function name, path, request and response models (APIM-4, API-3). A response model changes only through a contract PR.
- Routes are thin: no business logic (API-1). The return annotation is the response model (API-2). "Now" is the app clock (API-5, D-10).
- Errors: `HTTPException(status, "…")` with the codes in api.md, no error model (APIM-6).
- After any route, body or contract change, run `uv run python scripts/export_openapi.py` and `npm --prefix apps/web run gen:api`, and commit both (APIM-7).
