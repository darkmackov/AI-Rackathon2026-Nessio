# web (stream E)

S0 frontend foundation: React + Vite + TypeScript, Mantine, TanStack Router, i18next and TanStack Query. The existing provisional coordinator queue is partial **S1**, not part of S0 completion. Decisions: Q-W1–Q-W12 in [open-questions.md](../../docs/open-questions.md). Rules: [web.md](../../docs/conventions/web.md), [ui-ux.md](../../docs/conventions/ui-ux.md).

## Run without a backend

```bash
npm --prefix apps/web ci
npm --prefix apps/web run dev
```

Open the displayed local address. Choose a role and one of five doctors or five coordinators. The Lipová coordinator, Bc. Lucie Dvořáková, has the reference case; the other KOCs have an empty queue.

Mock Service Worker intercepts `/api` calls before React starts. Responses use the existing generated contract models. The **Demo · fictional data** label stays visible. Mock mode is the default in development and in plain `npm run build` output. The Docker image (the Azure demo) builds with `VITE_API_MODE=real`, because it serves the API next to the web app:

```bash
npm --prefix apps/web run build
npm --prefix apps/web run preview
```

MSW is pinned to 2.15.0. The final built-browser check found that 3.0.3 stopped intercepting requests during a longer session in the in-app browser; the same scenario passes on 2.15.0. Recheck a session longer than two minutes, including clock updates and resets, before upgrading it. Generate the matching worker with `npm exec -- msw init public --save` from `apps/web`; never hand-edit the worker script.

For hosted demos, serve over HTTPS (localhost HTTP also works for Service Workers), retain `mockServiceWorker.js` at the site root, and configure SPA fallback to `index.html` for `/referrer` and `/coordinator`. No actual authentication is implemented by selecting a role.

## S8 in the dummy demo

Open a patient's detail. **Vyhledat v případu** sits in the header above the coordinator actions. Submit a Czech question about CT, histology or laboratory results, for example `Jaký byl nález na CT?`. The result appears below the input after a simulated queued/running job. It contains only prepared, verbatim quotes; clicking a source opens it with the quote highlighted. Unknown topics return “not found”. This is a labelled fixture, not live AI or vector search. There is no conversation history.

The separate **Miroslav Havlíček (demo S8)** case belongs to the Lipová coordinator. Its source texts are snapshots from `data/reference-2`; the demo variant intentionally leaves the code missing. In **Předávka → Diagnóza → MKN-10**, click **Navrhnout kód**, then explicitly choose **Použít kód C20**. This records a manual value and an audit event; it does not resolve findings. **K řešení** also shows an unverified-quote example with its nearest source clearly distinguished from verification. Existing cases and canonical data are unchanged. Reset clears S8 jobs and selections alongside the other demo state (Q-W17).

## Connect the real API

```bash
VITE_API_MODE=real npm --prefix apps/web run dev
```

The Vite dev server proxies `/api` to FastAPI at `http://localhost:8000`. Production hosting must forward `/api` to its backend. For a real-API build, set `VITE_API_MODE=real` when building. There is no automatic fallback to dummy data. Directory, identity and demo backend endpoints still return 501 until implemented; S0 changes no Python backend or API contract.

## Pages and session lifetime

- `/`: role and person selection, verified through `/me` before entering the app.
- `/referrer`: the doctor's inbox (S6), referrals and **Nová žádost** (S3). Closed referrals are hidden until **Zobrazit uzavřené** is enabled.
- `/coordinator`: the existing provisional S1 read-only queue filtered by the selected person's KOC. Completing the dashboard and case detail remains S1 work. S0 supplies the common shell and role-based destination.
- Wrong-role addresses return to the current role's home; unidentified visitors return to selection. Unknown addresses have a not-found page.

The chosen person's id lives in the tab's `sessionStorage`, so a reload keeps the person and the page. A new tab asks for a person (then opens the requested page, or the role home if it belongs to the other role). Language and simulated data live **only in the current tab's memory**: reloading starts in Czech and restores the reference scenario. The actual `/me` response stays in Query. Identity-dependent requests explicitly include `X-Actor-Id` in their generated options and query keys. Switching identities aborts requests and removes the previous identity's cached data; writes block switching.

UI labels are Czech/English; clinical content, names and organisation names remain unchanged. Both translation dictionaries ship with the app; language switching needs no network requests or storage.

## Demo controls

Both roles can open **Demo** in the header. Times mean **computer-local time**, including the computer's DST rules. Naive API datetimes are never converted to UTC for display or input. This S0 decision does not settle backend timezone question Q-K8.

| Action | Result |
|---|---|
| Initial load / restore reference | Reference case on the MDT morning (*Kompletní*, before the MDT snapshot), 21 October 2026 at 09:00 |
| Restore empty demo | Directory only, 2 October 2026 at 14:00 |
| Set date and time | Simulated server clock continues at real speed from that moment |
| Use real time | Clock follows the computer's current time |

Resets require confirmation and restore both the scenario and its time. They retain the person and language, refresh affected queries and return to the role home. A reset or time change blocks overlapping writes and identity switching. Failure leaves a retryable error. The displayed clock polls through Query; components contain no timers or effects.

## Verification and fixtures

```bash
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix apps/web run lint
```

Tests use Vitest, Testing Library and the same MSW handlers in Node, with a new scenario for every test. UI tests are grouped per screen (`app-shell`, `coordinator-dashboard`, `case-detail`, `handover`, `findings`, `documents`) and written as user flows that query by role and label; shared steps such as `signIn`, `openReferenceCase` and `openTab` live in `src/test/shell.ts`. They cover identity isolation, routing, translations, errors, time progression, validation and confirmed resets. They test what the user sees, not the internals of the mock. `demo.test.ts` keeps the demo data identical to the canonical files in `data/`, and `i18n.test.ts` checks that Czech and English have the same keys. `test:watch` starts Vitest's watch mode.

The contract tests check every implemented successful response and the validation-error bodies against the committed `openapi.json`, with a bounded checker for the schema constructs used by S0. Required headers, query enums, missing/extra body fields, malformed JSON, optional clock reset and ISO datetime inputs are covered. Mode initialization tests verify that real mode does not activate interception and that mock startup must finish before the app starts.

This is **not a complete clone of all 62 backend operations**: the S0 directory/demo operations, S1 reads, the S2 synthetic document workflow, the S3 referral operations and the S4 coordinator operations are simulated. Unsupported operations return 501. The simulation targets documented request/response shapes; it does not promise every undocumented Pydantic coercion or version-specific validation message. Behavioral comparison with a fully implemented S0 backend is still pending because those backend routes are stubs.

The directory fixture is generated from `data/demo/directory.json`; after changing that source run:

```bash
npm --prefix apps/web run sync:demo
```

`src/mocks/reference.ts` is a typed snapshot of the existing API reference seed; keep it in sync if that seed changes. Fixtures remain at the mock HTTP boundary, never in screens. Unsupported mock API operations return 501.

Manual acceptance: test keyboard selection and submission; Tab/Shift+Tab, Escape and focus return for Demo and reset dialogs; form error summary focus; switching languages and persons; both resets; browser reload; and a narrow 320 px layout / 200% zoom. The built preview must work without a backend.

The API client in `src/client` is generated. Do not edit it manually or replace generated Query helpers with custom requests.

## S3 referring doctor workflow

Sign in as a referring doctor: `/referrer` lists that doctor's referrals and **Nová žádost** creates a draft for a chosen KOC (`/referrer/cases/$caseId`). The draft reuses the S2 document controls and the shared handover components in `src/components/handover`: the doctor uploads reports, reviews AI proposals with their sources, fills in or marks fields as not available, adds examinations, then **Validovat a odeslat** validates and sends in one confirmed action. A returned case shows the coordinator's note from the inbox, can be corrected and is resent to triage. Sent cases are read-only. The handover field form (`HandoverFieldForm`) and the PATCH handover mock are shared with the coordinator, with the backend's editor rule: the case's GP while drafting or returned, a coordinator of its KOC from triage to Complete. Tests: `referral.test.tsx`, `referral-upload.test.tsx`, `referral-contract.test.ts`.

## S4 frontend workflow (Q-W14)

S4 is implemented in the web/MSW demo; the Python coordinator endpoints are implemented too (see [api.md](../../docs/api.md)). All components call the same generated TanStack Query helpers in mock and real mode; real mode never falls back to fixtures. No contract or generated-client change is required for this frontend delivery. Shared shell, theme, dashboard cards, source panels and S2 document controls retain their existing styling.

The reference reset now contains the unchanged reference case plus **Fiktivní pacient S4**, a separate synthetic sent case at KOC Lipová. Open it as coordinator Lucie Dvořáková and:

1. **Převzít**, then use **Upravit případ** for priority, coordinator and planned MDT; **Upravit milníky** edits known symptom/treatment dates.
2. On **K řešení**, request a missing report, fill a handover field, then explicitly resolve the finding. Override requires a reason. Manual values keep the current actor and demo-clock timestamp.
3. On **Úkoly**, add/edit tasks (including status and result document), or create/edit/start a reusable task set in a single dialog. Role assignments are explicit. Dependencies determine the next step but never prevent completion; invalid links/cycles fail. A set starts only once per case; editing its template does not change instantiated tasks.
4. **Odložit** records a reason and optional planned resume date. **Obnovit** is explicit; reaching that date does not auto-resume. **Změnit stav** supports Waiting for documents and Complete, with transitions checked by MSW.
5. Upload arriving reports using the existing **Dokumenty** controls and explicitly attach the result to a task. Extraction remains synthetic, does not claim to parse uploaded bytes, and preserves manual entries and resolutions.
6. **Audit** lists append-only case events. **Notifikace** on the dashboard lists only the signed-in person's open overdue/upcoming tasks (two days by default) and links to the task.
7. **Vrátit lékaři** confirms the note and stores a `case_returned` message, which the referring doctor sees on the returned referral (S3).

S4 prepares a Complete case with planned MDT and retained provenance, findings, tasks, results and audit. MDT snapshot, final epikríza, MDT question and conclusion remain S5. Unsupported endpoints continue to return 501. Existing reset choices and memory-only session/language behavior remain; empty reset removes cases and resets task templates, while reference reset restores both cases and the seeded template.

Verification adds `coordinator-workflow-api.test.ts` (contracts and simulated backend rules) and `coordinator-workflow.test.tsx` (user-visible workflows) to the existing web suite. New strings ship in Czech and English. No additional dependencies or test framework were introduced.

## S5 MDT workflow (Q-W15)

The **MDT** tab runs the same rules in mock and real mode. The MSW mock mirrors the Python backend (Q-F34–Q-F40), and its audit events use the backend's action names (api.md).

1. **Reference case:** `reference_at_mdt` starts it *Kompletní* on the MDT morning. **Připravit podklad pro MDT** is refused while blockers are open, while documents are still processing, or when the handover quotes a report received after the MDT date. Override the missing ECOG (F01) on **K řešení** first.
2. **Snapshot:** the record is built from a frozen copy of the handover. The board's members are copied, and the results list examinations verbatim plus lab panels.
3. **Drafts:** they come back typed in `Job.draft` and change nothing until used.
   - The epikríza summary and the MDT question are AI text.
   - The AI result one-liners open in the record editor.
   - **Předvyplnit ze zápisu** is not AI. It fills only the diagnosis, code, date, place and copy in the conclusion, never the conclusion or the recommendations.
4. **Conclusion:** write it or upload the MDT's report. The report becomes a case document with normal processing and stays the source when fields are typed in. Confirmation writes the definitive diagnosis into the handover and resolves no findings. After the meeting, the conclusion can still be corrected, which needs a new confirmation.

Mock PDFs remain a labelled fixture, except that an uploaded PDF report is served as uploaded.

## S6 feedback workflow (Q-W16)

The **Komunikace** tab and the GP's inbox run the same rules in mock and real mode. The MSW mock mirrors the backend's S6 rules and audit action names. The shared shell, S0–S2 styling and document controls are preserved.

1. After confirming the MDT conclusion, open **Komunikace** and **Odeslat PL**. Review the patient, recipient, confirmed conclusion and frozen MDT input; optionally add a note and confirm sending. The message carries the note and the conclusion text; it attaches the uploaded MDT report, if any, and every document the frozen MDT input quotes. The result can be sent once, then the conclusion is locked and the GP is on the move.
2. Switch to the referring doctor. **Doručená pošta**, above the referrals, shows results and returned referrals. Expand a result to read the conclusion, recommendations and the message text, open the attachments, show the frozen MDT input, and download both PDFs. Receipt errors show a retry; no confirmation status is inferred from missing data.
3. **Potvrzuji převzetí** requires confirmation and closes the case. Both roles can inspect the receipt. It is confirmed once; a repeat is refused (409). Returned referrals link to the existing correction flow and have no receipt.
4. Closed cases disappear from the regular lists; **Zobrazit uzavřené** brings them back. Inbox messages remain visible. Tasks are retained, and later uploads update only the live case, leaving the MDT input unchanged.
5. **Informovat pacienta** records a subject and body with `simulated=true`, no recipients and no external delivery. It is available from the take-over until the case is closed, returned referrals included, and never changes the case state.

Sending, receipt confirmation and patient notices appear in **Audit** with the demo-clock timestamp. Reset clears messages and receipts; identity switching removes the previous person's cached queries. Offline checks live in `feedback-api.test.ts` and `feedback.test.tsx`.
