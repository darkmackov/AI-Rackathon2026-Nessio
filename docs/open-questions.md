# Decisions and open questions

Every question we couldn't answer from the brief, with the team's decision (16. 10. 2026) and where it lands in the code or docs. **Open** items still need an answer. Add new questions at the bottom of their section with the next free ID.

Who answers open items: **VZP** = challenge mentors, **Clin** = clinician mentor, **ISC** = InterSystems mentors, **Team** = us.

## Still open

| ID | Question | Interim assumption | Ask |
|---|---|---|---|
| Q-F8 | **Repeated MDT:** slide 4's example has two MDTs, and the sample conclusion plans another one after neoadjuvant therapy. Can a case go back from *Závěr MDT*? | Not supported. `ALLOWED_TRANSITIONS` has no way back from `zaver_mdt` | VZP |
| Q-W1 | **UI component library** (WEB-9 requires one for everything it offers) | None yet: semantic HTML only, no library added | Team |
| Q-W2 | **Router** for the web app | None yet: `App.tsx` renders the dashboard directly | Team |
| Q-W3 | **i18n library** for Czech + English (Q-F20) | None yet: UI text in Czech | Team |
| Q-K8 | **Time zones:** contracts use naive `datetime`s and api.md says ISO 8601. Store UTC, local time, or aware datetimes? | Unchanged (naive) | Team |
| Q-K9 | **Id scheme** for new cases, tasks, findings, messages (api.md: string ids; today slugs and composite ids from seed and `start_task_set`) | Unchanged | Team |
| Q-I27 | **Bitmap indexes** (Q-I26): IRIS allows them only on tables with an integer row ID. Do our generated tables (string `id` as primary key) keep IRIS's default integer row ID? | Plan bitmap indexes, check on the instance before creating them; fall back to normal indexes | Team / ISC |
| Q-K12 | **Where the shared text normalizer lives** (Q-C13): `documents` (duplicate check, Q-I22) and `ai` (quote check, chunking) both need it, and neither may depend on the other | Undecided. Options: a new `ai → documents` edge (updates the dependency table), or a pure function in `contracts` | Team |
| Q-C12 | **MKN-10 code list** for code suggestions (Q-C11): which source and version? | The ÚZIS MKN-10 classification, which is published openly; not downloaded yet | Team |
| Q-I21 | **Values that are neither AI-extracted nor typed in** (contract change, its own PR): `Sourced` allows only `origin=ai` (verbatim `Evidence` from a document) or `origin=manual` (`entered`). Two cases need more: (1) structured values from a referral FHIR `Bundle` (Q-I20); (2) an MKN-10 code a person picked from AI suggestions (Q-C11), where the record should show both the AI proposal and the human choice | Proposal: a third origin `external` that keeps a reference to the sending system (FHIR `Provenance` with the sender as agent), and a marker on manual values that they were picked from AI suggestions (FHIR `Provenance` with the person as `author` and the AI as a second agent). Until decided: Bundle attachments go through the normal extraction and structured resources are not mapped; a picked code is `origin=manual` and the suggestion is written to the audit log | Team |
| Q-I24 | **MCP library** for the MCP server (Q-I23) | FastMCP, which the InterSystems hackathon kit uses (tutorial 5.2); the official `mcp` Python SDK is the alternative. Not added to `pyproject.toml` until S10 starts | Team |
| Q-M7 | **Embedding model deployment** (Q-M2): name and dimension | Being deployed by the team in Azure (EU Data Zone, Q-M6). The dimension sets `VECTOR(DOUBLE, n)` | Team |

## F: Product and flow

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-F1 | How does the coordinator know which documents to request? | **The coordinator coordinates everything.** AI suggestions are a bonus feature and must be high-precision: better no suggestion than nonsense | product.md › Where requests and tasks come from |
| Q-F2 | Who defines task sets? | KOC staff, in the UI; in practice the coordinator (Q-F21). One set seeded from the reference case | `TaskSet`, seed.py |
| Q-F3 | May AI propose tasks from the referral text? | Yes, as dismissible proposals (under the Q-F1 precision bar) | product.md |
| Q-F4 | How do requested documents arrive? | Outside the app; the coordinator uploads them (Q-F23) | product.md, demo-script.md |
| Q-F5 | Who validates the handover? | **The referring doctor owns the handover** (Q-F22): they validate it when sending (re-confirming after additional documents is Phase 2, Q-F23). The **coordinator** confirms the MDT snapshot (see Q-F21) | `Handover.validated_by_referrer`, `Handover.confirmed_by_coordinator` |
| Q-F6 | How does the referral start, and who gets the requests for 01–06? | **The GP sends 07; the KOC then requests 01–06 from whoever holds each report** (corrected 16. 10.). In the reference case that's the GP, who ordered 02–04, was copied on 01 and 05, and knows the UZ result. Otherwise the request goes to the producing facility. The brief doesn't say who the coordinator asked ("vyžádal si … zprávy (01-06)"); its capability text says "z jiných pracovišť" (from other facilities). "Whoever holds it" covers both readings. Everything from 08 on is arranged by the KOC. The request/reply flow itself is Phase 2 (Q-F23) | product.md, demo-script.md, reference-case.md, manifest `received_at` |
| Q-F7 | Triage, rejection? | The coordinator accepts; no rejection or redirect | state machine unchanged |
| Q-F9 | What is "Odložený pacient"? | **A manual flag** set by the coordinator, with a reason and an optional resume date | `Case.on_hold`, `onko_cases.put_on_hold/resume` |
| Q-F10 | Which reviewing doctor? | The patient's insurer's revizní lékař (code 211 = ZPMV here), but **not in the MVP** | `MessageKind.REVIEW_FEED`, delivery.md Phase 2 |
| Q-F11 | Proof of delivery? | The GP clicks *Potvrzuji převzetí* | `Receipt` |
| Q-F12 | How is the MDT conclusion produced? | Written in the app (optional AI draft) or uploaded, **by the coordinator** (Q-F21) | product.md |
| Q-F13 | MDT members? | An editable roster per MDT board, pre-filled per session. Kept as information on the record; the doctors are not app users (Q-F21) | product.md |
| Q-F14 | Who writes the MDT question? | The coordinator, with an optional AI prefill | `Handover.mdt_question` |
| Q-F15 | AI-written epikríza? | **Both side by side**: the referring doctor's epikríza verbatim, plus the AI summary proposal. The coordinator writes or confirms the final one | `Handover.epicrisis_source` (verbatim), `Handover.epicrisis` (final) |
| Q-F16 | Patient communication? | A button and the logic exist, but **nothing is actually sent** | `MessageKind.PATIENT_NOTICE`, `Message.simulated` |
| Q-F17 | Deadline notifications? | In-app only | `MessageKind.NOTIFICATION` |
| Q-F18 | Time to treatment? | **In the MVP**: T1 symptom → referral, T2 referral → MDT, T3 MDT → treatment | `Case.milestones`, `onko_cases.time_to_treatment` |
| Q-F19 | KOC list? | Fictional, from the data (KOC 1 Severní, KOC 2 Lipová) | seed |
| Q-F20 | UI language? | **Czech + English UI**; data stays Czech (Q-A6) | delivery.md stream E |
| Q-F23 | Which handover flows are in the MVP? | **Two flows:** (1) **initial GP handover**: referral, AI extraction, the GP validates with soft prompts, sends. **In the MVP.** (2) **Additional document handovers** from the GP or others: request → reply in an inbox → upload → re-confirm. **Not in the MVP (Phase 2).** In the MVP the coordinator logs a request task and **uploads** the reports that arrive by other channels (01–06, 08–11) | product.md, demo-script.md, delivery.md |
| Q-F22 | Does the GP gap-fill before sending? | **The referring doctor completes and validates the handover.** Remaining gaps (ECOG, emails, …) are **soft "fill in if you know" prompts**, never blocking the GP. Referenced reports are not demanded at sending; the KOC requests them afterwards | product.md screen 1, demo-script.md |
| Q-F21 | Is the coordinator the only KOC-side user? | **Yes: the users are the GP and the coordinator.** MDT doctors appear as roster/signatory information only | product.md roles |

## A: API design (decided 16. 10.)

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-A1 | Slow AI work vs request/response? | **Async jobs**: uploads and drafts return a `Job`, the UI polls `GET /jobs/{id}` | `onko_contracts.Job`, api.md |
| Q-A2 | Provenance of manually entered values? | `Sourced.origin` = `ai` (needs evidence) / `manual` (needs `entered`), enforced by the contract | `onko_contracts.common` |
| Q-A3 | MDT record and conclusion structures? | Modelled per `MDT_zapis` / `MDT_zaver` | `onko_contracts.mdt` |
| Q-A4 | Recording finding resolutions? | `Finding.resolution` {kind resolved / overridden / dismissed, note, by, at}; an override needs a note | `onko_contracts.findings` |
| Q-A5 | People and places? | Directory of organisations + actors + MDT boards, seeded | `onko_contracts.directory`, `mdt.MdtBoard` |
| Q-A6 | Multilingual scope? | **UI only**. Data, findings, notes and drafts stay Czech (`message_cs`) | refines Q-F20 |
| Q-A7 | Where the MVP keeps its state? | **IRIS** (app state in IRIS SQL; layout refined by Q-I14), projected to FHIR only where needed | architecture.md, slices.md S7 |
| Q-A8 | Who sets document metadata (type, date, facility)? | **AI-extracted** by the ingest job; optional in `DocumentMeta` until then | `onko_contracts.documents` |

## C: Clinical and data interpretation

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-C1 | Date conflicts in 09 and 11 deliberate? | Deliberate traps; `temporal` finding, warning, request clarification | F07, F08 |
| Q-C2 | Missing ECOG? | A blocker the coordinator **can override** with a note | `Finding.overridable`, F01 |
| Q-C3 | Raise "no documented biliary drainage"? | Yes, as **advisory** info, clearly marked as such | `Finding.advisory`, F06 |
| Q-C4 | Which fields are required? | Everything in `Handover_obsah` + `MDT_zapis`; contact emails at warning level | F02, F03 |
| Q-C5 | Derive sex from the RČ? | Yes, with a "derived from RČ" note | expected_handover `patient.sex` |
| Q-C6 | Stale weight? | Use 65 kg and add an info finding that it's 5 weeks old | F12 |
| Q-C7 | Which examinations to list? | **All of them**, including the GP's own examinations (04 on 1. 9., 07 on 2. 10.) | expected_handover `examinations` |
| Q-C8 | What is "popis výsledků v plném znění"? | **All clinical sections verbatim** (findings, ZÁVĚR, DOPORUČENÍ). The administrative header and signature are dropped and kept as metadata | `Examination.result_full_text`, enforced verbatim by a test |
| Q-C9 | Confirm MKN-10 C25.0? | Yes: provisional, with a review finding, until the coordinator records the definitive code from the MDT conclusion | F05 |
| Q-C10 | `received_at` dates? | 07 on 2. 10. 2026 14:00 (the real referral date). 01–06 on **2. 10. 16:00**: the request and the GP's reply on the same day, as close to the original dates as possible. **Checked against the materials:** the brief gives no arrival date for 01–06, so this time is simulated. 08–13 on their document dates | manifest.json |
| Q-C11 | AI suggestions for MKN-10 codes vs "never infer"? | **A proposal the user picks** (16. 10.): when a diagnosis has no code, the code field stays `missing` and the UI shows the top MKN-10 candidates, labelled as AI. Candidates come from vector search over the code list (Q-I19). Nothing is filled in automatically. The picked code is stored as `origin=manual`, and the fact that it came from AI suggestions is kept (in the audit log until Q-I21 adds it to the contract). Code list: Q-C12 | architecture.md, slices.md S8 |
| Q-C13 | Do we normalize extracted data? | **Yes, values only, not the database schema** (16. 10.; Q-I14 stays). The rule: **the verbatim text stays as the evidence, the normalized value is computed next to it by deterministic code, never by the model.** A value that can't be normalized keeps its raw form and raises a finding; nothing is guessed. Four parts: (1) **text for matching**: Unicode NFC, collapsed whitespace, non-breaking spaces, PDF line-break hyphens, typographic quotes and dashes, applied before the quote check, chunking and the duplicate check; offsets still point into the original text (where it lives: Q-K12); (2) **identifiers**: RČ in one canonical form with check-digit validation, phones as E.164 (`+420…`), emails lowercased, insurer code as 3 digits; (3) **lab values**: the printed value stays, plus a parsed number (decimal comma), a comparator (`<`, `>`) and a UCUM unit (contract change); (4) **performance status** as scale (ECOG / Karnofsky) + score (contract change), and weight/height converted to kg/cm (`1,65 m` → 165) with the quote kept | slices.md S2, architecture.md, data-model.md |

## I: IRIS, FHIR and infrastructure

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-I1 | Embedded Python? | **No** (superseded by Q-I18): the API stays outside IRIS and talks to it through the driver and FHIR REST | architecture.md |
| Q-I2 | Azure IRIS details? | Every dev's own `.env`; never in docs or git | `.env.example` |
| Q-I3 | Namespaces? | **One shared namespace.** Devs use the in-memory fake for day-to-day work; test data written to IRIS is prefixed per dev | architecture.md |
| Q-I4 | TLS / auth? | Optional TLS (`ONKO_IRIS_SSL_CONFIG` → `iris.connect(sslconfig=…)`) + FHIR basic auth | `IrisSettings` |
| Q-I5 | Is a FHIR server set up? | Assume yes; URL in `.env` | `ONKO_FHIR_BASE_URL` |
| Q-I6 | CZ package dependency gaps? | Try loading into IRIS; if that fails, declare `meta.profile` without server-side validation | data-model.md |
| Q-I7 | Profile validation? | Declare `meta.profile` + validate in tests/CI where feasible. **Refined 16. 10. (Q-I25):** the opt-in IRIS tests validate with the server's own `$validate` | data-model.md |
| Q-I8 | Where does the app run? | **Demo: deployed in Azure. Development: each dev's machine** | architecture.md |
| Q-I9 | The "VZP data in Azure" from the ISC deck? | Ignore; use the repo data | |
| Q-I10 | File storage? | FHIR `DocumentReference` + `Binary` in IRIS | data-model.md |
| Q-I11 | Auth? | Role switcher (GP / coordinator) | api |
| Q-I12 | Send fictional data to our models? | Yes | |
| Q-I13 | Which repository does the API use? | **IRIS automatically when `ONKO_IRIS_CONNECTION_STRING` is set**, otherwise the in-memory fake. An empty store is seeded with the reference case, so IRIS keeps the demo state across restarts. API tests always use the fake | `onko_api.main.make_repository`, docs/deploy.md |
| Q-I14 | App-state layout in IRIS SQL? | **Relational tables generated from the contract models** (typed column per field, nested models flattened, lists as JSON), with missing columns added on start so contract changes need no migration. Only the **handover** stays one JSON document (queryable with `JSON_TABLE`); its clinical content goes to FHIR. Plain JSON bodies were dropped: weak use of IRIS for the InterSystems criterion | data-model.md › Non-FHIR storage |
| Q-I15 | How is the demo deployed? | **One container** (API under `/api`, web at `/`) on **Azure Container Apps**, one replica. `scripts/deploy_azure.sh` is run by a dev with their own `az login`; Claude never touches the Azure account | Dockerfile, docs/deploy.md |
| Q-I16 | Is a FHIR server set up on the Azure IRIS? | It wasn't (16. 10.): being created with `scripts/fhir_server.py` (not confirmed ready yet), namespace `FHIRSERVER`, endpoint `/fhir/r4` on the web port, base R4 metadata | scripts/fhir_server.py |
| Q-I17 | Which InterSystems features go into the MVP? | Decided 16. 10., **pulled into the MVP** (not Phase 2): **Vector Search** in the AI pipeline (Q-I19), **FHIR exchange** in and out (Q-I20), **MKN-10 code suggestions** (Q-C11), and a **read-only MCP server** for agents (Q-I23, added the same day). No in-app copilot chat | architecture.md, delivery.md, slices.md S8, S9 |
| Q-I18 | How deep do we go into IRIS? | **SQL (including `VECTOR`) through the driver and FHIR REST only.** No Management Portal work and no ObjectScript: no Interoperability production (so no HL7v2 → FHIR lab feed) and no Embedded Python. The existing FHIR server setup over the Native API (`scripts/fhir_server.py`) stays | architecture.md |
| Q-I19 | What does Vector Search do? | Parsed documents are split into chunks along their sections, each with its document id and character offsets, and embedded into an IRIS SQL `VECTOR` column next to `case_id`. Case-scoped queries are an **exact scan** filtered by `case_id` (tens of chunks per case; an approximate HNSW index combined with a filter can miss rows); HNSW is at most for the MKN-10 table. Used for: (1) a quote not found verbatim is flagged and shown with the nearest chunk, never accepted (D-2 unchanged); (2) **"ask the case"**: retrieve the top chunks, the model answers only with quotes, every quote is checked verbatim like extraction, and the answer is "not found" when no quote passes (no similarity cut-off, scores aren't calibrated across models); (3) MKN-10 code candidates (Q-C11). Duplicate uploads are **not** a vector-search job (Q-I22) | data-model.md › Non-FHIR storage, slices.md S8 |
| Q-I20 | What FHIR exchange is in the MVP? | **Out:** the MDT conclusion as a FHIR **document `Bundle`** per the FHIR R4 rules: `Composition` first, then only the resources it references (`Patient`, `Practitioner`s, `Condition`, results, …); a unique `Bundle.identifier` and a timestamp; never changed once assembled, so a corrected conclusion is a new Bundle with a new identifier. A separate **`DocumentReference`** indexes it, with two attachments: the Bundle and the PDF. Tasks, including request tasks, projected as FHIR `Task` (requester = KOC, owner = whoever holds the report; the pattern of the Da Vinci CDex guide). **In:** a referral accepted as a FHIR `Bundle` next to file upload (open detail: Q-I21). Exchange writes go through the outbox (D-14). HL7v2 is out (Q-I18) | data-model.md, slices.md S9 |
| Q-I22 | How are duplicate uploads detected? | **Not by embeddings**: similar reports from one department share a template and would look like duplicates. A **SHA-256 hash** of the bytes catches exact copies; **word-shingle overlap** (Jaccard) of the parsed text catches near copies, e.g. the same report sent by the GP and by the facility. A match is a warning, never a blocked upload | slices.md S2 |
| Q-I23 | Agent access (InterSystems criterion: agents)? | **A read-only MCP server** (16. 10.), so any agent (Claude Desktop, the kit's examples) can work with KOC data. Streamable HTTP, **mounted in the FastAPI app under `/mcp`**, so it ships in the same container on Azure and needs no new module. Same `X-Actor-Id` role check as the REST API. Tools only read and call the same services as the REST endpoints, returning the same contract models: case search, case summary (state, who is on the move, due date), findings, handover with sources, "ask the case" (S8). **No write tools**, so "AI proposes, a human confirms" holds. No FHIR tool: the API never exposes FHIR (api.md), and an agent can read the IRIS FHIR server directly. Library: Q-I24 | architecture.md, api.md, slices.md S10 |
| Q-I25 | More standard FHIR operations on the IRIS server? | Yes, two (16. 10.): **`$validate`**: the opt-in IRIS tests (`ONKO_TEST_IRIS=1`, TEST-12) send every projected resource to the server's `$validate` against its declared `meta.profile`, so conformance to the CZ/EU profiles is checked, not just declared (only where the packages loaded, Q-I6). Not run on every save (latency). **`Patient/$everything`**: the whole case as one FHIR Bundle, e.g. for a receiving hospital, read **straight from the IRIS FHIR server**, not through our API (which never exposes FHIR). Not chosen: FHIR SQL Builder, terminology operations, Subscriptions | data-model.md, slices.md S9, demo-script.md |
| Q-I26 | Database design changes? | Decided 16. 10., all plain IRIS SQL (Q-I18). **Split a list into its own table only when it's queried across parents**; lists always read with their parent stay JSON (evidence, `depends_on`, task-set steps, board members), the handover stays one JSON document and the MDT snapshot stays a copy (Q-I14, PER-9). Changes: (1) **`app_message_recipient(message_id, recipient_id)`**, indexed on `recipient_id`, so the GP inbox is an indexed lookup instead of a JSON scan; (2) **`app_audit`**, one row per event, **append-only** (never updated or deleted outside the demo reset), indexed on `case_id`, and projected to FHIR `AuditEvent` through the outbox (D-14); (3) **foreign keys** from `case_id` and `document_id` to `app_case` / `app_document`, with the demo reset deleting child tables first and the in-memory fake rejecting the same missing references (PER-3); (4) **bitmap indexes** on low-cardinality filter columns (`state`, `queue`, `kind`, `role`), pending Q-I27. Production path, not MVP: logging reads of patient data and a tamper-evident audit log | data-model.md › Non-FHIR storage, slices.md S4, S6, S7, S9, conventions/data.md PER-13 |

## M: Models

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-M1 | Model capability differences? | **Pick one model** after the bench and build on its capabilities. It must be an EU Data Zone model (Q-M6) | `Gateway` (active model + embed), `.env.example` |
| Q-M2 | Embeddings? | One embedding slot from our endpoints. None was deployed on 16. 10.; the team deploys one in Azure (Q-M7) | `ONKO_EMBED_MODEL` |
| Q-M3 | Rate limits / cost? | No limits | gateway |
| Q-M4 | Second test case? | **Now, in Phase 1** (synthetic, another diagnosis) | delivery.md |
| Q-M5 | Which models does the bench compare? | The Azure deployments (16. 10.): **gpt-6.1-sol** and **gpt-6-luna** (EU Data Zone), **gpt-6-astra**, **DeepSeek-V4-Pro**, **grok-4.7**, **MAI-Thinking-1** (Global). Not MAI-Image-2.5 (generates images, can't read scans) or Kimi-K2.7-Code (a code model) | `.env.example`, bench |
| Q-M6 | Data residency? | **The app's active model and the embedding model must be EU Data Zone** (today gpt-6.1-sol or gpt-6-luna). The bench may run every candidate, because the data is fictional (Q-I12); Global models are reference points only | `.env.example`, architecture.md |

## K: Code conventions

Asked and decided on 16. 10. 2026 (Q-K8 to Q-K11 later the same day). The rules are in [docs/conventions](conventions).

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-K1 | What do the data conventions cover? | Domain models, API models, persistence. The `data/` folder is out of scope | data.md |
| Q-K2 | Which shapes does the web app talk to the API with? | **Main's API contract** (Q-A1 to Q-A8, api.md): responses are the contract models, request bodies live in `apps/api/schemas.py`. A separate DTO layer (`XxxDto` in `onko_contracts.dto` + mappers) was proposed the same day and **dropped in favour of main** | data.md APIM-1, APIM-2 |
| Q-K3 | JSON casing? | `snake_case`, no aliases | APIM-5 |
| Q-K4 | Module layout? | **Layered files** (`models.py`, `ports.py`, `service.py`, `adapters/`); `__init__.py` is the only public API. Existing modules restructured | MOD-2 … MOD-11 |
| Q-K5 | How are conventions enforced on AI? | `AGENTS.md` (root + per module) with `CLAUDE.md` importing it. No architecture tests or hooks | AGENTS.md |
| Q-K6 | Branch naming? | `<type>/<short-topic>`; commits stay Conventional Commits | GIT-1, GIT-2 |
| Q-K7 | Error model? | None: `{"detail": …}` with the codes in api.md | APIM-6 |
| Q-K8 | Test time limit? | **The whole suite (each CI job) under 5 minutes**, enforced by `timeout-minutes: 5`. No per-test timeout, so no `pytest-timeout` | testing.md TEST-6 |
| Q-K9 | What do devs run locally? | **Only new or changed tests** and that module's tests; CI runs everything | TEST-7 |
| Q-K10 | CI? | GitHub Actions on every PR and push to `main`: ruff, full pytest, web client drift check, build and lint. No web test runner yet. **No CD**: the Azure deploy stays manual | `.github/workflows/ci.yml`, TEST-10 |
| Q-K11 | IRIS tests in CI? | **A separate, manually started workflow** with the connection in repository secrets | `.github/workflows/iris.yml`, TEST-12 |

## W: Web

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-W4 | How does the web app load data without `useEffect`? | **TanStack Query** through hey-api's generated `xxxOptions()` / `xxxMutation()` helpers. `useEffect` is banned | web.md WEB-1, WEB-10 |
| Q-W5 | Accessibility bar? | **WCAG 2.2 AA** | ui-ux.md A11Y-* |

Q-W1 to Q-W3 (UI library, router, i18n) are still open, see the top of this page.

## T: Tooling decisions (taken without asking; review if you disagree)

| ID | Decision | Why |
|---|---|---|
| T-1 | **TypeScript 6.0.3**, not the newest 7.0.2 | TS 7's npm package has no compiler API; `@hey-api/openapi-ts` crashed on it (`ts.SyntaxKind` undefined). Revisit when hey-api supports TS 7 |
| T-2 | `@hey-api/openapi-ts` 0.99.0 for the client | openapi-typescript 7.13.0 only supports `typescript ^5.x` |
| T-3 | `@types/node` 24.x | Matches the Node 24 runtime |
| T-4 | Python minimums pinned at the versions current on 16. 10. 2026; exact versions in `uv.lock` | `uv lock --upgrade` to bump |
| T-5 | `requires-python >= 3.11` (venv resolved 3.13) | No Embedded Python (Q-I18), so it needn't match the IRIS Python version |
| T-6 | Connection string format `iris://USER:PASSWORD@HOST:PORT/NAMESPACE` | Our convention; parsed into the `iris.connect("host:port/NS", user, password)` form documented by the installed driver |
| T-7 | FastAPI operation ids = route function names | Readable generated client |
| T-8 | Generated client + `openapi.json` committed; a test fails when stale | Frontend works without a running API |
| T-9 | In-memory repository seeded with the reference case | Unblocks UI work until `IrisRepository` lands |
| T-10 | `@tanstack/react-query` pinned to 5.104.1, the newest release at least two weeks old on 16. 10. 2026 | Supply-chain caution; bump deliberately |

## D: Design decisions (taken without asking; review if you disagree)

| ID | Decision |
|---|---|
| D-1 | Handover structure is fixed product schema (`contracts/handover.py`), versioned, 1:1 with `Handover_obsah` (+ the Q-F15 split) |
| D-2 | Every AI value carries verbatim quotes; a quote not found in its source is dropped or flagged |
| D-3 | The MDT cut-off is a frozen snapshot (`as_of`) taken at *Připraveno k MDT* |
| D-4 | Extra transition *Kompletní → Čeká na podklady* |
| D-5 | FHIR: case = `EpisodeOfCare` + `CarePlan`; findings = `DetectedIssue`; task sets = `PlanDefinition`; evidence = `cz-provenance` |
| D-6 | Severity scale info / warning / blocker, and the severities in `expected_findings.json` |
| D-8 | Extra pre-referral state `koncept` (GP draft, not on the KOC dashboard) before *Odesláno* |
| D-9 | Current user passed as `X-Actor-Id` header (role switcher); no real auth in the MVP |
| D-10 | An app clock (`/demo/clock`) and `received_at` on uploads let the 2.–27. 10. story play in minutes; every "now" uses the clock |
| D-11 | Priority (`normal` / `high` / `urgent`) on cases and tasks (slide 9); the reference case is `high` (the GP asked for urgent handling) |
| D-12 | The demo directory is fictional apart from the reference-case people and facilities; insurer codes are the real public ones |
| D-13 | Naive datetimes (Q-K8) are treated as Europe/Prague local time when projected to FHIR, whose instants need a zone |
| D-14 | FHIR projection is written on every repository save **through an outbox** (revised 16. 10.): the pending FHIR write is stored in an IRIS SQL table in the same transaction as the app-state save, then sent and retried until it succeeds. A failure never loses the app-state save and is never silent: pending writes are visible (e.g. in `/health`). Needed because FHIR is now how results reach the GP (Q-I20) |
| D-7 | Seeded task set "Karcinom pankreatu – diagnostika do MDT": CT → EUS-FNB → histology, labs, MDT, then pain clinic and psychologist; due offsets are ours |
