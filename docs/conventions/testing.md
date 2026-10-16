# Testing conventions

How tests are written, what you run locally and what CI runs. Python style rules (PY-*) apply to test files too; the in-memory rule is PY-9 in [implementation.md](implementation.md). Every rule has an ID so reviews (human or AI) can cite it, and the [root AGENTS.md](../../AGENTS.md) makes them binding for AI agents. Decisions behind this page: Q-K8 to Q-K11 in [open-questions.md](../open-questions.md#k-code-conventions).

## Writing tests

| ID | Rule |
|---|---|
| TEST-1 | Tests live in the module's own `tests/` folder as `test_<topic>.py` (PY-9). A module's tests may import its internals (MOD-2); tests of another module go through that module's package root. |
| TEST-2 | New behaviour and every bug fix ship with a test in the same PR. A bug-fix test fails without the fix. |
| TEST-3 | Tests run offline and are deterministic: `InMemoryRepository` instead of IRIS, `httpx.MockTransport` instead of HTTP, a fixed `NOW` passed in instead of the clock (PY-4), no LLM calls. |
| TEST-4 | A test name says the behaviour it checks, as in the existing tests: `test_reset_to_empty_keeps_the_directory`, not `test_reset_2`. |
| TEST-5 | Tests that need a real external system (IRIS SQL, the IRIS FHIR server) are opt-in: they `pytest.skip` unless `ONKO_TEST_IRIS=1`, write only to a throwaway schema or `test-`-prefixed ids and clean up after themselves (PER-10). They run in the manual IRIS workflow (TEST-10), never in the default suite. |

## Time budget

| ID | Rule |
|---|---|
| TEST-6 | **The whole suite runs in under 5 minutes** (Q-K8). Each CI job has `timeout-minutes: 5`, so a slower suite fails CI. Today it takes about a second, so a slow test is a bug: make it faster (smaller input, a fake instead of real I/O), don't raise the limit. Find slow tests with `uv run pytest --durations=10`. |

## What to run

| ID | Rule |
|---|---|
| TEST-7 | **Locally, run only the tests you added or changed** and the rest of that module's `tests/` (Q-K9). The full suite is CI's job. |
| TEST-8 | After an API, request-body or contract change, also run `uv run pytest apps/api`: it holds the OpenAPI drift check (APIM-7). |
| TEST-9 | A PR is ready only when CI is green (GIT-5). Don't merge a red PR. |

```bash
uv run pytest packages/cases/tests/test_cases.py::test_on_hold_is_a_manual_flag
```
```bash
uv run pytest packages/cases
```
```bash
uv run pytest apps/api
```

## CI (`.github/workflows/`)

| ID | Rule |
|---|---|
| TEST-10 | `ci.yml` runs on every pull request and every push to `main` (Q-K10): `ruff check`, the **full** `pytest` suite (IRIS tests skip), and for the web app `npm ci`, a check that the generated client matches `openapi.json`, `build` and `lint`. `iris.yml` runs the IRIS tests (TEST-5) and only starts by hand (Q-K11): GitHub → Actions → *IRIS tests* → *Run workflow*. Neither deploys; the Azure deploy stays manual (docs/deploy.md). |
| TEST-11 | CI uses the same versions as the image: Python 3.13 and the `uv` version from the `Dockerfile`, Node 24, `uv sync --frozen` and `npm ci` from the committed lock files. When you bump one, bump both. |
| TEST-12 | The IRIS workflow reads its connection from repository secrets (`ONKO_IRIS_CONNECTION_STRING`, `ONKO_FHIR_BASE_URL`, `ONKO_FHIR_USERNAME`, `ONKO_FHIR_PASSWORD`), never from a committed file (GIT-6). |

The web app has no test runner yet. Adding one (vitest or similar) is a new tool and needs a recorded decision first (WEB-9's rule for new libraries applies).
