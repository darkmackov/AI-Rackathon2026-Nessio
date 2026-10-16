# Decisions and open questions

Every question we couldn't answer from the brief, with the team's decision (16. 10. 2026) and where it lands in the code or docs. **Open** items still need an answer. Add new questions at the bottom of their section with the next free ID.

Who answers open items: **VZP** = challenge mentors, **Clin** = clinician mentor, **ISC** = InterSystems mentors, **Team** = us.

## Still open

| ID | Question | Interim assumption | Ask |
|---|---|---|---|
| Q-F8 | **Repeated MDT:** slide 4's example has two MDTs, and the sample conclusion plans another one after neoadjuvant therapy. Can a case go back from *Závěr MDT*? | Not supported. `ALLOWED_TRANSITIONS` has no way back from `zaver_mdt` | VZP |
| Q-K8 | **Time zones:** contracts use naive `datetime`s and api.md says ISO 8601. Store UTC, local time, or aware datetimes? | Unchanged (naive) | Team |
| Q-K9 | **Id scheme** for new cases, tasks, findings, messages (api.md: string ids; today slugs and composite ids from seed and `start_task_set`) | Unchanged | Team |

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
| Q-A7 | Where the MVP keeps its state? | **IRIS** (app state as JSON documents), projected to FHIR only where needed | architecture.md, slices.md S7 |
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

## I: IRIS, FHIR and infrastructure

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-I1 | Embedded Python? | Remote first (driver + FHIR REST). Move hot paths into Embedded Python later if the Azure instance allows it | architecture.md |
| Q-I2 | Azure IRIS details? | Every dev's own `.env`; never in docs or git | `.env.example` |
| Q-I3 | Namespaces? | **One shared namespace.** Devs use the in-memory fake for day-to-day work; test data written to IRIS is prefixed per dev | architecture.md |
| Q-I4 | TLS / auth? | Optional TLS (`ONKO_IRIS_SSL_CONFIG` → `iris.connect(sslconfig=…)`) + FHIR basic auth | `IrisSettings` |
| Q-I5 | Is a FHIR server set up? | Assume yes; URL in `.env` | `ONKO_FHIR_BASE_URL` |
| Q-I6 | CZ package dependency gaps? | Try loading into IRIS; if that fails, declare `meta.profile` without server-side validation | data-model.md |
| Q-I7 | Profile validation? | Declare `meta.profile` + validate in tests/CI where feasible | data-model.md |
| Q-I8 | Where does the app run? | **Demo: deployed in Azure. Development: each dev's machine** | architecture.md |
| Q-I9 | The "VZP data in Azure" from the ISC deck? | Ignore; use the repo data | |
| Q-I10 | File storage? | FHIR `DocumentReference` + `Binary` in IRIS | data-model.md |
| Q-I11 | Auth? | Role switcher (GP / coordinator) | api |
| Q-I12 | Send fictional data to our models? | Yes | |

## M: Models

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-M1 | Model capability differences? | **Pick one model** after the bench and build on its capabilities | `Gateway` (active model + embed), `.env.example` |
| Q-M2 | Embeddings? | One embedding slot from our endpoints | `ONKO_EMBED_MODEL` |
| Q-M3 | Rate limits / cost? | No limits | gateway |
| Q-M4 | Second test case? | **Now, in Phase 1** (synthetic, another diagnosis) | delivery.md |

## K: Code conventions

Asked and decided on 16. 10. 2026. The rules are in [docs/conventions](conventions).

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-K1 | What do the data conventions cover? | Domain models, API models, persistence. The `data/` folder is out of scope | data.md |
| Q-K2 | Which shapes does the web app talk to the API with? | **Main's API contract** (Q-A1 to Q-A8, api.md): responses are the contract models, request bodies live in `apps/api/schemas.py`. A separate DTO layer (`XxxDto` in `onko_contracts.dto` + mappers) was proposed the same day and **dropped in favour of main** | data.md APIM-1, APIM-2 |
| Q-K3 | JSON casing? | `snake_case`, no aliases | APIM-5 |
| Q-K4 | Module layout? | **Layered files** (`models.py`, `ports.py`, `service.py`, `adapters/`); `__init__.py` is the only public API. Existing modules restructured | MOD-2 … MOD-11 |
| Q-K5 | How are conventions enforced on AI? | `AGENTS.md` (root + per module) with `CLAUDE.md` importing it. No architecture tests or hooks | AGENTS.md |
| Q-K6 | Branch naming? | `<type>/<short-topic>`; commits stay Conventional Commits | GIT-1, GIT-2 |
| Q-K7 | Error model? | None: `{"detail": …}` with the codes in api.md | APIM-6 |

## W: Web

| ID | Question | Decision | Lands in |
|---|---|---|---|
| Q-W1 | UI component library? | **Mantine**, including its forms; use its components and theme | apps/web |
| Q-W2 | Router? | **TanStack Router**, code-based routes | apps/web |
| Q-W3 | Czech / English translations? | **i18next + react-i18next**, both dictionaries bundled; UI only | apps/web |
| Q-W4 | How does the web app load data without `useEffect`? | **TanStack Query** through hey-api's generated `xxxOptions()` / `xxxMutation()` helpers. `useEffect` is banned | web.md WEB-1, WEB-10 |
| Q-W5 | Accessibility bar? | **WCAG 2.2 AA** | ui-ux.md A11Y-* |
| Q-W6 | Does S0 implement backend endpoints? | **Frontend only, with explicit permission for contract-shaped dummy HTTP data through MSW.** Mock is the default in development and built demos; `VITE_API_MODE=real` selects the real API with no silent fallback. This is a narrow exception to WEB-4 / WEB-6 for the mock HTTP boundary, never for components. Backend stubs remain 501; no contract change | web.md, slices.md, apps/web/README.md |
| Q-W7 | Which identities can be selected? | Role plus any of the five referring doctors or five coordinators from the directory, verified by `/me`. Specialists are directory information only. Send `X-Actor-Id` explicitly; identity-dependent query keys include it. Switch to the new role's home and remove the previous identity's queries; switching is disabled during writes | apps/web |
| Q-W8 | Persist identity, language or demo changes? | **Memory only, per tab.** A reload requires choosing a person, starts in Czech and restores the reference scenario. React context holds UI identity selection only; server data stays in Query | apps/web |
| Q-W9 | Which pages belong in S0? | `/` identity picker and `/referrer` identity, workplace and contacts; shared routing sends each role to its home. **Scope clarification: the coordinator dashboard belongs to S1**, including the already existing provisional kanban retained at `/coordinator`. It is partial S1 work, not an S0 acceptance criterion. No links to future screens. Referral submission is S3, inbox S6 | product.md, slices.md |
| Q-W10 | Demo clock and resets? | Both roles can open a **Demo** panel. Start at `reference_at_mdt`, **2026-10-21 09:00**. Simulated time continues at real speed, interpreted in the **computer's local zone**, with no UTC conversion of naive datetimes. `empty` resets to **2026-10-02 14:00**, reference resets to **2026-10-21 09:00**. Reset needs confirmation, preserves identity/language, refreshes affected queries and returns to the role home. Real time is selectable. Backend timezone policy Q-K8 remains open | apps/web/README.md |
| Q-W11 | Web verification? | Vitest + React Testing Library + MSW for targeted behavior tests; manual built-browser check, keyboard and narrow layout | apps/web |
| Q-W12 | Visual baseline? | Light, compact clinical interface, blue accent, neutral surfaces and system font. No dark mode in S0 | apps/web |

These S0 choices were agreed with the user before implementation. No backend implementation or real authentication is implied by the role switcher.

## T: Tooling decisions (taken without asking; review if you disagree)

| ID | Decision | Why |
|---|---|---|
| T-1 | **TypeScript 6.0.3**, not the newest 7.0.2 | TS 7's npm package has no compiler API; `@hey-api/openapi-ts` crashed on it (`ts.SyntaxKind` undefined). Revisit when hey-api supports TS 7 |
| T-2 | `@hey-api/openapi-ts` 0.99.0 for the client | openapi-typescript 7.13.0 only supports `typescript ^5.x` |
| T-3 | `@types/node` 24.x | Matches the Node 24 runtime |
| T-4 | Python minimums pinned at the versions current on 16. 10. 2026; exact versions in `uv.lock` | `uv lock --upgrade` to bump |
| T-5 | `requires-python >= 3.11` (venv resolved 3.13) | If Embedded Python comes (Q-I1), match the IRIS Python version |
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
| D-7 | Seeded task set "Karcinom pankreatu – diagnostika do MDT": CT → EUS-FNB → histology, labs, MDT, then pain clinic and psychologist; due offsets are ours |
