# Implementation conventions

How Python code is organised and written: module boundaries, the layout inside a module, the API layer, code style, and the git workflow. The web app has its own pages: [web.md](web.md) and [ui-ux.md](ui-ux.md). Data shapes (domain models, API models, persistence) are in [data.md](data.md).

Every rule has an ID so reviews (human or AI) can cite it. The [root AGENTS.md](../../AGENTS.md) makes these binding for AI agents. Decisions behind this page: Q-K1 to Q-K7 in [open-questions.md](../open-questions.md#k-code-conventions).

## Modules and dependencies

The architecture is modular: each package owns one capability and exposes it through a small public API. The module map is in [architecture.md](../architecture.md#module-map).

| Module | Package | May depend on |
|---|---|---|
| contracts | `onko_contracts` | pydantic only |
| documents | `onko_documents` | contracts, repository |
| llm_gateway | `onko_llm_gateway` | contracts |
| ai | `onko_ai` | contracts, llm_gateway, repository |
| cases | `onko_cases` | contracts, repository |
| messaging | `onko_messaging` | contracts, repository |
| repository | `onko_repository` | contracts |
| bench | `onko_bench` | contracts, ai, llm_gateway |
| api | `onko_api` | contracts, cases, repository, documents, ai, messaging |
| web | `apps/web` | the API over HTTP, through the generated client only |

The `repository` edges come from the architecture diagram. Add `onko-repository` to a module's `pyproject.toml` when that module first uses it, and depend only on the `CaseRepository` port, never on an adapter (PER-1).

| ID | Rule |
|---|---|
| MOD-1 | A module imports only the modules its row allows, and every one of them is declared in its `pyproject.toml`. A new edge updates this table and the architecture diagram in the same PR. No cycles. |
| MOD-2 | **A package's `__init__.py` is its only public API.** Other modules import `from onko_cases import transition`, never from `onko_cases.service` or any other submodule. A module's own tests and its own files may import its internals. Scripts in `scripts/` follow the same rule. |
| MOD-3 | `__init__.py` holds a module docstring (purpose, owner stream, key rules), re-exports, and `__all__`. No logic. |

## Module layout

Every package under `packages/` uses the same layered files. Create only the files the module needs.

```
packages/<name>/
  pyproject.toml
  README.md            owner stream, what it owns, "Done when" checklist
  AGENTS.md            rules for AI agents working in this module
  CLAUDE.md            "@AGENTS.md" (loads the same rules into Claude Code)
  src/onko_<name>/
    __init__.py        public API: docstring, re-exports, __all__ (MOD-3)
    models.py          module-local types and exceptions (not shared → not contracts)
    ports.py           Protocols: interfaces this module defines (plug-in points, dependencies)
    service.py         the logic
    adapters/          implementations of ports that touch the outside world
      __init__.py
      <technology>.py  e.g. memory.py, iris.py, office.py, in_app.py
    settings.py        optional: env config through pydantic-settings
  tests/
    test_<topic>.py
```

| ID | Rule |
|---|---|
| MOD-4 | `models.py` holds types used only inside the module or returned by its API but not shared between modules (e.g. `TimeToTreatment`, `TransitionError`, `ModelSlot`). Once two modules need a type, it moves to contracts (DM-11). |
| MOD-5 | `ports.py` holds `typing.Protocol` interfaces (e.g. `CaseRepository`, `ChannelAdapter`, `Extractor`, `Check`). Nothing concrete. |
| MOD-6 | `service.py` holds the logic as functions, or classes when they hold state. It takes its collaborators (repository, adapters, `now`) as parameters and does not build them itself. The exception is a default registry such as `PARSERS`. |
| MOD-7 | `adapters/` holds everything that does I/O: files, HTTP, IRIS, LLM endpoints. One file per technology, each implementing a port. |
| MOD-8 | Import direction inside a module: `models` ← `ports` ← `adapters` ← `service` ← `__init__`. `models.py` imports nothing from its own module, and `ports.py` only `models`. |
| MOD-9 | `settings.py` exists only if the module reads env vars. It uses pydantic-settings with the `ONKO_` prefix, secrets are `SecretStr`, and every variable is documented in `.env.example`. |
| MOD-10 | When `service.py` gets too big, split it into a `service/` package and keep the names re-exported from `__init__.py`, so callers don't change. |
| MOD-11 | `packages/contracts` is the exception to this layout: one file per topic (DM-2). |

## API layer (`apps/api`)

The endpoints, their request/response models and status codes are defined in [api.md](../api.md); slices.md says which slice implements each one.

```
apps/api/src/onko_api/
  main.py      app, middleware, router include, the read endpoints that already serve the seed
  routes.py    every other endpoint; a stub returns 501 until its slice implements it
  schemas.py   request bodies (APIM-2)
  seed.py      reference-case seed for the in-memory repository
```

| ID | Rule |
|---|---|
| API-1 | Routes are thin: take primitives or a request body → call modules through their public API → return a contract model (APIM-1). No business logic in routes. |
| API-2 | The route's return annotation is the response model (`-> Case`, `-> list[Task]`); FastAPI derives the response model from it. Status codes, tags and the `X-Actor-Id` header follow the existing routes in `routes.py`. |
| API-3 | The route function name becomes the operation id and the generated client's function name (T-7): `snake_case` verb + noun (`list_cases`, `take_over_case`). Implementing a stub keeps its name, path and models (APIM-4). |
| API-4 | Errors follow APIM-6 and translate with `raise … from None`. |
| API-5 | A route needing "now" uses the app clock (D-10), never the system clock. |
| API-6 | After any route, body or contract change, regenerate the spec and the web client (APIM-7). |

## Python style

| ID | Rule |
|---|---|
| PY-1 | Every Python file starts with a module docstring, then `from __future__ import annotations`. |
| PY-2 | Python ≥ 3.11 syntax: `X \| None`, built-in generics (`list[str]`), `StrEnum`. Type hints on every public function. |
| PY-3 | `uv run ruff check .` is clean (line length 100). |
| PY-4 | Functions that need the current time take `now: datetime` as a parameter, like `put_on_hold`, `start_task_set`, `send` and `confirm`. Only the API edge reads the clock, and it reads the app clock (D-10). |
| PY-5 | Module exceptions subclass a built-in (`TransitionError(ValueError)`) and live in `models.py`. When translating an exception, use `raise … from None`. |
| PY-6 | No case-specific logic (architecture principle 5). Never branch on reference-case ids, names or values. Reference data appears only in tests, `seed.py` and the bench. |
| PY-7 | Comments and docstrings are in English. Czech only for domain terms and user-facing text. Code that implements a decision cites its ID (`(Q-F9)`). |
| PY-8 | Env vars are read only in `settings.py` or a `from_env()` constructor, never deep in logic. |
| PY-9 | Tests live in each module's `tests/`. They run against `InMemoryRepository` with no network, IRIS or LLM. `uv run pytest` passes before every PR. |
| PY-10 | A new dependency gets a `>=` minimum at the version current when it's added, and the updated `uv.lock` is committed (T-4). |

## Git and PRs

| ID | Rule |
|---|---|
| GIT-1 | Branches are `<type>/<short-topic>` in kebab-case, e.g. `feat/take-over-case`, `fix/handover-merge`, `docs/conventions`. |
| GIT-2 | Commit messages use Conventional Commits: `<type>: <summary>`, as in the history (`feat: add initial docs`, `chore: data for VZP challenge`). Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. |
| GIT-3 | PRs target `main`, and `main` always runs the demo (delivery.md). |
| GIT-4 | A change to `onko_contracts` is its own PR, reviewed by every stream (DM-13). |
| GIT-5 | Before opening a PR: `uv run pytest`, `uv run ruff check .`, `npm --prefix apps/web run build` and `npm --prefix apps/web run lint` all pass, and the OpenAPI spec and client are regenerated if the API changed. |
| GIT-6 | Never commit `.env`, secrets or connection strings (Q-I2). Do commit the generated client and `openapi.json` (T-8). |
