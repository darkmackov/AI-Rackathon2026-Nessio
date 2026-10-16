# Data model

- **Domain models:** [`packages/contracts`](../packages/contracts/src/onko_contracts), used by every module and the API.
- **Persistence and interop:** FHIR R4 (4.0.1) on the IRIS FHIR server, profiled with **HL7 Europe** and **CZ Core** where profiles exist, base R4 + extensions elsewhere.
- Only the `repository` module maps between the two.

## Domain (contracts)

```mermaid
classDiagram
  class Case {
    id
    state: CaseState
    queue: QueueColumn
    on_move: actor id
    next_step
    next_due
    mdt_date
    on_hold: OnHold
    milestones: Milestones
  }
  class DocumentMeta {
    id
    doc_type
    document_date
    facility
    author
    ordered_by
    received_at
  }
  class Handover {
    as_of
    patient
    contacts
    diagnosis, diagnosis_code
    epicrisis_source, epicrisis, mdt_question
    comorbidities, medications, allergies
    performance_status, weight_kg, height_cm
    symptoms, examinations, labs, histology, other
    validated_by_referrer: Stamp
    confirmed_by_coordinator: Stamp
  }
  class Sourced~T~ {
    value: T
    status: found|missing|conflict
    origin: ai|manual
    evidence: Evidence[]
    entered: Stamp
    note
  }
  class Evidence {
    document_id
    quote
  }
  class Finding {
    kind
    severity
    fields
    message_cs
    suggested_action
    advisory
    overridable
    resolved
    resolution: Resolution
  }
  class Task {
    title, kind, location
    owner
    due
    status
    depends_on
    external
    finding_id
  }
  class TaskSet {
    name
    diagnosis_codes
    steps: TaskTemplate[]
  }
  class Message {
    kind
    channel
    recipients
    attachments
    finding_id
    simulated
  }
  class Receipt {
    recipient
    confirmed_at
  }
  class MdtBoard {
    name
    members: MdtMember[]
  }
  class MdtRecord {
    mdt_date
    members
    patient / referrer block
    diagnosis, comorbidities
    results: MdtResultRow[]
  }
  class MdtConclusion {
    source: written|uploaded
    diagnosis_code
    conclusion, recommendations
    confirmed: Stamp
  }
  class Job {
    kind
    status
    result
  }
  class Organization {
    kind: koc|clinic|...
    identifiers
  }
  class AuditEvent {
    action
    actor_id
    at
  }
  Case "1" --> "0..1" MdtRecord
  Case "1" --> "0..1" MdtConclusion
  MdtRecord ..> MdtBoard : members from
  Case "1" --> "*" Job
  Case "1" --> "*" AuditEvent
  Case ..> Organization : koc_id
  Case "1" --> "*" DocumentMeta
  Case "1" --> "*" Handover : snapshots
  Case "1" --> "*" Finding
  Case "1" --> "*" Task
  TaskSet ..> Task : instantiates
  Case "1" --> "*" Message
  Message "1" --> "*" Receipt
  Handover *-- Sourced
  Sourced *-- Evidence
  Finding *-- Evidence
```

How the MDT snapshot works:
- `Handover.as_of` is set when the case moves to *Připraveno k MDT*.
- The snapshot only uses documents with `received_at <= as_of`.
- The live handover keeps updating; the snapshot stays frozen.

## FHIR R4 mapping

Package ids, versions, profile names and identifier systems below were **checked against packages.fhir.org and the package contents on 16. 10. 2026**. "base R4" means no CZ/EU profile exists for that resource in these packages.

| Domain | FHIR resource | Profile (package) |
|---|---|---|
| Patient details | `Patient` | `cz-patient-core` (cz.core). Identifier slices: **RC** rodné číslo, system `https://ncez.mzcr.cz/fhir/sid/rcis`; **CPOJ** číslo pojištěnce, system `https://ncez.mzcr.cz/fhir/sid/cpoj`; also RID, OP (ID card), PAS |
| Insurer (code 211 = ZPMV in the reference case) | `Coverage` → payor `Organization` | `cz-coverage` (cz.core). Insurer org identifier slice **KP**, system `https://ncez.mzcr.cz/fhir/sid/kp` (presumably *kód pojišťovny*; the profile gives no description, so confirm) |
| Contact person (daughter) | `RelatedPerson` | `cz-relatedPerson-core` (cz.core) |
| Doctors, coordinator, MDT members, authors | `Practitioner`, `PractitionerRole` | `cz-practitioner-core`, `cz-practitionerrole-core` (cz.core); identifier systems `…/sid/krzp`, `…/sid/clk` exist in cz.core |
| Facilities (KOC 1, KOC 2, labs, clinics, GP) | `Organization`, `Location` | `cz-organization-core`, `cz-location-core` (cz.core). Identifier slices KRPZS, IČO, IČZ, **IČP** (`https://ncez.mzcr.cz/fhir/sid/icp`; the GP's IČP 72045318 is in report 07), KP |
| Case | `EpisodeOfCare` + `CarePlan` | `carePlan-cz-core` (cz.core); EpisodeOfCare base R4 + extensions for the 8 states, the on-hold flag and the time-to-treatment milestones |
| Referral (request to take over) | `ServiceRequest` | base R4 (cz.lab/cz.img only have lab/imaging order profiles) |
| Each uploaded report | `DocumentReference` + `Binary` | base R4 (cz.core has only attachment/logo/presented-form helpers) |
| Labs incl. tumour markers | `DiagnosticReport` + `Observation` | `diagnosticReport-cz-lab`, `observation-resultlab-cz-lab` (cz.lab 1.0.0, built on eu.laboratory 2.0.0) |
| Imaging (UZ, CT, RTG) | `DiagnosticReport`, `ImagingStudy` | `cz-diagnostic-report`, `cz-study-imaging` (cz.img 1.0.0, built on eu.imaging 1.0.0-ballot) |
| Biopsy (EUS-FNB) | `Procedure` | base R4 (`cz-procedure-imaging` in cz.img is imaging-specific) |
| Histology | `DiagnosticReport` + `Observation` | `diagnosticReport-cz-core`, `medicalTestResult-cz-core` (cz.core); no pathology-specific CZ profile |
| Diagnoses, comorbidities | `Condition` | `condition-cz-core` (cz.core); `verificationStatus` provisional → confirmed |
| Medication (FA) | `MedicationStatement` | `medicationStatement-cz-core` (cz.core) |
| Allergies (AA) | `AllergyIntolerance` | `allergyIntolerance-cz-core` (cz.core) |
| Weight, height | `Observation` | `cz-bodyweight`, `cz-bodyheight` (only in cz.img), else base R4 vital signs |
| ECOG / Karnofsky | `Observation` | base R4. A **missing value is a Finding, never a fake Observation** |
| Handover, MDT record, MDT conclusion | `Composition` + rendered `DocumentReference` (PDF) | `composition-cz-core` (cz.core) |
| AI evidence + human validation | `Provenance` | `cz-provenance` (cz.core) |
| Findings (gaps/conflicts) | `DetectedIssue` | base R4 |
| Journey steps (incl. request tasks) / task sets | `Task` / `PlanDefinition` | base R4 |
| MDT meeting | `Appointment`, `Encounter` | `appointment-cz-core`, `encounter-cz-core` (cz.core) |
| MDT result delivery, receipts, patient notices (simulated) | `Communication` | base R4. `CommunicationRequest` for request/reply flows is Phase 2 (Q-F23) |
| Consent to share with the daughter | `Consent` | base R4 |
| Audit | `AuditEvent` | base R4 |

### Packages (as published on packages.fhir.org)

| Package | Version | Notes |
|---|---|---|
| `hl7.fhir.r4.core` | 4.0.1 | |
| `hl7.fhir.cz.core` | 1.0.0 | depends on eu.base 2.0.0, eu.laboratory 2.0.0, eu.extensions.r4 1.3.0, eu.mpd 1.0.0, **cz.terminology 0.3.0** |
| `hl7.fhir.cz.lab` | 1.0.0 | depends on cz.core 1.0.0, eu.laboratory 2.0.0, but **eu.base 2.0.0-ballot** |
| `hl7.fhir.cz.img` | 1.0.0 | depends on eu.imaging 1.0.0-ballot, fhir.dicom |
| `hl7.fhir.eu.base` | 2.0.1 | EU base + core |
| `hl7.fhir.eu.laboratory` | 2.0.0 | |
| `hl7.fhir.eu.extensions.r4` | 1.3.1 | the plain `hl7.fhir.eu.extensions` 1.x is R5, don't use it |
| `hl7.fhir.eu.eps` | 1.0.0-ballot only | Patient Summary, for a later export |
| `hl7.fhir.eu.hdr` | 0.1.0-ballot only | Hospital Discharge Report; too early to depend on |
| `hl7.fhir.cz.terminology` | **0.2.0 only** | cz.core and cz.lab require 0.3.0, which is not on the registry |

### How the projection is written (S7)
- `IrisRepository` pushes the projection on every save, as one FHIR transaction (`PUT` by id): `save_document` → `DocumentReference` + `Binary` (Q-I10; the parsed text when the original bytes are missing); `save_handover` → `Patient`, `Condition`, `Observation`, `DiagnosticReport`, `Composition`, `Provenance`. Findings, tasks, cases and messages are not projected yet.
- FHIR ids derive from the app ids: `{case}-patient`, `{case}-dx`, `{case}-lab-1`, `{case}-handover`, `doc-{document}`. The MDT snapshot gets its own `{case}-mdt-…` resources (PER-9), sharing the case's `Patient`.
- A failed projection is logged and never loses the app-state save.
- **MKN-10** is coded with `http://hl7.org/fhir/sid/icd-10`: cz.core 1.0.0 defines no MKN-10 system. The diagnosis `Condition` stays `provisional` (Q-C9).
- Body weight / height use the base R4 vital-signs profiles with LOINC `29463-7` / `8302-2`. Performance status is an `Observation` only when found (PER-7), without a LOINC code.
- **Evidence:** each verbatim quote is a `Provenance.entity` (`role=source`) whose `what` references the source `DocumentReference` and carries the quote as `display` (PER-8). Manual values get an `author` Provenance with `entered.by/at`; `validated_by_referrer` / `confirmed_by_coordinator` get a `verifier` Provenance on the `Composition`.
- Naive datetimes are sent as Europe/Prague local time (D-13).

Two dependency problems with these packages. Decision (Q-I6, Q-I7): try loading them into IRIS; if that fails, declare `meta.profile` without server-side validation, and validate in tests/CI where feasible.
- `hl7.fhir.cz.terminology` 0.3.0 is missing from the registry.
- `cz.lab` pins `hl7.fhir.eu.base` 2.0.0-ballot, while `cz.core` pins 2.0.0.

## Non-FHIR storage (IRIS SQL)

**App state** (Q-A7, PER-4, Q-I14): relational tables in schema `onko` (`ONKO_IRIS_SCHEMA`), namespace from the connection string, owned by `IrisRepository`. The columns are **generated from the contract models** (`adapters/iris_tables.py`):
- scalar fields become typed columns (`VARCHAR`, `DATE`, `TIMESTAMP`, `BIT`, `BIGINT`, `DOUBLE`; ids and enum values compare case-sensitively, `%EXACT`);
- nested models are flattened into `<field>__<subfield>` columns, plus `<field>__present` when the nested model is optional (`on_hold`, `resolution`);
- lists and dicts are JSON text columns (`depends_on`, `recipient_ids`, `evidence`, …).

Tables and columns missing on start are created (`ALTER TABLE … ADD COLUMN`), so a contract that gains a field needs no migration; a column added later reads back as the field's default for old rows. Column names are quoted (`"state"`, `"date"`).

| Table | Model | Key | Indexed | Extra columns |
|---|---|---|---|---|
| `app_case` | `Case` | `id` | `koc_id`, `referring_doctor_id`, `state`, `queue` | |
| `app_document` | `DocumentMeta` | `id` | `case_id` | `doc_text` (parsed text, stream), `doc_data` (original bytes, stream) |
| `app_finding` | `Finding` | `case_id`, `id` | | `case_id`, `seq` (order) |
| `app_task` | `Task` | `id` | `case_id`, `owner`, `due` | |
| `app_message` | `Message` | `id` | `case_id` | |
| `app_receipt` | `Receipt` | `message_id`, `recipient_id` | | |
| `app_handover` | `Handover` | `case_id`, `is_snapshot` | | `body`: the handover as **one JSON document** (live and the frozen MDT snapshot, PER-9) |

The handover is the one document: 26 `Sourced` values with evidence, read and written whole. It is stored as a plain string, so IRIS SQL can query inside it with `JSON_TABLE`; its clinical content is what the FHIR projection carries.

A new port method that stores a new model adds its table here (PER-11).

- *Phase 2:* `doc_chunk(id, document_id, case_id, ord, text, embedding VECTOR(DOUBLE, n))`, Vector Search for evidence and "ask the case". `n` depends on the embedding model (Q-M2).
- `llm_call(id, step, model, prompt_hash, tokens_in, tokens_out, latency_ms, ok)`: bench and usage tracking (no limits, Q-M3).
