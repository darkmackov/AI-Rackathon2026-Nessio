# Architecture

Goals:
- A **stable MVP fast**, then extend it.
- **Several devs in parallel** without blocking each other.
- **Meaningful use of InterSystems IRIS** (FHIR, Vector Search, agent tools; Embedded Python later, see below). The InterSystems challenge judges this, see [the intro deck](../data/vzp-structured/brief/InterSystems_challenge_intro.md).

## Principles
1. **Contracts first.** Modules talk only through the Pydantic models in [`packages/contracts`](../packages/contracts/src/onko_contracts), each through its package's public API (`__init__.py`). The web app talks to the API only through **DTOs** (`onko_contracts.dto`), mapped from the domain in `apps/api`. Changing a contract is a PR that everyone reviews; everything else is owned by the module's owner. Rules: [conventions](conventions/).
2. **The product schema lives in code, user content lives in the database.**
   - The handover structure (from `Handover_obsah`) and the 8 case states are fixed and versioned in `contracts`.
   - Task sets, tasks, messages and documents are created by users in the UI and stored in IRIS.
   - Doctors never edit configs.
3. **Evidence on every AI value.** `Sourced[T]` = value + status (`found / missing / conflict`) + verbatim quotes from the source documents. It maps to FHIR `Provenance`, and the UI uses it for click-through and for the *Doplnit / Vyžádat* actions.
4. **AI proposes, a human confirms.** `Handover.validated_by_referrer` (the GP, before sending) and `Handover.confirmed_by_coordinator` (the MDT snapshot) stay empty until a person signs off. Drafts (MDT conclusion, request messages) are always editable.
5. **General, not case-specific.** Extraction and checks work for any patient and any set of documents. The Procházková case is the [reference case](reference-case.md) for testing and the demo; there is no logic for it in the code.
6. **Only `repository` talks to IRIS.** Every other module can be tested against the in-memory fake, so nobody needs a running IRIS to work on their module.

## Module map

```mermaid
flowchart TD
  web["web<br/>React SPA"] -->|REST / OpenAPI| api["api<br/>FastAPI"]
  api --> cases["cases<br/>states, tasks, task sets, audit"]
  api --> ai["ai<br/>extract, check, draft"]
  api --> documents["documents<br/>upload, parse, render PDF"]
  api --> messaging["messaging<br/>requests, delivery, receipts"]
  cases --> repo["repository"]
  ai --> repo
  documents --> repo
  messaging --> repo
  ai --> llm["llm_gateway"]
  llm --> models[("OpenAI-compatible<br/>model endpoints")]
  repo --> fhir[("IRIS FHIR R4<br/>EU + CZ Core")]
  repo --> sql[("IRIS SQL<br/>VECTOR + app tables")]
  bench["bench (dev tool)"] -.-> ai
  bench -.-> llm
  contracts["contracts"] -.- api
  dto["contracts.dto<br/>DTOs"] -.- api
  dto -.- web
```

| Module | Package | Owns | Main interface |
|---|---|---|---|
| contracts | `packages/contracts` | Shared Pydantic models, the handover schema, case states/transitions; API DTOs in `onko_contracts.dto` | is the contract |
| documents | `packages/documents` | Upload, storage as `DocumentReference`/`Binary`, parsers by file type (docx, pdf; images through a vision model later), PDF rendering of the MDT record/conclusion | `parse(bytes, mime) -> ParsedDocument`, `render(kind, data) -> bytes` |
| ai | `packages/ai` | Per-document extraction into `Handover` with evidence; merge across documents; completeness and consistency checks → `Finding`s; drafting (MDT conclusion, requests) | `extract(docs) -> Handover`, `check(handover, docs) -> [Finding]`, `draft(kind, case) -> str` |
| llm_gateway | `packages/llm-gateway` | OpenAI-compatible client. Candidate models from env for the bench; the app uses **one active model** chosen by the bench (Q-M1) + one embedding model (Q-M2). Structured output per the chosen model's capabilities, cache, token/latency log, no rate limiting (Q-M3) | `complete(messages, schema)`, `embed(texts)` |
| cases | `packages/cases` | State machine (`ALLOWED_TRANSITIONS`), queue column, who is on the move, tasks with dependencies, user-editable task sets, notifications, audit log | `transition(case, to)`, `start_task_set(case, set)`, `add_task(...)` |
| messaging | `packages/messaging` | Document/info requests, MDT result delivery, the automatic reviewing-doctor feed, receipts. In-app inbox first; email/SMS adapters later | `send(message) -> Message`, `confirm(message_id, recipient)` |
| repository | `packages/repository` | Domain ↔ FHIR R4 mapping ([data-model.md](data-model.md)), IRIS FHIR client, SQL/vector tables, in-memory fake | `CaseRepository` protocol |
| api | `apps/api` | FastAPI routes on DTOs, domain ↔ DTO mappers, auth stub (role switcher for the demo), OpenAPI | `/cases`, `/documents`, `/handover`, `/tasks`, `/messages` … |
| web | `apps/web` | All screens from [product.md](product.md) | client + TanStack Query options generated from OpenAPI (DTO types) |
| bench | `packages/bench` | Runs `ai.extract` + `ai.check` for every model over reference cases and scores against the expected JSONs → leaderboard | CLI `uv run onko-bench` |

## AI pipeline

```mermaid
sequenceDiagram
  autonumber
  participant U as Doctor / coordinator
  participant API as api
  participant D as documents
  participant AI as ai
  participant L as llm_gateway
  participant R as repository
  U->>API: upload files
  API->>D: parse(bytes, mime)
  D-->>API: ParsedDocument (text, tables as Markdown, meta)
  API->>R: save DocumentReference + Binary (+ vector chunks)
  API->>AI: extract(case documents)
  loop each document
    AI->>L: complete(doc text, Handover JSON schema)
    L-->>AI: partial Handover with quotes
  end
  AI->>AI: merge (newest valid value wins, disagreements -> conflict)
  AI->>AI: verify every quote exists in its source (drop or flag otherwise)
  AI->>AI: check: deterministic rules + LLM review -> Findings
  AI-->>API: Handover draft + Findings
  API->>R: save Composition + Provenance (agent = AI)
  U->>API: validate / fill in / request
  API->>R: Provenance (validated by doctor)
```

Checks, generic and runnable on any case:
| Type | Examples |
|---|---|
| Required field missing | ECOG, email, MKN-10 code |
| Unattached reference | A referral that lists results without attaching them |
| Temporal impossibility | A sample taken after the report was issued; medication dates vs procedure date |
| Identity consistency | RČ ↔ birth date / sex / age; insurer code |
| Cross-document value conflicts | Two sources disagree on the same value |
| Trends | Weight, key labs |
| LLM clinical review | Advisory only, e.g. "cholestasis without documented drainage" |

## Runtime on IRIS

```mermaid
flowchart LR
  subgraph dev["Dev: each dev machine / Demo: Azure"]
    browser["web<br/>Vite dev"] -->|/api proxy| api2["FastAPI<br/>uvicorn"]
  end
  subgraph azure["Azure: shared IRIS for Health"]
    fhirsrv["FHIR R4 server"]
    vec["SQL tables<br/>VECTOR"]
  end
  api2 -->|"FHIR REST (HTTPS)"| fhirsrv
  api2 -->|"intersystems-irispython<br/>iris.connect(host:port/NS)"| vec
  api2 -->|HTTPS| llm["OpenAI-compatible endpoints"]
```

- **IRIS runs in Azure** as one shared instance. Each dev puts their own connection string in `.env` (`ONKO_IRIS_CONNECTION_STRING=iris://USER:PASSWORD@HOST:PORT/NAMESPACE`, parsed in `onko_repository.settings`), plus the FHIR endpoint URL and credentials.
- **FastAPI runs outside IRIS** and connects remotely: SQL/Vector through the official `intersystems-irispython` driver (`iris.connect("host:port/NS", user, password)`, signature checked in the installed 5.4.1 package), FHIR over REST.
- **Embedded Python (Q-I1):** remote first. Once the MVP works, move hot paths (vector search, the extraction trigger) into Embedded Python on the Azure instance, if it allows deploying code.
- **Where it runs (Q-I8):** in development the API and web run on each dev's machine; for the demo they're deployed in Azure next to IRIS.
- **One shared namespace (Q-I3):** day-to-day work uses the in-memory fake. Anything a dev writes to the shared IRIS uses ids prefixed with their name, so the demo data stay clean.
- **TLS (Q-I4):** optional `ONKO_IRIS_SSL_CONFIG` is passed as `sslconfig` to `iris.connect`. The FHIR endpoint uses basic auth.
- **FHIR server** is the system of record and the interop surface (InterSystems criterion: interoperability).
- **Vector Search:** document chunks + embeddings in an IRIS SQL `VECTOR` column. Used for evidence lookup and "ask the case" (criterion: GenAI + vector search).
- **Agent (Phase 2):** a coordinator copilot with tools for FHIR search, vector search, create task, draft request (criterion: agent-based access).

## Parallel streams

```mermaid
flowchart LR
  P0["Phase 0<br/>contracts, workspace, reference case, Azure IRIS access"] --> A & B & C & D & E
  A["A: documents + ai"]
  B["B: llm_gateway + bench"]
  C["C: cases + messaging"]
  D["D: repository + IRIS (Azure)"]
  E["E: api + web"]
  A & B & C & D & E --> MVP["MVP slice<br/>reference case end to end"]
```

The plan and the extension order are in [delivery.md](delivery.md).
