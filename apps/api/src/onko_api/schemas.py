"""Request bodies of the API. Responses are contract models from onko_contracts."""

from __future__ import annotations

import datetime as dt
from enum import StrEnum
from typing import Any

from onko_contracts import (
    CaseState,
    DocumentMeta,
    DocumentType,
    DraftKind,
    Job,
    MdtMember,
    MdtResultRow,
    Priority,
    ResolutionKind,
    TaskStatus,
    TaskTemplate,
)
from pydantic import BaseModel, ConfigDict, Field


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Flow 1: initial GP handover -------------------------------------------------------------


class ReferralCreate(Body):
    """Start a referral draft (state koncept)."""

    koc_id: str = Field(description="Organization id of the receiving KOC (picker: /directory/organizations?kind=koc)")


class UploadResult(Body):
    """Returned by every upload: the stored document and the AI ingest job (metadata + extraction)."""

    document: DocumentMeta
    job: Job


class HandoverFieldUpdate(Body):
    """Manual entry into one handover field ('Doplnit'), or marking it 'Není k dispozici'.
    Creates a Sourced value with origin=manual and `entered` = current actor."""

    path: str = Field(description="Dotted field path, e.g. 'performance_status' or 'contacts.patient_email'")
    value: Any | None = None
    not_available: bool = Field(default=False, description="Mark as not available instead of a value")
    note: str | None = None


class DocumentMetaUpdate(Body):
    """Correct AI-extracted document metadata (dates drive examinations and the MDT cut-off).
    Omitted fields stay unchanged."""

    title: str | None = None
    doc_type: DocumentType | None = None
    document_date: dt.date | None = None
    facility: str | None = None
    department: str | None = None
    author: str | None = None
    ordered_by: str | None = None


class ExaminationCreate(Body):
    """Manually add an examination to the handover (origin=manual)."""

    date: dt.date
    place: str
    type: str
    result_full_text: str


# --- Coordinator: case, findings, tasks ------------------------------------------------------


class CaseUpdate(Body):
    """Partial case update; omitted fields stay unchanged."""

    priority: Priority | None = None
    coordinator_id: str | None = Field(default=None, description="Reassign the coordinator")
    mdt_board_id: str | None = None
    mdt_date: dt.date | None = Field(default=None, description="Planned MDT date (shown on the dashboard)")


class CaseTransition(Body):
    to: CaseState
    note: str | None = None


class CaseReturn(Body):
    """'Vrátit lékaři': send the referral back to the GP with what is missing (D-15)."""

    note: str = Field(min_length=1, description="What the GP should add or fix")
    finding_id: str | None = Field(default=None, description="The gap this return is about")


class HoldSet(Body):
    """'Odložit': manual on-hold flag (Q-F9)."""

    reason: str
    until: dt.date | None = None


class MilestonesUpdate(Body):
    """Dates for time to treatment that aren't set automatically."""

    symptom_onset: dt.date | None = None
    treatment_start: dt.date | None = None


class FindingResolve(Body):
    kind: ResolutionKind
    note: str | None = Field(default=None, description="Required for kind=overridden (Q-C2)")


class RequestTaskCreate(Body):
    """'Vyžádat' on a finding: creates a request task addressed to whoever holds the information.
    In the MVP the reply comes outside the app (Q-F23)."""

    owner_id: str = Field(description="Actor or organization id expected to supply it")
    title: str | None = Field(default=None, description="What is requested; default derived from the finding")
    due: dt.datetime | None = None
    priority: Priority = Priority.NORMAL
    note: str | None = None


class TaskCreate(Body):
    title: str
    kind: str = Field(description="imaging | biopsy | lab | consult | request_documents | mdt | other")
    owner_id: str = Field(description="Actor or organization id")
    location: str | None = None
    due: dt.datetime | None = None
    priority: Priority = Priority.NORMAL
    depends_on: list[str] = Field(default_factory=list)
    external: bool = False


class TaskUpdate(Body):
    """Partial update; omitted fields stay unchanged."""

    title: str | None = None
    status: TaskStatus | None = None
    owner_id: str | None = None
    location: str | None = None
    due: dt.datetime | None = None
    priority: Priority | None = None
    depends_on: list[str] | None = None
    external: bool | None = None
    result_document_id: str | None = Field(default=None, description="Attach the arrived result")


class TaskSetUpsert(Body):
    name: str
    diagnosis_codes: list[str] = Field(default_factory=list)
    steps: list[TaskTemplate]


class TaskSetStart(Body):
    task_set_id: str
    owners: dict[str, str] = Field(default_factory=dict, description="owner_role -> actor id")
    start: dt.datetime | None = Field(default=None, description="Base for due offsets; default now")


# --- AI drafts / suggestions -----------------------------------------------------------------


class DraftCreate(Body):
    kind: DraftKind


# --- Vector search (slice S8) ------------------------------------------------------------------


class CaseAsk(Body):
    """'Ask the case' (Q-I19): a question in Czech, answered only with verbatim quotes."""

    question: str = Field(min_length=1, description="e.g. 'Jaké je ECOG pacienta?'")


class DiagnosisCodePick(Body):
    """The MKN-10 code a person picked from the AI candidates (Q-C11)."""

    code: str = Field(min_length=1, description="One of the codes from listCodeCandidates")


# --- MDT ---------------------------------------------------------------------------------------


class MdtBoardMembersUpdate(Body):
    members: list[MdtMember]


class MdtRecordUpdate(Body):
    """Edit the MDT record before the meeting (members, result one-liners, question).
    Omitted fields stay unchanged."""

    members: list[MdtMember] | None = None
    results: list[MdtResultRow] | None = None
    mdt_question: str | None = None
    diagnosis_name: str | None = None
    diagnosis_code: str | None = None
    comorbidities: list[str] | None = None


class MdtSnapshotCreate(Body):
    """'Připravit podklad pro MDT': freeze the handover, confirm it, build the MDT record.
    Fails with 409 while non-overridden blocker findings remain."""

    board_id: str
    mdt_date: dt.date


class MdtConclusionUpsert(Body):
    """Written conclusion (MDT_zaver layout). For an uploaded MDT report use the upload endpoint."""

    presented_by: str | None = None
    diagnosis_name: str | None = None
    diagnosis_code: str | None = None
    clinical_assessment: str | None = None
    conclusion: str | None = None
    recommendations: list[str] = Field(default_factory=list)
    place: str | None = None
    date: dt.date | None = None
    chair: str | None = None
    copy_to: list[str] = Field(default_factory=list)
    ai_draft_used: bool = False


# --- Feedback / messages -----------------------------------------------------------------------


class FeedbackSend(Body):
    """Send the confirmed MDT conclusion (+ original context) to the referring doctor."""

    note: str | None = None


class PatientNoticeCreate(Body):
    """'Informovat pacienta': recorded with simulated=True, never delivered (Q-F16)."""

    subject: str
    body: str


# --- Demo support ------------------------------------------------------------------------------


class DemoClock(Body):
    """The app's notion of 'now'. The reference case runs 2.–27. 10. 2026 while a demo runs in
    minutes, so stamps, received_at, due/overdue and time to treatment use this clock."""

    now: dt.datetime
    simulated: bool = Field(description="False = wall clock")


class DemoClockSet(Body):
    now: dt.datetime | None = Field(default=None, description="None = back to the wall clock")


class DemoScenario(StrEnum):
    EMPTY = "empty"  # directory only, no cases: for running the demo from step 1
    REFERENCE_AT_MDT = "reference_at_mdt"  # MDT morning: reference case complete, before the snapshot


class DemoReset(Body):
    scenario: DemoScenario
