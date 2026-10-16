# Product: Onko-koordinace

A working tool for the **KOC coordinator** and the doctors around them. It takes one oncology case from referral to confirmed feedback without losing information. Everything is done in the UI: no configs, no code, no long forms.

Sources:
- the challenge brief: [Zadani_ulohy](../data/vzp-structured/brief/Zadani_ulohy.md)
- the VZP slides: [VZP_prezentace](../data/vzp-structured/brief/VZP_prezentace.md)
- the handover fields: [Handover_obsah](../data/vzp-structured/brief/Handover_obsah.md)
- the MDT record template: [MDT_zapis](../data/vzp-structured/brief/MDT_zapis.md)
- the sample MDT conclusion: [MDT zaver](../data/vzp-structured/brief/MDT%20zaver.md)

## The problem: information gets lost in three places

| Where | What goes wrong today | What we fix |
|---|---|---|
| **Na vstupu** (at intake) | Documentation arrives fragmented, over many channels, often incomplete. Doctors retype data that already exists | One digital entry point: upload the reports and AI prefills the rest |
| **Uvnitř KOC** (inside the KOC) | The coordinator chases documents instead of coordinating. Nobody has a shared view of state, dates or who is responsible. The MDT gets late or incomplete input | AI handover with gaps flagged, kanban with an owner and due date for every next step, a journey plan |
| **Na výstupu** (at output) | The referring doctor can't easily see whether the patient was accepted, what is missing, or what the MDT decided | A structured MDT result with the original context goes back, and delivery is confirmed |

Timing goal (slide 4): **time to treatment = T1 + T2 + T3**, shown on every case in the MVP (Q-F18):
- **T1:** symptom onset → referral to the KOC
- **T2:** referral → MDT
- **T3:** MDT → treatment start

The coordinator watches it.

Decisions behind this page are recorded in [open-questions.md](open-questions.md) (Q-…).

## Roles

| Role | Does in the app |
|---|---|
There are **two users: the referring doctor and the KOC coordinator** (Q-F21).

| Role | Does in the app |
|---|---|
| **Referring doctor** (GP / specialist) | **Owns the handover** (Q-F22). Picks a KOC → uploads the referral (epikríza, plus whatever is at hand) → reviews the AI-extracted handover, with soft "fill in if you know" prompts for gaps → validates → sends. Later **answers KOC requests** (e.g. supplies the reports the referral mentioned) and confirms the updated handover. Receives the MDT result and confirms receipt |
| **KOC coordinator** | Works the queue. Takes over cases. Coordinates everything after the referral: arranges examinations, requests and uploads their results, fills remaining gaps, starts task sets or adds one-off tasks, flags cases as on hold. Writes the MDT question and the final epikríza. Confirms the MDT snapshot. Records the MDT conclusion (writes it or uploads it). Sends it to the GP |

Not users, but present as information:
- **MDT doctors:** a roster per MDT board (Q-F13). They are recorded on the MDT record as members and signatories.
- **Reviewing doctor** (revizní lékař of the patient's insurer): an automatic feed is planned for Phase 2 (Q-F10).

## The four pillars (slide 6)

```mermaid
flowchart LR
  A["01 Převzít<br/>(take over)<br/>work with what exists"] --> B["02 Vytěžit<br/>(extract)<br/>AI pulls data, flags gaps"]
  B --> C["03 Koordinovat<br/>(coordinate)<br/>state, dates, who's on the move"]
  C --> D["04 Zpětná vazba<br/>(feedback)<br/>close the loop"]
```

## Case states (slide 10)

At every moment it must be clear **where the case is, who is "na tahu" (on the move) and by when**.

```mermaid
stateDiagram-v2
  direction LR
  state "1 Odesláno" as S1
  state "2 V triage" as S2
  state "3 Čeká na podklady" as S3
  state "4 Kompletní" as S4
  state "5 Připraveno k MDT" as S5
  state "6 Závěr KOC / MDT" as S6
  state "7 Zpětná vazba odeslána" as S7
  state "8 Uzavřeno" as S8
  [*] --> S1
  S1 --> S2
  S2 --> S3: chybí podklady
  S2 --> S4: vše dodáno
  S3 --> S4
  S4 --> S3: nový požadavek
  S4 --> S5: snapshot handoveru
  S5 --> S6
  S6 --> S7
  S7 --> S8: potvrzené převzetí
  S8 --> [*]
```

| State | Meaning (from the slides) |
|---|---|
| Odesláno (sent) | The referring doctor sent the request and the available documents |
| V triage (in triage) | The case is accepted and checked; the documents get a first assessment |
| Čeká na podklady (waiting for documents) | The system found missing information and asked for it |
| Kompletní (complete) | All required documents are in and prepared for the next step |
| Připraveno k MDT (ready for MDT) | The case is complete and handed to the KOC/MDT for expert review |
| Závěr KOC/MDT (KOC/MDT conclusion) | The expert team decided the next step and wrote recommendations |
| Zpětná vazba odeslána (feedback sent) | The result and recommendations went back in structured form |
| Uzavřeno (closed) | The case is closed and archived; the audit trail is kept |

Dashboard columns (slide 9):
- **Nový** (new): states 1–2, waiting to be taken over.
- **Aktivní** (active): everything else.
- **Odložený** (on hold): a **manual flag** the coordinator sets with a reason and an optional resume date (Q-F9), e.g. "waiting for a CT slot at KOC 1".

## Screens (MVP)

1. **Referral (GP portal), slide 7.**
   - Pick a KOC → drag and drop **all reports for the initial handover**.
   - AI extracts the handover: patient details, contacts, suspected diagnosis, referrer contact, and so on.
   - The GP reviews the extracted handover. Empty fields (e.g. ECOG, the patient's email) appear as **soft "fill in if you know" prompts** that never block sending (Q-F22).
   - *Validovat a odeslat* (validate and send).
   - Later, KOC requests show up in the GP's inbox (e.g. "please send the results 07 mentions") → the GP uploads them → re-extraction → the GP confirms the updated handover, again with soft prompts for anything still missing.
   - Done when: the coordinator gets everything in one step, and the GP answers requests in the same place.
2. **Coordinator dashboard, slide 9.**
   - Kanban with Nový / Aktivní / Odložený (manual flag).
   - Each card shows patient, diagnosis, state, next step, owner, due date, priority/overdue, and time to treatment so far.
   - In-app notifications for upcoming and overdue tasks (Q-F17).
   - Done when: every patient shows their state, due date and who is on the move.
3. **Case detail.**
   - Tabs: *Handover · Dokumenty (documents) · Úkoly/cesta (tasks/journey) · Komunikace (communication) · Audit*.
   - Every handover value links to its source document with the quote highlighted.
   - Gaps and conflicts sit at the top, each with **Vyžádat** (request; a message or task to the right person) or **Doplnit** (fill in manually or upload, and AI re-extracts).
   - Every section is copy-ready (slide 8).
   - **Epikríza side by side** (Q-F15): the referring doctor's text verbatim next to the AI summary proposal; the coordinator writes or confirms the final version.
   - **MDT question**: written by the coordinator, optionally prefilled by AI (Q-F14).
   - Examinations list **everything** done (GP examinations too), each with all clinical sections verbatim (Q-C7, Q-C8).
   - *Odložit* (put on hold) with a reason and a resume date.
   - *Informovat pacienta* (inform the patient): composes a message (e.g. appointment details). It is recorded as sent but **not actually delivered** (Q-F16).
4. **Journey / tasks, slide 10.**
   - *Spustit sadu úkolů* (start a task set; for example the pancreatic-cancer set) or *Přidat úkol* (add a one-off task).
   - Each task has type, place, date, owner, status and dependencies (what must come first).
   - Task sets are created and edited **in the UI** by coordinators.
   - Deadline notifications.
5. **MDT.**
   - *Připravit podklad pro MDT* (prepare MDT input) freezes a snapshot of the handover at the MDT date; the coordinator confirms it.
   - That produces the MDT record in the `MDT_zapis` layout: members from the board roster, diagnosis + MKN-10, comorbidities, results table.
   - After the meeting the coordinator **records the conclusion** and recommendations, either by writing them (an AI draft from the record is allowed) or by uploading the MDT's own report (Q-F12) → `MDT_zaver` document.
6. **Feedback, slide 11.**
   - Send to the referring doctor (result + original context). The reviewing-doctor feed comes in Phase 2.
   - The recipient clicks *Potvrzuji převzetí* (I confirm receipt) → the receipt goes into the audit → case closed.

## Where requests and tasks come from

Decided in Q-F1 to Q-F6 and Q-F22.

```mermaid
flowchart TD
  subgraph gp["Referring doctor: owns the handover"]
    up["Uploads referral (07)"] --> ext["AI extraction"]
    ext --> rev["Reviews handover,<br/>soft 'fill in if you know' prompts"]
    rev --> send["Validovat a odeslat"]
    inbox["Request in GP inbox"] --> supply["Uploads requested reports"]
    supply --> ext2["Re-extraction"] --> confirm["Confirms updated handover"]
  end
  subgraph koc["Coordinator: coordinates everything else"]
    take["Takes over"] --> detect["Sees what is referenced<br/>but not attached (F09)"]
    detect --> req["Requests each report from<br/>whoever holds it"]
    take --> plan["Starts task set /<br/>one-off tasks"]
    plan --> arrange["Arranges exams (08+),<br/>uploads results"]
    sugg["Bonus: AI suggestions<br/>(dismissible, high precision)"] -.-> plan
  end
  send --> take
  req -->|"held by the GP"| inbox
  req -->|"held by a facility"| fac["Facility replies,<br/>coordinator uploads"]
```

**The referring doctor owns the handover (Q-F22).**
- The GP sends the referral and validates the extracted handover. Gaps are soft "fill in if you know" prompts that never block sending.
- When the KOC asks for something the GP holds, it arrives in the GP's inbox. The GP uploads it and confirms the updated handover.

**The coordinator coordinates everything else (Q-F1).**
- After taking over, the coordinator sees what the referral mentions but doesn't include. In the reference case that's 07's five results "at the facilities" (F09).
- Each report is requested from **whoever holds it** (Q-F6): the GP for what they ordered or were copied on (here 01–06), otherwise the producing facility. A facility's reply is uploaded by the coordinator (Q-F4).
- The coordinator starts a **task set** maintained by KOC staff in the UI (Q-F2) or adds one-off tasks, arranges the KOC examinations (08 onwards) and uploads their results. Each result goes back through extraction.

**AI suggestions are a bonus, not the mechanism (Q-F1, Q-F3).**
- The AI may propose tasks or requests, e.g. from the referral's explicit asks ("CT, histologická verifikace").
- Proposals are dismissible and are shown only when they are specific and grounded in a quote. No suggestion is better than a nonsense one.
- The AI never creates tasks or sends requests on its own.

## Hard rules from the brief
- **AI only prepares a proposal, a human decides and confirms.** Every AI value is a proposal with a source until a doctor validates it.
- **Don't infer.** Take data as written; whatever is missing gets flagged.
- **The MDT record contains only what was known at the MDT date.** This follows from the workflow: the snapshot is frozen at *Připraveno k MDT*, and later documents (the pain-clinic and psychology reports in the reference case) update the live case but never the frozen record.
- "Rakathon ověří princip, produkční integrace patří do další fáze" (Rakathon tests the principle; production integration is the next phase). Integrations may be simulated.

## Demo must show (slide 12)
- [ ] Referral to the KOC without an extra form (step 01)
- [ ] AI extraction with a completeness check (step 02)
- [ ] Case overview with state and due date (step 03)
- [ ] Owner of every next step (step 03)
- [ ] Structured KOC / MDT conclusion (step 04)
- [ ] Feedback and confirmed delivery (step 04)

Plus the deliverables from the brief: the MDT record generated by the app per `MDT_zapis`, and the MDT conclusion being sent to the GP. Walkthrough: [demo-script.md](demo-script.md).
