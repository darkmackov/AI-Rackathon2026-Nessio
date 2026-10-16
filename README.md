# Onko-koordinace

Rakathon 2026. **VZP: Cesta pacienta bez ztráty informací** + **InterSystems challenge**.

A tool for the KOC coordinator and the referring doctor: GP referral without forms → AI handover with sources and flagged gaps → journey with an owner and due date for every step → MDT record and conclusion → confirmed delivery back to the GP. Built on InterSystems IRIS for Health in Azure (FHIR R4 with EU/CZ profiles; Vector Search in Phase 2) and our own OpenAI-compatible models.

## Start here
| Doc | What |
|---|---|
| [docs/product.md](docs/product.md) | What we build: roles, case states, screens, demo checklist |
| [docs/architecture.md](docs/architecture.md) | Modules, contracts, AI pipeline, IRIS runtime |
| [docs/data-model.md](docs/data-model.md) | Domain models ↔ FHIR R4 (HL7 Europe + CZ Core) |
| [docs/api.md](docs/api.md) | Every endpoint: request, response, status |
| [docs/slices.md](docs/slices.md) | Vertical slices and the order we build them |
| [docs/delivery.md](docs/delivery.md) | Phases, parallel streams, extension order |
| [docs/reference-case.md](docs/reference-case.md) | The test patient, expected results, traps |
| [docs/demo-script.md](docs/demo-script.md) | The demo, click by click |
| [docs/open-questions.md](docs/open-questions.md) | Every decision (Q-…) and what is still open |
| [docs/deploy.md](docs/deploy.md) | IRIS vs in-memory, testing against IRIS, FHIR server, IG packages, Azure deploy |
| [docs/conventions/](docs/conventions) | Binding conventions: [data](docs/conventions/data.md) (domain, API models, persistence), [implementation](docs/conventions/implementation.md) (modules, API, Python, git), [web](docs/conventions/web.md), [UI/UX](docs/conventions/ui-ux.md), [testing and CI](docs/conventions/testing.md) |
| [AGENTS.md](AGENTS.md) | Mandatory rules for AI agents (Claude Code loads them via `CLAUDE.md`); every module has its own |

## Repo layout
```
apps/api           FastAPI backend
apps/web           React + Vite SPA, typed client generated from the API (src/client)
packages/contracts shared Pydantic models: change these first, in their own PR
packages/*         documents, ai, llm-gateway, cases, messaging, repository, bench
data/              raw challenge data + data/vzp-structured (extracted text, reference case)
scripts/           extract_sources.py (regenerates data/vzp-structured), export_openapi.py,
                   fhir_server.py, fhir_packages.py, deploy_azure.sh (docs/deploy.md)
```

## Run
```bash
uv sync
```
```bash
uv run pytest
```
```bash
uv run uvicorn onko_api.main:app --reload
```
```bash
npm --prefix apps/web install
```
```bash
npm --prefix apps/web run dev
```
The API seeds the reference case (`ONKO_SEED_REFERENCE=1`) into an empty store, so the UI has real data before the AI pipeline exists. The web dev server proxies `/api` → `localhost:8000`.

IRIS runs as a shared instance in Azure. Copy `.env.example` to `.env` and put in **your own** connection string (`ONKO_IRIS_CONNECTION_STRING=iris://USER:PASSWORD@HOST:PORT/NAMESPACE`) and FHIR endpoint. With a connection string the API stores everything in IRIS; without one it uses the in-memory fake. Testing against IRIS, the FHIR server and the Azure deploy: [docs/deploy.md](docs/deploy.md). API docs: `http://localhost:8000/docs`.

After changing API routes or contracts, regenerate the web client (a test fails if `apps/web/openapi.json` is stale):
```bash
uv run python scripts/export_openapi.py
```
```bash
npm --prefix apps/web run gen:api
```

Open decisions and assumptions: [docs/open-questions.md](docs/open-questions.md).
