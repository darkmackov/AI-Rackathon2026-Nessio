# UI/UX conventions

How the app should look and behave for its two users, the **referring doctor (GP)** and the **KOC coordinator** (Q-F21). Use this page together with [web.md](web.md) (how to build it) and [product.md](../product.md) (what to build). Every rule has an ID so reviews (human or AI) can cite it, and [apps/web/AGENTS.md](../../apps/web/AGENTS.md) makes them binding for AI agents.

Accessibility target: **WCAG 2.2 level AA** (Q-W5).

## Start from the data

| ID | Rule |
|---|---|
| UX-1 | Before designing or changing a screen, read the API models it will show and send (`apps/web/src/client/types.gen.ts`, the endpoints in [api.md](../api.md)) and its slice in [slices.md](../slices.md). The screen shows what those models contain, using the existing fields. |
| UX-2 | If the design needs a value no API model has, extend the contract in the backend first (WEB-4). Never invent, estimate or hard-code it in the UI. |
| UX-3 | A `Sourced` value always shows its `status` and its `origin` (AI with evidence, or entered manually by whom). `found` shows the value with a link to its evidence. `missing` shows a visible empty state with the *Doplnit / Vyžádat* actions. `conflict` shows every competing value with its source. A missing value is never hidden or shown as blank. |

## Product rules the UI must make visible

| ID | Rule |
|---|---|
| UX-4 | **Where is the case, who is on the move, and by when** (slide 10): every case card and case header shows the state, `on_move`, `next_step` and `next_due`. Overdue is marked with text and an icon, not colour alone. |
| UX-5 | **AI proposes, a human confirms.** AI-produced values and drafts are visibly labelled as AI proposals until validated or confirmed. Nothing AI-made is submitted, sent or confirmed without an explicit user action. |
| UX-6 | **Evidence on click:** every extracted value opens its source document with the quote highlighted. |
| UX-7 | **Gaps never block the GP** (Q-F22): missing fields in the referral are soft "fill in if you know" prompts, and *Validovat a odeslat* stays enabled. For the coordinator, a blocker finding can be overridden with a note (Q-C2), and advisory findings are labelled as advisory (Q-C3). |
| UX-8 | Use the action names from product.md and slices.md exactly: *Validovat a odeslat*, *Převzít*, *Vyžádat*, *Doplnit*, *Není k dispozici*, *Spustit sadu úkolů*, *Přidat úkol*, *Odložit*, *Informovat pacienta*, *Připravit podklad pro MDT*, *Odeslat PL*, *Potvrzuji převzetí*. |
| UX-9 | Actions with consequences outside the app or that can't be undone (send to the GP, confirm the MDT snapshot, confirm receipt) ask for confirmation in a dialog that names what will happen. Everything else acts immediately and gives feedback. |

## States and feedback

| ID | Rule |
|---|---|
| UX-10 | Every data view has four designed states: **loading** (skeleton or `role="status"` text), **error** (what failed plus a retry), **empty** (what it means plus the next action), and **success**. |
| UX-20 | Slow AI work (uploads, extraction, drafts) shows its `Job` progress and keeps the rest of the screen usable. A failed job says what failed and offers a retry. |
| UX-11 | Every user action gives visible feedback: while it runs, controls keep their appearance and prevent repeat actions, with one floating progress status outside the page layout. Never hide button text or icons behind a spinner. All date fields use `DateInput` with a persistent calendar icon. Submitting, retrying and technical failure popups preserve the page's scroll position and the compact dialog/footer layout. Reuse the original action for retry or put contextual recovery in the absolutely positioned popup; never reserve an invisible row in the dialog. Keep request/progress subscriptions local to the affected controls and preserve existing page/form DOM. Success or an error follows where the user acted. |
| UX-12 | Forms validate on submit and on blur, not on every keystroke. Errors appear next to the field in text, and the summary receives focus. |
| UX-13 | Never make users retype data the app already has (the brief's core problem, WCAG 3.3.7). Prefill from the handover and the API models. |
| UX-21 | Technical failures and invalid-submit warnings use the shared top floating Mantine notifications (Q-W18). Errors and warnings never time out; the user closes them. Preserve local field errors, page retry states and clinical findings. See [notifications.md](../notifications.md). |
| UX-22 | Validation summaries name every actually invalid field, including collection row numbers. A generic message must not replace known field names or a known business prerequisite. Never display arbitrary server exception text. |

## Layout and content

| ID | Rule |
|---|---|
| UX-14 | Information density suits clinical work: tables and compact cards over large decoration. The most important facts (patient, diagnosis, state, owner, due date) come first. |
| UX-15 | Sections the brief calls copy-ready (slide 8) have a copy action that copies plain text. |
| UX-16 | Dates and times are shown in the user's language format (Czech: `21. 10. 2026`, `14:00`). Durations such as T1/T2/T3 are shown in days. |
| UX-17 | Severity (info / warning / blocker) is shown with an icon, a text label and a colour together. Use the same mapping on every screen. |
| UX-18 | Layouts work from 1280 px wide desktop down to tablet width. The GP portal also works on a phone (it is the GP's entry point). |
| UX-19 | Language is short and concrete, and the user-facing copy is in the user's language. Clinical abbreviations follow the source documents. |

## Accessibility (WCAG 2.2 AA)

| ID | Rule |
|---|---|
| A11Y-1 | Use semantic HTML (`main`, `nav`, `section` with a heading, `button` for actions, `a` for navigation) with one `h1` per screen and headings in order. |
| A11Y-2 | Everything works by keyboard, in a logical tab order. The focus indicator is always visible and never hidden behind sticky headers (2.4.7, 2.4.11). |
| A11Y-3 | Text contrast is ≥ 4.5:1 (≥ 3:1 for large text), and UI components and focus indicators are ≥ 3:1 (1.4.3, 1.4.11). |
| A11Y-4 | Colour is never the only way to convey meaning: state, severity and overdue all have text or an icon too (1.4.1). |
| A11Y-5 | Every input has a visible label. Errors are identified in text and say how to fix them (3.3.1, 3.3.3). |
| A11Y-6 | Status changes (loaded, saved, sent) are announced with `role="status"`, errors with `role="alert"` (4.1.3). |
| A11Y-7 | Pointer targets are at least 24×24 CSS px (2.5.8). Drag and drop (document upload, kanban) always has a button alternative (2.5.7). |
| A11Y-8 | Honour `prefers-reduced-motion`. Nothing flashes or auto-advances. |
| A11Y-9 | Dialogs trap focus while open, close on Escape, and return focus to the control that opened them. |
| A11Y-10 | Pages are usable at 200 % zoom and 320 px reflow without horizontal scrolling of text (1.4.4, 1.4.10). |

Once a UI library is chosen (Q-W1), use its accessible components rather than rebuilding these behaviours (WEB-9).
