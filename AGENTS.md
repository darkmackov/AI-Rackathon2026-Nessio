# Rules for AI agents

These rules are **mandatory** for every AI agent working in this repo (Claude Code loads them through `CLAUDE.md`). They summarise the conventions in [`docs/conventions/`](docs/conventions). When a rule here and a convention doc disagree, the doc wins: fix this file.

Each module also has its own `AGENTS.md` with its boundaries. Read it before editing that module.

## Before you start

1. Read the docs for the area you touch:
   - **Any Python:** [implementation.md](docs/conventions/implementation.md)
   - **Domain models, DTOs, persistence:** [data.md](docs/conventions/data.md)
   - **Web app:** [web.md](docs/conventions/web.md) and [ui-ux.md](docs/conventions/ui-ux.md)
   - **What the product does and why:** [product.md](docs/product.md), [architecture.md](docs/architecture.md), [open-questions.md](docs/open-questions.md)
2. **Don't assume anything that isn't written down.** If the docs, the code and open-questions.md don't answer a question, ask the user. Don't pick a library, a behaviour or a default on your own.
3. If a rule stops you from doing what you were asked, say so and ask. Never work around it quietly.

## Hard rules

**Modules** (MOD-*)
- Import other modules only through their package root (`from onko_cases import …`), never their submodules. The one exception is `onko_contracts.dto`.
- Respect the dependency table in implementation.md. A new edge means updating the table and declaring it in `pyproject.toml`.
- Keep the layered layout: `__init__.py` (re-exports only) · `models.py` · `ports.py` · `service.py` · `adapters/` · optional `settings.py`.
- Only `onko_repository` talks to IRIS. Other modules get the `CaseRepository` port.

**Data** (DM-*, DTO-*, PER-*)
- Domain models live in `onko_contracts` and subclass `Model`. They're immutable: change them with `model_copy(update=…)`.
- **The API speaks DTOs only.** Every route takes and returns `XxxDto` from `onko_contracts.dto`, never a domain model or a `dict`.
- DTOs mirror their domain model (same snake_case names, nested DTOs, reused domain enums). Response DTOs have no defaults.
- Domain ↔ DTO mapping lives only in `apps/api/src/onko_api/mappers.py`, with a test in `test_mappers.py`.
- AI-extracted values are `Sourced[T]` with verbatim `Evidence`. Never infer or fill in a missing value.
- A change to `onko_contracts` is its own PR and updates the reference JSONs, tests, DTOs, mappers and `data-model.md` as needed.

**Web** (WEB-*, UX-*, A11Y-*)
- **Use the existing DTOs for all API communication.** Read `apps/web/src/client/types.gen.ts` first. Call the API only through the generated TanStack Query helpers (`xxxOptions()` / `xxxMutation()`). Never redeclare DTO shapes, `fetch` by hand, or cast API data.
- If a screen needs data no DTO has, extend the backend DTO and regenerate. Never fake it in the browser.
- **No `useEffect`** (nor `useLayoutEffect` or `useInsertionEffect`). Use the replacement table in web.md.
- Build with React function components. Use the UI library's components for everything it offers. Until one is chosen (Q-W1), use semantic HTML and add no UI library.
- Follow ui-ux.md: show every `SourcedDto` status, label AI proposals, cover loading/error/empty/success, meet WCAG 2.2 AA.
- Never edit `apps/web/src/client/**` (generated).

**Code** (PY-*)
- Start each Python file with a docstring, then `from __future__ import annotations`. Type every public function. Pass `now: datetime` in instead of reading the clock.
- No logic specific to the reference case.
- Never commit `.env` or secrets.

## Before you finish

Run what applies and report the real results. Run Python commands with `uv run`:

```bash
uv run pytest
```
```bash
uv run ruff check .
```
After an API or DTO change, regenerate the client (a test fails if the spec is stale):
```bash
uv run python scripts/export_openapi.py
```
```bash
npm --prefix apps/web run gen:api
```
After a web change:
```bash
npm --prefix apps/web run build
```
```bash
npm --prefix apps/web run lint
```

Git: branches are `<type>/<short-topic>`, commits are `<type>: <summary>` (Conventional Commits). Commit or push only when the user asks.
