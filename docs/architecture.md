# Architecture

Goals:
- A **stable MVP fast**, then extend it.
- **Several devs in parallel** without blocking each other.
- **Meaningful use of InterSystems IRIS**, all in the MVP (Q-I17): the FHIR server for storage and exchange, Vector Search inside the AI pipeline, MKN-10 code suggestions, a read-only MCP server for agents. IRIS is used through SQL and FHIR REST only, with no ObjectScript (Q-I18). The InterSystems challenge judges this, see [the intro deck](../data/vzp-structured/brief/InterSystems_challenge_intro.md).

## Principles
1. **Contracts first.** Modules talk only through the Pydantic models in [`packages/contracts`](../packages/contracts/src/onko_contracts), each through its package's public API (`__init__.py`). Changing a contract is a PR that everyone reviews; everything else is owned by the module's owner. Rules: [conventions](conventions/).
2. **The product schema lives in code, user content lives in the database.**
   - The handover structure (from `Handover_obsah`) and the 8 case states are fixed and versioned in `contracts`.
   - Task sets, tasks, messages and documents are created by users in the UI and stored in IRIS.
   - Users never edit configs.
3. **Evidence on every AI value.** `Sourced[T]` = value + status (`found / missing / conflict`) + verbatim quotes from the source documents. It maps to FHIR `Provenance`, and the UI uses it for click-through and for the *Doplnit / Vyžádat* actions.
4. **AI proposes, a human confirms.** `Handover.validated_by_referrer` (the GP, before sending) and `Handover.confirmed_by_coordinator` (the MDT snapshot) stay empty until a person signs off. Drafts (epikríza summary, MDT question, MDT result rows, the conclusion prefill) are always editable and change nothing until a person applies them.
5. **General, not case-specific.** Extraction and checks work for any patient and any set of documents. The Procházková case is the [reference case](reference-case.md) for testing and the demo; there is no logic for it in the code.
6. **Only `repository` talks to IRIS.** Every other module can be tested against the in-memory fake, so nobody needs a running IRIS to work on their module.

## Module map

```mermaid
flowchart TD
  web["web<br/>React SPA"] -->|REST / OpenAPI| api["api<br/>FastAPI"]
  api --> cases["cases<br/>states, tasks, task sets, audit"]
  api --> ai["ai<br/>extract, check, draft"]
  api --> llm
  api --> documents["documents<br/>upload, parse, render PDF"]
  api --> messaging["messaging<br/>requests, delivery, receipts"]
  cases --> repo["repository"]
  ai --> repo
  documents --> repo
  messaging --> repo
  ai --> llm["llm_gateway"]
  llm --> models[("OpenAI-compatible<br/>model endpoints")]
  repo --> fhir[("IRIS FHIR R4<br/>EU + CZ Core")]
  repo --> sql[("IRIS SQL<br/>app tables + VECTOR")]
  bench["bench (dev tool)"] -.-> ai
  bench -.-> llm
  contracts["contracts"] -.- api
  contracts -.- web
```

| Module | Package | Owns | Main interface |
|---|---|---|---|
| contracts | `packages/contracts` | Shared Pydantic models, the handover schema, case states/transitions | is the contract |
| documents | `packages/documents` | Upload, parsers by file type (docx, pptx, pdf; images through a vision model in Phase 2), PDF rendering of the MDT record/conclusion (fpdf2 with bundled DejaVu fonts, Q-K13). Storage as `DocumentReference`/`Binary` goes through `repository` | `parse(data, mime_type) -> str`, `render_pdf(kind, html) -> bytes`, `render_mdt_record(record, conclusion) -> bytes`, `render_mdt_conclusion(conclusion, record, header) -> bytes` |
| ai | `packages/ai` | Per-document extraction into `Handover` with evidence; merge across documents; completeness and consistency checks → `Finding`s; drafts for the coordinator of what the MDT receives (epikríza summary, MDT question, MDT result one-liners; Q-F37); document chunking + embeddings, "ask the case", MKN-10 code candidates (Q-I19, Q-C11); bonus: high-precision task suggestions | `Extractor.extract(case_id, documents, as_of) -> Handover`, `analyse_case(case_id, documents, …) -> (Handover, [Finding], …)`, `check(ctx, checks) -> [Finding]`, `draft(kind, handover, findings, gateway) -> str`, `draft_results(rows, gateway) -> [MdtResultRow]` |
| llm_gateway | `packages/llm-gateway` | OpenAI-compatible client. Candidate models from env for the bench; the app uses **one active model** chosen by the bench (Q-M1) + one embedding model (Q-M2), both EU Data Zone (Q-M6), behind Azure API Management (`api-key` header). Strict structured output with one repair round, cache, token/latency log, no rate limiting (Q-M3) | `complete(messages, schema)`, `embed(texts)` |
| cases | `packages/cases` | State machine (`ALLOWED_TRANSITIONS`), queue column + manual on-hold, who is on the move, tasks with dependencies (incl. request tasks linked to findings), user-editable task sets, time to treatment, audit log; the GP's referral draft, manual handover edits, validation and sending (S3); the coordinator's workflow (S4); the MDT snapshot, record and conclusion rules (S5) | `transition`, `queue_column`, `put_on_hold` / `resume`, `start_task_set`, `next_step`, `time_to_treatment`, `new_referral`, `set_handover_field`, `add_examination`, `validate_handover`, `send_referral`, `take_over`, `manual_transition`, `return_to_referrer`, `resolve_finding`, `refresh_progress`, `due_notices`, `audit_event`, `prepare_snapshot`, `build_mdt_record`, `update_record`, `save_conclusion`, `attach_uploaded_conclusion`, `confirm_conclusion`, `conclusion_prefill` |
| messaging | `packages/messaging` | MDT result delivery to the GP's in-app inbox, receipts, in-app notifications, simulated patient notices. Phase 2: request/reply flows (Q-F23), reviewing-doctor feed (Q-F10), email/SMS adapters | `send(message, adapters, now) -> Message`, `confirm(message, recipient_id, now) -> Receipt` |
| repository | `packages/repository` | Domain ↔ FHIR R4 mapping ([data-model.md](data-model.md)), IRIS FHIR client, IRIS SQL incl. the `VECTOR` chunk and code tables, FHIR exchange resources (Q-I20), in-memory fake, connection settings | `CaseRepository` protocol, `IrisSettings` |
| api | `apps/api` | FastAPI routes, auth stub (role switcher for the demo), OpenAPI | All 63 endpoints defined in [api.md](api.md) (`routes.py` stubs return 501 until their slice lands); 8 read endpoints already serve the seeded case; the S0 directory and demo endpoints work. Current user via `X-Actor-Id`. Also hosts the read-only MCP server under `/mcp` (S10, Q-I23) |
| web | `apps/web` | All screens from [product.md](product.md) | client + TanStack Query options generated from OpenAPI |
| bench | `packages/bench` | Runs `ai.extract` + `ai.check` for every model over reference cases and scores against the expected JSONs → leaderboard | CLI `uv run onko-bench` |

## AI pipeline

```mermaid
sequenceDiagram
  autonumber
  participant U as GP / coordinator
  participant API as api
  participant D as documents
  participant AI as ai
  participant L as llm_gateway
  participant R as repository
  U->>API: upload files
  API->>D: parse(bytes, mime)
  D-->>API: ParsedDocument (text, tables as Markdown, meta)
  API->>R: save DocumentReference + Binary
  API->>AI: chunk + embed (via llm_gateway)
  AI->>R: save vector chunks
  API->>AI: extract(case documents)
  loop each document
    AI->>L: complete(doc text, Handover JSON schema)
    L-->>AI: partial Handover with quotes
  end
  AI->>AI: normalize values by deterministic code (verbatim quote kept, Q-C13)
  AI->>AI: merge (newest valid value wins, disagreements -> conflict)
  AI->>AI: verify every quote exists in its source (drop or flag otherwise; a flag shows the nearest chunk from vector search)
  AI->>AI: check: deterministic rules + LLM review -> Findings
  AI-->>API: Handover draft + Findings
  API->>R: save Composition + Provenance (agent = AI)
  U->>API: validate / fill in / request task
  API->>R: Provenance (validated by the GP / confirmed by the coordinator)
```

Checks, generic and runnable on any case:
| Type | Examples |
|---|---|
| Required field missing | ECOG, email, MKN-10 code |
| Unattached reference | A referral that lists results without attaching them |
| Temporal impossibility | A sample taken after the report was issued; medication dates vs procedure date |
| Identity consistency | RČ check digit, RČ ↔ birth date / sex / age; insurer code |
| Cross-document value conflicts | Two sources disagree on the same value |
| Trends | Weight, key labs (compared on the normalized numbers and units, Q-C13) |
| LLM clinical review | Advisory only, e.g. "cholestasis without documented drainage" |

## Runtime on IRIS

```mermaid
flowchart LR
  subgraph dev["Dev: each dev machine / Demo: Azure"]
    browser["web<br/>Vite dev"] -->|/api proxy| api2["FastAPI<br/>uvicorn"]
  end
  subgraph azure["Azure: shared IRIS for Health"]
    fhirsrv["FHIR R4 server"]
    vec["SQL tables<br/>+ VECTOR"]
  end
  api2 -->|"FHIR REST (HTTPS)"| fhirsrv
  api2 -->|"intersystems-irispython<br/>iris.connect(host:port/NS)"| vec
  api2 -->|HTTPS| llm["OpenAI-compatible endpoints"]
```

- **IRIS runs in Azure** as one shared instance. Each dev puts their own connection string in `.env` (`ONKO_IRIS_CONNECTION_STRING=iris://USER:PASSWORD@HOST:PORT/NAMESPACE`, parsed in `onko_repository.settings`), plus the FHIR endpoint URL and credentials.
- **FastAPI runs outside IRIS** and connects remotely: SQL/Vector through the official `intersystems-irispython` driver (`iris.connect("host:port/NS", user, password)`, signature checked in the installed 5.4.1 package), FHIR over REST.
- **No ObjectScript, no Embedded Python (Q-I18):** the API stays outside IRIS. No Management Portal work and no Interoperability production.
- **Where it runs (Q-I8):** in development the API and web run on each dev's machine; for the demo they're deployed in Azure next to IRIS.
- **One shared namespace (Q-I3):** day-to-day work uses the in-memory fake. Anything a dev writes to the shared IRIS uses ids prefixed with their name, so the demo data stay clean.
- **TLS (Q-I4):** optional `ONKO_IRIS_SSL_CONFIG` is passed as `sslconfig` to `iris.connect`. The FHIR endpoint uses basic auth.
- **Workflow state lives in IRIS SQL, clinical data in FHIR** (Q-A7, Q-I14): cases, tasks, findings, documents and messages are relational tables generated from the contracts; the handover's clinical content is projected to the **FHIR server** (CZ Core profiles + `Provenance`) on every save, which is the interop surface (InterSystems criterion: interoperability). Details: [data-model.md](data-model.md), [deploy.md](deploy.md).
- **Vector Search (MVP, Q-I19):** document chunks + embeddings in an IRIS SQL `VECTOR` column next to `case_id`, so one query filters by case and ranks by similarity. An exact scan per case, no approximate index. Used to flag unverified quotes with the nearest chunk, for "ask the case" (answers only with quotes that pass the verbatim check, else "not found"), and for MKN-10 code candidates the user picks (Q-C11) (criterion: GenAI + vector search). Duplicate uploads are caught by hashing and text overlap instead (Q-I22).
- **FHIR exchange (MVP, Q-I20):** the MDT conclusion as a FHIR document `Bundle` indexed by a `DocumentReference` (Bundle + PDF), tasks as FHIR `Task`, and referrals accepted as a FHIR `Bundle` (criterion: interoperability). Every FHIR write goes through an outbox in IRIS SQL and is retried until it succeeds (D-14).
- **Agent access (MVP, Q-I23):** a read-only MCP server mounted in the API under `/mcp` (streamable HTTP). Its tools call the same services as the REST endpoints and return the same contract models: case search, case summary, findings, handover with sources, "ask the case". No write tools and no in-app copilot chat (criterion: agent-based access).

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
