# Delivery plan

## Phase 0: foundation (first, unblocks everyone)
- [x] Source data extracted: [`data/vzp-structured`](../data/vzp-structured), via [`scripts/extract_sources.py`](../scripts/extract_sources.py)
- [x] Reference case: manifest, expected handover, expected findings ([reference-case.md](reference-case.md))
- [x] `contracts` package + tests
- [x] uv workspace with module skeletons
- [ ] Every dev has an Azure IRIS connection string + FHIR endpoint in `.env`; `/metadata` → fhirVersion 4.0.1
- [ ] CZ/EU IG packages loaded into the FHIR server (dependency gaps first, see data-model.md)
- [x] FastAPI app serving the seeded reference case (local uvicorn)
- [x] Full MVP API defined: 63 endpoints with request/response models, 501 stubs, coverage checked against the brief ([api.md](api.md))
- [x] Demo directory: 5 KOCs, 5 referring doctors, coordinators, MDT boards ([`data/demo/directory.json`](../data/demo/directory.json))
- [ ] `IrisRepository` connects to Azure IRIS (`GET /health` → `"iris_configured": true` plus a real query)
- [x] Typed web client generated from the API's OpenAPI spec (`@hey-api/openapi-ts`), drift guarded by a test
- [x] `apps/web` scaffold (Vite + React + TS), placeholder kanban fed by `/cases`
- [ ] `.env` with at least one working model endpoint

## Phase 1: MVP, built in vertical slices

The build order is [slices.md](slices.md): S0 directory → S1 dashboard / S2 AI ingest / S7 IRIS in parallel → S3 GP handover → S4 coordinator workflow → S5 MDT → S6 feedback. The full API is defined in [api.md](api.md); every endpoint returns 501 until its slice implements it.

**Exit criterion:** the [demo script](demo-script.md) runs end to end for the reference case.

Module owners review changes to their module across slices:

| Stream (module owner) | Modules |
|---|---|
| A | documents, ai |
| B | llm_gateway, bench (model choice, second reference case) |
| C | cases, messaging |
| D | repository, IRIS, Azure deploy |
| E | api, web |

Integration rules (full list in [conventions](conventions/)):
- Change `contracts` first, in its own PR, then regenerate the spec and client.
- Every module ships with tests against the in-memory fake.
- `main` always runs the demo.

## Phase 2: extensions (priority order, each behind an existing interface)
1. **Additional document handovers** (Q-F23): KOC requests reach the GP's / facility's inbox, they upload, the GP re-confirms the handover.
2. **Repeated MDT rounds** if Q-F8 is answered "yes".
3. **Vector search evidence + "ask the case":** IRIS `VECTOR` (InterSystems: GenAI + vector search).
4. **Coordinator copilot agent:** tools for FHIR search, vector search, create task, draft request (InterSystems: agents).
5. **Deadline notifications:** email/SMS channel adapters.
6. **Reviewing-doctor feed** (the patient's insurer, Q-F10).
7. **Embedded Python:** move hot paths into IRIS (Q-I1).
8. **Image/scan parser** through a vision model.
9. **IRIS Interoperability production trace** for intake → extract → store (a visual showcase).
