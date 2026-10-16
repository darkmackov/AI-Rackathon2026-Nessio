"""API surface for the MVP. Endpoints not implemented yet are DEFINED ONLY: they document the
request and the response model and return 501 until a slice implements them (see docs/api.md,
docs/slices.md). The read-only endpoints in main.py already serve the seeded reference case.

The current user comes from the `X-Actor-Id` header (demo role switcher, Q-I11).
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated, NoReturn

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from onko_contracts import (
    Actor,
    AuditEvent,
    Case,
    DocumentMeta,
    DueNotice,
    Finding,
    Handover,
    Job,
    MdtBoard,
    MdtConclusion,
    MdtRecord,
    Message,
    Organization,
    OrganizationKind,
    Receipt,
    Task,
    TaskSet,
    TimeToTreatment,
)

from .deps import ActorId, Clock, CurrentUser, Repo
from .schemas import (
    CaseTransition,
    CaseUpdate,
    DemoClock,
    DemoClockSet,
    DemoReset,
    DocumentMetaUpdate,
    DraftCreate,
    ExaminationCreate,
    FeedbackSend,
    FindingResolve,
    HandoverFieldUpdate,
    HoldSet,
    MdtBoardMembersUpdate,
    MdtConclusionUpsert,
    MdtRecordUpdate,
    MdtSnapshotCreate,
    MilestonesUpdate,
    PatientNoticeCreate,
    ReferralCreate,
    RequestTaskCreate,
    TaskCreate,
    TaskSetStart,
    TaskSetUpsert,
    TaskUpdate,
    UploadResult,
)
from .seed import apply_scenario

router = APIRouter()

PDF = {200: {"content": {"application/pdf": {}}, "description": "PDF document"}}
ReceivedAt = Annotated[
    dt.datetime | None,
    Form(description="Demo backdating; default = app clock now (see /demo/clock)"),
]


def _todo() -> NoReturn:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented yet")


# --- Directory (slice S0) ----------------------------------------------------------------------


@router.get("/me", tags=["directory"])
def me(user: CurrentUser) -> Actor:
    """The current user (referring doctor or coordinator)."""
    return user


@router.get("/directory/organizations", tags=["directory"])
def list_organizations(repo: Repo, kind: OrganizationKind | None = None) -> list[Organization]:
    """Organisations; `kind=koc` feeds the KOC picker on the referral screen."""
    return [o for o in repo.list_organizations() if kind is None or o.kind is kind]


@router.get("/directory/actors", tags=["directory"])
def list_actors(
    repo: Repo, role: str | None = None, organization_id: str | None = None
) -> list[Actor]:
    """People: GPs, coordinators, specialists. Owners for tasks, recipients for requests."""
    return [
        a
        for a in repo.list_actors()
        if (role is None or a.role == role)
        and (organization_id is None or a.organization_id == organization_id)
    ]


@router.get("/mdt-boards", tags=["directory"])
def list_mdt_boards(repo: Repo) -> list[MdtBoard]:
    return repo.list_mdt_boards()


@router.get("/mdt-boards/{board_id}", tags=["directory"])
def get_mdt_board(board_id: str, repo: Repo) -> MdtBoard:
    try:
        return repo.get_mdt_board(board_id)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDT board not found") from None


@router.put("/mdt-boards/{board_id}/members", tags=["directory"])
def update_mdt_board_members(board_id: str, body: MdtBoardMembersUpdate, actor_id: ActorId) -> MdtBoard:
    """Edit the roster (Q-F13)."""
    _todo()


# --- Flow 1: initial GP handover (slices S1, S2) -----------------------------------------------


@router.post("/referrals", status_code=201, tags=["referral"])
def create_referral(body: ReferralCreate, actor_id: ActorId) -> Case:
    """GP starts a referral draft (state `koncept`), addressed to a KOC."""
    _todo()


@router.post("/cases/{case_id}/documents", status_code=201, tags=["documents"])
def upload_document(
    case_id: str, actor_id: ActorId, file: Annotated[UploadFile, File()], received_at: ReceivedAt = None
) -> UploadResult:
    """Upload a report (GP while drafting, coordinator later). Stores it, parses the text and
    queues an `ingest_document` job: AI metadata + handover extraction + checks."""
    _todo()


@router.patch("/documents/{document_id}", tags=["documents"])
def update_document(document_id: str, body: DocumentMetaUpdate, actor_id: ActorId) -> DocumentMeta:
    """Correct AI-extracted metadata (type, date, facility, …)."""
    _todo()


@router.get("/documents/{document_id}/file", tags=["documents"], response_class=Response,
            responses={200: {"content": {"application/octet-stream": {}}, "description": "Original file"}})
def get_document_file(document_id: str) -> Response:
    """The original uploaded file."""
    _todo()


@router.patch("/cases/{case_id}/handover", tags=["handover"])
def update_handover_field(case_id: str, body: HandoverFieldUpdate, actor_id: ActorId) -> Handover:
    """'Doplnit' / 'Není k dispozici' on one field (origin=manual). Used by the GP's soft
    'fill in if you know' prompts and by the coordinator (final epikríza, MDT question, …)."""
    _todo()


@router.post("/cases/{case_id}/handover/examinations", status_code=201, tags=["handover"])
def add_examination(case_id: str, body: ExaminationCreate, actor_id: ActorId) -> Handover:
    """Manually add an examination (origin=manual)."""
    _todo()


@router.post("/cases/{case_id}/handover/validate", tags=["handover"])
def validate_handover(case_id: str, actor_id: ActorId) -> Handover:
    """Referring doctor validates the AI proposal (sets `validated_by_referrer`)."""
    _todo()


@router.post("/cases/{case_id}/send", tags=["referral"])
def send_referral(case_id: str, actor_id: ActorId) -> Case:
    """'Validovat a odeslat': koncept → odeslano. Requires a validated handover."""
    _todo()


# --- Jobs (AI work, slice S2) ------------------------------------------------------------------


@router.get("/jobs/{job_id}", tags=["jobs"])
def get_job(job_id: str) -> Job:
    """Poll a job until `done` / `failed`."""
    _todo()


@router.get("/cases/{case_id}/jobs", tags=["jobs"])
def list_case_jobs(case_id: str) -> list[Job]:
    _todo()


@router.post("/cases/{case_id}/extract", status_code=202, tags=["jobs"])
def reextract_case(case_id: str, actor_id: ActorId) -> Job:
    """Re-run extraction + checks over all case documents (e.g. after the model choice)."""
    _todo()


@router.post("/cases/{case_id}/drafts", status_code=202, tags=["jobs"])
def create_draft(case_id: str, body: DraftCreate, actor_id: ActorId) -> Job:
    """AI draft for the coordinator to edit: epikríza summary, MDT question, MDT result rows,
    MDT conclusion. Text arrives in `job.result.text` (`job.result.rows` for mdt_results)."""
    _todo()


@router.post("/cases/{case_id}/suggestions/tasks", status_code=202, tags=["jobs"])
def suggest_tasks(case_id: str, actor_id: ActorId) -> Job:
    """Bonus (Q-F3): high-precision, quote-backed task proposals in `job.result.tasks`."""
    _todo()


# --- Coordinator: case (slice S3) --------------------------------------------------------------


@router.post("/cases/{case_id}/take-over", tags=["cases"])
def take_over_case(case_id: str, actor_id: ActorId) -> Case:
    """'Převzít': the current coordinator takes the case (sets coordinator_id), odeslano → v_triage."""
    _todo()


@router.patch("/cases/{case_id}", tags=["cases"])
def update_case(case_id: str, body: CaseUpdate, actor_id: ActorId) -> Case:
    """Priority, coordinator, planned MDT board/date."""
    _todo()


@router.post("/cases/{case_id}/transition", tags=["cases"])
def transition_case(case_id: str, body: CaseTransition, actor_id: ActorId) -> Case:
    """Move the case to another state (409 if not allowed by ALLOWED_TRANSITIONS)."""
    _todo()


@router.put("/cases/{case_id}/hold", tags=["cases"])
def set_hold(case_id: str, body: HoldSet, actor_id: ActorId) -> Case:
    """'Odložit': manual on-hold flag (Q-F9)."""
    _todo()


@router.delete("/cases/{case_id}/hold", tags=["cases"])
def clear_hold(case_id: str, actor_id: ActorId) -> Case:
    _todo()


@router.patch("/cases/{case_id}/milestones", tags=["cases"])
def update_milestones(case_id: str, body: MilestonesUpdate, actor_id: ActorId) -> Case:
    _todo()


@router.get("/cases/{case_id}/time-to-treatment", tags=["cases"])
def get_time_to_treatment(case_id: str) -> TimeToTreatment:
    """T1 + T2 + T3 (Q-F18)."""
    _todo()


@router.get("/cases/{case_id}/audit", tags=["cases"])
def list_audit(case_id: str) -> list[AuditEvent]:
    _todo()


# --- Findings (slice S4) -----------------------------------------------------------------------


@router.post("/cases/{case_id}/findings/{finding_id}/resolve", tags=["findings"])
def resolve_finding(case_id: str, finding_id: str, body: FindingResolve, actor_id: ActorId) -> Finding:
    """Resolve, override (note required) or dismiss a finding."""
    _todo()


@router.post("/cases/{case_id}/findings/{finding_id}/request", status_code=201, tags=["findings"])
def request_from_finding(case_id: str, finding_id: str, body: RequestTaskCreate, actor_id: ActorId) -> Task:
    """'Vyžádat': a request task linked to the finding (`Task.finding_id`)."""
    _todo()


# --- Tasks and task sets (slice S5) ------------------------------------------------------------


@router.post("/cases/{case_id}/tasks", status_code=201, tags=["tasks"])
def create_task(case_id: str, body: TaskCreate, actor_id: ActorId) -> Task:
    """'Přidat úkol': one-off task."""
    _todo()


@router.patch("/tasks/{task_id}", tags=["tasks"])
def update_task(task_id: str, body: TaskUpdate, actor_id: ActorId) -> Task:
    _todo()


@router.post("/cases/{case_id}/task-sets/start", status_code=201, tags=["tasks"])
def start_task_set(case_id: str, body: TaskSetStart, actor_id: ActorId) -> list[Task]:
    """'Spustit sadu úkolů'."""
    _todo()


@router.get("/task-sets", tags=["tasks"])
def list_task_sets(diagnosis_code: str | None = None) -> list[TaskSet]:
    _todo()


@router.post("/task-sets", status_code=201, tags=["tasks"])
def create_task_set(body: TaskSetUpsert, actor_id: ActorId) -> TaskSet:
    _todo()


@router.put("/task-sets/{task_set_id}", tags=["tasks"])
def update_task_set(task_set_id: str, body: TaskSetUpsert, actor_id: ActorId) -> TaskSet:
    _todo()


@router.get("/notifications", tags=["tasks"])
def list_notifications(actor_id: ActorId, within_days: Annotated[int, Query(ge=0)] = 2) -> list[DueNotice]:
    """In-app deadline notifications for the current user (Q-F17)."""
    _todo()


# --- MDT (slice S6) ----------------------------------------------------------------------------


@router.post("/cases/{case_id}/mdt/snapshot", status_code=201, tags=["mdt"])
def create_mdt_snapshot(case_id: str, body: MdtSnapshotCreate, actor_id: ActorId) -> MdtRecord:
    """Freeze the handover (as_of = mdt_date), coordinator confirms it, build the MDT record,
    kompletni → pripraveno_k_mdt. 409 while non-overridden blockers remain."""
    _todo()


@router.get("/cases/{case_id}/mdt/record", tags=["mdt"])
def get_mdt_record(case_id: str) -> MdtRecord:
    _todo()


@router.patch("/cases/{case_id}/mdt/record", tags=["mdt"])
def update_mdt_record(case_id: str, body: MdtRecordUpdate, actor_id: ActorId) -> MdtRecord:
    """Edit the record before the meeting (e.g. apply an `mdt_results` draft)."""
    _todo()


@router.get("/cases/{case_id}/mdt/record.pdf", tags=["mdt"], response_class=Response, responses=PDF)
def get_mdt_record_pdf(case_id: str) -> Response:
    _todo()


@router.put("/cases/{case_id}/mdt/conclusion", tags=["mdt"])
def upsert_mdt_conclusion(case_id: str, body: MdtConclusionUpsert, actor_id: ActorId) -> MdtConclusion:
    """Write / edit the conclusion (optionally starting from a `mdt_conclusion` draft)."""
    _todo()


@router.post("/cases/{case_id}/mdt/conclusion/upload", status_code=201, tags=["mdt"])
def upload_mdt_conclusion(
    case_id: str, actor_id: ActorId, file: Annotated[UploadFile, File()], received_at: ReceivedAt = None
) -> UploadResult:
    """Upload the MDT's own report instead of writing it (source=uploaded)."""
    _todo()


@router.get("/cases/{case_id}/mdt/conclusion", tags=["mdt"])
def get_mdt_conclusion(case_id: str) -> MdtConclusion:
    _todo()


@router.post("/cases/{case_id}/mdt/conclusion/confirm", tags=["mdt"])
def confirm_mdt_conclusion(case_id: str, actor_id: ActorId) -> MdtConclusion:
    """Coordinator confirms; pripraveno_k_mdt → zaver_mdt. Required before sending."""
    _todo()


@router.get("/cases/{case_id}/mdt/conclusion.pdf", tags=["mdt"], response_class=Response, responses=PDF)
def get_mdt_conclusion_pdf(case_id: str) -> Response:
    _todo()


# --- Feedback and messages (slice S7) ----------------------------------------------------------


@router.post("/cases/{case_id}/feedback", status_code=201, tags=["feedback"])
def send_feedback(case_id: str, body: FeedbackSend, actor_id: ActorId) -> Message:
    """Send the confirmed conclusion to the GP's inbox; zaver_mdt → zpetna_vazba_odeslana."""
    _todo()


@router.post("/cases/{case_id}/patient-notices", status_code=201, tags=["feedback"])
def create_patient_notice(case_id: str, body: PatientNoticeCreate, actor_id: ActorId) -> Message:
    """'Informovat pacienta': recorded, simulated=True, never delivered (Q-F16)."""
    _todo()


@router.get("/cases/{case_id}/messages", tags=["feedback"])
def list_case_messages(case_id: str) -> list[Message]:
    _todo()


@router.get("/cases/{case_id}/receipts", tags=["feedback"])
def list_case_receipts(case_id: str) -> list[Receipt]:
    """Proof of delivery ('doložit doručení')."""
    _todo()


@router.get("/inbox", tags=["feedback"])
def list_inbox(actor_id: ActorId) -> list[Message]:
    """The current user's in-app inbox (MVP: the GP's MDT results)."""
    _todo()


@router.post("/messages/{message_id}/confirm", status_code=201, tags=["feedback"])
def confirm_receipt(message_id: str, actor_id: ActorId) -> Receipt:
    """'Potvrzuji převzetí'; zpetna_vazba_odeslana → uzavreno."""
    _todo()


# --- Demo support (slice S0) -------------------------------------------------------------------


@router.get("/demo/clock", tags=["demo"])
def get_demo_clock(clock: Clock) -> DemoClock:
    return clock.as_model()


@router.put("/demo/clock", tags=["demo"])
def set_demo_clock(body: DemoClockSet, clock: Clock) -> DemoClock:
    """Set the app clock (e.g. 2026-10-21T09:00 for the MDT step), or back to the wall clock."""
    clock.set(body.now)
    return clock.as_model()


@router.post("/demo/reset", tags=["demo"])
def reset_demo(body: DemoReset, repo: Repo, clock: Clock) -> list[Case]:
    """Reset all data to a scenario; returns the resulting cases."""
    apply_scenario(repo, clock, body.scenario)
    return repo.list_cases()
