# Rules for AI agents

These rules are **mandatory** for every AI agent working in this repo (Claude Code loads them through `CLAUDE.md`). They summarise the conventions in [`docs/conventions/`](docs/conventions). When a rule here and a convention doc disagree, the doc wins: fix this file.

Each module also has its own `AGENTS.md` with its boundaries. Read it before editing that module.

## Before you start

1. Read the docs for the area you touch:
   - **Any Python:** [implementation.md](docs/conventions/implementation.md)
   - **Tests and CI:** [testing.md](docs/conventions/testing.md)
   - **Domain models, API models, persistence:** [data.md](docs/conventions/data.md), and the endpoints in [api.md](docs/api.md)
   - **Web app:** [web.md](docs/conventions/web.md) and [ui-ux.md](docs/conventions/ui-ux.md)
   - **What the product does and why:** [product.md](docs/product.md), [architecture.md](docs/architecture.md), [slices.md](docs/slices.md), [open-questions.md](docs/open-questions.md)
2. **Don't assume anything that isn't written down.** If the docs, the code and open-questions.md don't answer a question, ask the user. Don't pick a library, a behaviour or a default on your own.
3. If a rule stops you from doing what you were asked, say so and ask. Never work around it quietly.

## Hard rules

**Modules** (MOD-*)
- Import other modules only through their package root (`from onko_cases import …`), never their submodules.
- Respect the dependency table in implementation.md. A new edge means updating the table and declaring it in `pyproject.toml`.
- Keep the layered layout: `__init__.py` (re-exports only) · `models.py` · `ports.py` · `service.py` · `adapters/` · optional `settings.py`.
- Only `onko_repository` talks to IRIS. Other modules get the `CaseRepository` port.

**Data** (DM-*, APIM-*, PER-*)
- Domain models live in `onko_contracts` and subclass `Model`. They're immutable: change them with `model_copy(update=…)`.
- **The API uses the models that exist** ([api.md](docs/api.md)): responses are contract models, request bodies are the `Body` models in `apps/api/src/onko_api/schemas.py`. Every route returns what api.md lists for it; new endpoints never return a `dict` or an ad-hoc model, and never add a near-duplicate of an existing model.
- Implementing a 501 stub keeps its name, path and models. A response model changes only through a contract PR.
- Handover values are `Sourced[T]`: `origin=ai` with verbatim `Evidence`, or `origin=manual` with `entered`. Never infer or fill in a missing value.
- App state lives in IRIS SQL tables generated from the contracts (the handover as one JSON document), projected to FHIR only where data-model.md says (Q-A7, Q-I14).
- A change to `onko_contracts` is its own PR and updates the reference JSONs, tests and `data-model.md` as needed, then regenerates the client.

**Web** (WEB-*, UX-*, A11Y-*)
- **Use the existing API models for all API communication.** Read `apps/web/src/client/types.gen.ts` and the endpoint in api.md first. Call the API only through the generated TanStack Query helpers (`xxxOptions()` / `xxxMutation()`). Never redeclare model shapes, `fetch` by hand, or cast API data.
- If a screen needs data no API model has, change the contract in the backend and regenerate. Never fake it in a screen. Q-W6 permits contract-shaped MSW fixtures at the HTTP boundary for the labelled S0 demo; Q-W14 extends the exception to the S4 frontend and simulated workflow, with all business rules confined to MSW.
- **No `useEffect`** (nor `useLayoutEffect` or `useInsertionEffect`). Use the replacement table in web.md.
- Build with React function components. Use Mantine components, forms and theming for everything they offer (Q-W1).
- Follow ui-ux.md: show every `Sourced` status and origin, label AI proposals, cover loading/error/empty/success, meet WCAG 2.2 AA.
- Never edit `apps/web/src/client/**` (generated).

**Code** (PY-*)
- Start each Python file with a docstring, then `from __future__ import annotations`. Type every public function. Pass `now: datetime` in instead of reading the clock; the API edge uses the app clock (D-10).
- No logic specific to the reference case.
- Never commit `.env` or secrets.

**Tests** (TEST-*)
- New behaviour and bug fixes ship with tests. Tests run offline: in-memory repository, mocked HTTP, a fixed `now`.
- The whole suite stays under 5 minutes; CI fails a slower one. Don't raise the limit, make the test faster.
- IRIS/FHIR tests are opt-in (`ONKO_TEST_IRIS=1`) and run only in the manual *IRIS tests* workflow.

## Before you finish

Run what applies and report the real results. Run Python commands with `uv run`. Run only the tests you added or changed and the rest of that module's tests (TEST-7); CI runs the full suite:

```bash
uv run pytest packages/<module>
```
After an API or contract change, also run the API tests (they hold the OpenAPI drift check, TEST-8):
```bash
uv run pytest apps/api
```
```bash
uv run ruff check .
```
After an API or contract change, regenerate the client (a test fails if the spec is stale):
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
