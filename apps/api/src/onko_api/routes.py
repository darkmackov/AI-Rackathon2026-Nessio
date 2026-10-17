"""API surface for the MVP. Endpoints not implemented yet are DEFINED ONLY: they document the
request and the response model and return 501 until a slice implements them (see docs/api.md,
docs/slices.md). The read-only endpoints in main.py already serve the seeded reference case.

The current user comes from the `X-Actor-Id` header (demo role switcher, Q-I11).
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Annotated, NoReturn
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from onko_ai import code_candidates
from onko_cases import (
    CaseStateError,
    CodeNotNeededError,
    ConclusionIncompleteError,
    ConclusionNotConfirmedError,
    HandoverEditError,
    HandoverLockedError,
    MdtBoardError,
    NotValidatedError,
    OverrideNotAllowedError,
    SnapshotBlockedError,
    TaskError,
    TransitionError,
    attach_uploaded_conclusion,
    audit_event,
    build_mdt_record,
    check_dependencies,
    check_task_set,
    close_after_receipt,
    confirm_conclusion,
    diagnosis_for_code,
    due_notices,
    feedback_attachments,
    is_external,
    manual_transition,
    matches_diagnosis,
    new_referral,
    owner_organization,
    prepare_snapshot,
    put_on_hold,
    receive_referral,
    refresh_progress,
    require_editable,
    require_patient_notice_allowed,
    require_tasks_writable,
    resolve_owners,
    resume,
    return_to_referrer,
    save_conclusion,
    set_handover_field,
    sync_case_from_handover,
    take_over,
    task_set_started,
    time_to_treatment,
    update_record,
)
from onko_cases import add_examination as add_manual_examination
from onko_cases import (
    pick_diagnosis_code as pick_code,
)
from onko_cases import resolve_finding as resolve_case_finding
from onko_cases import send_feedback as send_feedback_case
from onko_cases import (
    send_referral as send_case,
)
from onko_cases import start_task_set as start_case_task_set
from onko_cases import validate_handover as validate_case_handover
from onko_contracts import (
    Actor,
    AuditEvent,
    Case,
    Channel,
    CodeCandidate,
    ConclusionSource,
    DocumentMeta,
    DocumentType,
    DueNotice,
    Finding,
    Handover,
    Job,
    MdtBoard,
    MdtConclusion,
    MdtRecord,
    Message,
    MessageKind,
    Milestones,
    Organization,
    OrganizationKind,
    Receipt,
    Task,
    TaskSet,
    TimeToTreatment,
)
from onko_documents import DOCX as DOCX_MIME
from onko_documents import PARSERS, parse, render_mdt_conclusion, render_mdt_record
from onko_documents import PDF as PDF_MIME
from onko_documents import PPTX as PPTX_MIME
from onko_messaging import (
    AlreadyConfirmedError,
    InAppInbox,
    NotConfirmableError,
    NotRecipientError,
    mdt_result_message,
    patient_notice,
)
from onko_messaging import confirm as confirm_message
from onko_messaging import send as send_message
from onko_repository import BundleError, CaseRepository, referral_attachments
from pydantic import ValidationError

from . import audit_text
from .deps import ActorId, Clock, CurrentUser, Jobs, Llm, Repo
from .jobs import (
    RECORD_DRAFTS,
    new_id,
    queue_ask,
    queue_draft,
    queue_ingest,
    run_ask,
    run_draft,
    run_ingest,
)
from .schemas import (
    CaseAsk,
    CaseReturn,
    CaseTransition,
    CaseUpdate,
    DemoClock,
    DemoClockSet,
    DemoReset,
    DiagnosisCodePick,
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
def update_mdt_board_members(
    board_id: str, body: MdtBoardMembersUpdate, user: CurrentUser, repo: Repo
) -> MdtBoard:
    """Edit the roster (Q-F13): a coordinator of the board's KOC. MDT records already prepared
    keep the members they were prepared with."""
    try:
        board = repo.get_mdt_board(board_id)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDT board not found") from None
    if user.role != "coordinator" or user.organization_id != board.organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a coordinator of the board's KOC")
    board = board.model_copy(update={"members": body.members})
    repo.save_mdt_board(board)
    return board


# --- Flow 1: initial GP handover (slices S2, S3) -----------------------------------------------


@router.post("/referrals", status_code=201, tags=["referral"])
def create_referral(body: ReferralCreate, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """GP starts a referral draft (state `koncept`), addressed to a KOC."""
    if user.role != "referring_doctor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a referring doctor can refer")
    if not any(o.id == body.koc_id and o.kind is OrganizationKind.KOC for o in repo.list_organizations()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown KOC")
    case, handover = new_referral(new_id("case"), body.koc_id, user.id, clock.now())
    repo.save_case(case)
    repo.save_handover(handover)
    _audit(repo, case.id, user.id, "referral_created", case.created_at, _org_name(repo, body.koc_id))
    return case


@router.post("/referrals/fhir", status_code=201, tags=["referral"])
def create_referral_from_bundle(
    user: CurrentUser,
    file: Annotated[UploadFile, File(description="The referral as a FHIR R4 Bundle (JSON)")],
    koc_id: Annotated[str, Form(description="Organization id of the receiving KOC")],
    repo: Repo,
    clock: Clock,
    llm: Llm,
    jobs: Jobs,
) -> Case:
    """A referral from the GP's system as a FHIR `Bundle` (S9, Q-I20): the case arrives sent, in
    Nový. Its documents (DocumentReference / DiagnosticReport attachments) are stored and go
    through extraction like uploads; structured resources are not mapped yet (Q-I21)."""
    if user.role != "referring_doctor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a referring doctor can refer")
    if not any(o.id == koc_id and o.kind is OrganizationKind.KOC for o in repo.list_organizations()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown KOC")
    try:
        attachments = referral_attachments(json.loads(file.file.read()))
    except (ValueError, BundleError) as e:  # BundleError, invalid JSON or UTF-8
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"cannot read the Bundle: {e}") from None
    if not attachments:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "the Bundle carries no documents")
    # Read every document before saving anything: a bad attachment leaves no half case behind.
    documents = []
    for attachment in attachments:
        mime = _mime_for(attachment.mime_type, attachment.filename)
        try:
            text = parse(attachment.data, mime)
        except Exception as e:  # noqa: BLE001 - a broken file is the client's problem
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                f"cannot read {attachment.filename}: {e}") from None
        documents.append((attachment, mime, text))

    now = clock.now()
    case, handover = receive_referral(new_id("case"), koc_id, user.id, now)
    repo.save_case(case)
    repo.save_handover(handover)
    _audit(repo, case.id, user.id, "referral_created", now, f"{_org_name(repo, koc_id)}, FHIR Bundle")
    for attachment, mime, text in documents:
        meta = DocumentMeta(id=new_id("doc"), case_id=case.id, filename=attachment.filename,
                            received_at=now, uploaded_by=user.id, mime_type=mime)
        repo.save_document(meta, attachment.data, text)
        _audit(repo, case.id, user.id, "document_uploaded", now, meta.filename)
        job = queue_ingest(repo, now, case.id, meta.id)
        jobs.submit(run_ingest, job.id, repo, clock, llm)
    return case


@router.post("/cases/{case_id}/documents", status_code=201, tags=["documents"])
def upload_document(
    case_id: str,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
    repo: Repo,
    clock: Clock,
    llm: Llm,
    jobs: Jobs,
    received_at: ReceivedAt = None,
) -> UploadResult:
    """Upload a report (the case's GP while drafting or after a return, a coordinator of the
    case's KOC later). Stores it, parses the text and queues an `ingest_document` job: AI metadata
    + handover extraction + checks."""
    case = _case_or_404(repo, case_id)
    _require_party(user, case)
    return _store_upload(case_id, user, file, repo, clock, llm, jobs, received_at)


def _store_upload(
    case_id: str,
    user: Actor,
    file: UploadFile,
    repo: CaseRepository,
    clock: Clock,
    llm: Llm,
    jobs: Jobs,
    received_at: dt.datetime | None,
    *,
    document_id: str | None = None,
    doc_type: DocumentType = DocumentType.OTHER,
) -> UploadResult:
    """Parse, store and queue the ingest of an uploaded file (415 / 422 before anything is
    saved)."""
    mime = _mime_type(file)
    data = file.file.read()
    try:
        text = parse(data, mime)
    except Exception as e:  # noqa: BLE001 - a broken file is the client's problem
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"cannot read the file: {e}") from None
    now = clock.now()
    meta = DocumentMeta(
        id=document_id or new_id("doc"),
        case_id=case_id,
        filename=file.filename or "dokument",
        doc_type=doc_type,
        received_at=received_at or now,
        uploaded_by=user.id,
        mime_type=mime,
    )
    repo.save_document(meta, data, text)
    _audit(repo, case_id, user.id, "document_uploaded", now, meta.filename)
    job = queue_ingest(repo, now, case_id, meta.id)
    jobs.submit(run_ingest, job.id, repo, clock, llm)
    return UploadResult(document=meta, job=job)


def _case_or_404(repo: Repo, case_id: str) -> Case:
    try:
        return repo.get_case(case_id)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "case not found") from None


def _handover_or_404(repo: Repo, case_id: str) -> Handover:
    handover = repo.get_handover(case_id)
    if handover is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no handover yet")
    return handover


def _require_referrer(user: Actor, case: Case) -> None:
    if user.role != "referring_doctor" or user.id != case.referring_doctor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the referring doctor of this case")


def _is_koc_coordinator(user: Actor, case: Case) -> bool:
    return user.role == "coordinator" and user.organization_id == case.koc_id


def _require_koc_coordinator(user: Actor, case: Case) -> None:
    if not _is_koc_coordinator(user, case):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a coordinator of the case's KOC")


def _require_party(user: Actor, case: Case) -> None:
    """The case's referring doctor or a coordinator of its KOC."""
    if not (_is_koc_coordinator(user, case)
            or (user.role == "referring_doctor" and user.id == case.referring_doctor_id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "only the referring doctor or a coordinator of the case's KOC")


def _require_editor(user: Actor, case: Case) -> None:
    """The case's GP or a coordinator of its KOC, each only in their own states (409 otherwise)."""
    if user.role == "referring_doctor":
        _require_referrer(user, case)
    else:
        _require_koc_coordinator(user, case)
    try:
        require_editable(case, user.role)
    except HandoverLockedError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None


def _audit(repo: CaseRepository, case_id: str, by: str, action: str, now: dt.datetime,
           detail: str | None = None) -> None:
    """Append one event to the case's audit trail (PER-13)."""
    repo.save_audit(audit_event(new_id("audit"), case_id, by, action, now, detail))


def _save_progress(repo: CaseRepository, case: Case) -> Case:
    """Save the case with who is on the move, its next step and due date recomputed."""
    case = refresh_progress(case, repo.list_tasks(case.id))
    repo.save_case(case)
    return case


def _save_handover(repo: Repo, case: Case, handover: Handover) -> Handover:
    repo.save_handover(handover)
    repo.save_case(sync_case_from_handover(case, handover))
    return handover


_EXTENSIONS = {".docx": DOCX_MIME, ".pptx": PPTX_MIME, ".pdf": PDF_MIME}


def _mime_type(file: UploadFile) -> str:
    """The declared type if we can parse it, else the extension (browsers often send octet-stream)."""
    return _mime_for(file.content_type, file.filename)


def _mime_for(declared: str | None, filename: str | None) -> str:
    if declared in PARSERS:
        return declared
    suffix = "." + (filename or "").rsplit(".", 1)[-1].lower()
    if suffix in _EXTENSIONS:
        return _EXTENSIONS[suffix]
    raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "supported files: .docx, .pptx, .pdf")


@router.patch("/documents/{document_id}", tags=["documents"])
def update_document(
    document_id: str, body: DocumentMetaUpdate, user: CurrentUser, repo: Repo, clock: Clock
) -> DocumentMeta:
    """Correct AI-extracted metadata (type, date, facility, …). The case's referring doctor or a
    coordinator of the case's KOC."""
    meta = repo.get_document(document_id)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    case = _case_or_404(repo, meta.case_id)
    _require_party(user, case)
    changes = body.model_dump(exclude_unset=True)
    meta = meta.model_copy(update=changes)
    repo.update_document(meta)
    _audit(repo, case.id, user.id, "document_updated", clock.now(),
           f"{meta.filename}: {audit_text.changed(changes, labels=audit_text.DOCUMENT_LABELS)}")
    return meta


@router.get("/documents/{document_id}/file", tags=["documents"], response_class=Response,
            responses={200: {"content": {"application/octet-stream": {}}, "description": "Original file"}})
def get_document_file(document_id: str, repo: Repo) -> Response:
    """The original uploaded file, e.g. the GP's reports opened by the coordinator next to the
    structured handover (slide 9: 'strukturovaná zpráva + originál')."""
    meta = repo.get_document(document_id)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    data = repo.document_data(document_id)
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "original file not stored")
    return _file(data, meta.mime_type, meta.filename)


@router.patch("/cases/{case_id}/handover", tags=["handover"])
def update_handover_field(
    case_id: str, body: HandoverFieldUpdate, user: CurrentUser, repo: Repo, clock: Clock
) -> Handover:
    """'Doplnit' / 'Není k dispozici' on one field (origin=manual). Used by the GP's soft
    'fill in if you know' prompts (case `koncept` or `vraceno_lekari`) and by the coordinator
    (final epikríza, MDT question, …)."""
    case = _case_or_404(repo, case_id)
    _require_editor(user, case)
    try:
        handover = set_handover_field(
            _handover_or_404(repo, case_id),
            body.path,
            body.value,
            not_available=body.not_available,
            note=body.note,
            by=user.id,
            now=clock.now(),
        )
    except HandoverEditError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"invalid value: {e.errors()[0]['msg']}") from None
    handover = _save_handover(repo, case, handover)
    field = audit_text.HANDOVER_LABELS.get(body.path, body.path)
    _audit(repo, case_id, user.id, "handover_field_updated", clock.now(),
           f"{field}: není k dispozici" if body.not_available else field)
    return handover


@router.post("/cases/{case_id}/handover/examinations", status_code=201, tags=["handover"])
def add_examination(
    case_id: str, body: ExaminationCreate, user: CurrentUser, repo: Repo, clock: Clock
) -> Handover:
    """Manually add an examination (origin=manual)."""
    case = _case_or_404(repo, case_id)
    _require_editor(user, case)
    handover = add_manual_examination(
        _handover_or_404(repo, case_id), **body.model_dump(), by=user.id, now=clock.now()
    )
    handover = _save_handover(repo, case, handover)
    _audit(repo, case_id, user.id, "examination_added", clock.now(),
           f"{audit_text.date(body.date)} {body.type}")
    return handover


@router.get("/cases/{case_id}/handover/code-candidates", tags=["handover"])
def list_code_candidates(case_id: str, repo: Repo, llm: Llm) -> list[CodeCandidate]:
    """MKN-10 candidates for a diagnosis without a code (S8, Q-C11), best first, from vector search
    over the code list. AI proposals only: nothing is filled in. 409 if the handover has no
    diagnosis or its code is already set, or no embedding model or code list is set up."""
    _case_or_404(repo, case_id)
    return _code_candidates(repo, llm, _handover_or_404(repo, case_id))


@router.post("/cases/{case_id}/handover/diagnosis-code", tags=["handover"])
def pick_diagnosis_code(
    case_id: str, body: DiagnosisCodePick, user: CurrentUser, repo: Repo, clock: Clock, llm: Llm
) -> Handover:
    """Store the picked candidate as `diagnosis_code` (origin=manual) and keep the AI suggestion in
    the audit log (Q-C11, until Q-I21 adds it to the contract). 400 if the code is not a current
    candidate."""
    case = _case_or_404(repo, case_id)
    _require_editor(user, case)
    handover = _handover_or_404(repo, case_id)
    candidates = _code_candidates(repo, llm, handover)
    try:
        handover, event = pick_code(handover, body.code, candidates, event_id=new_id("audit"),
                                    by=user.id, now=clock.now())
    except HandoverEditError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    handover = _save_handover(repo, case, handover)
    repo.save_audit(event)
    return handover


def _code_candidates(repo: Repo, llm: Llm, handover: Handover) -> list[CodeCandidate]:
    try:
        diagnosis = diagnosis_for_code(handover)
    except CodeNotNeededError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    if llm is None or not llm.can_embed:
        raise HTTPException(status.HTTP_409_CONFLICT, "no embedding model is configured")
    try:
        if not repo.count_codes():
            raise HTTPException(status.HTTP_409_CONFLICT, "the MKN-10 code list is not loaded")
    except RuntimeError as e:  # IRIS without vector tables (ONKO_EMBED_DIM)
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    return code_candidates(diagnosis, repo, llm)


@router.post("/cases/{case_id}/handover/validate", tags=["handover"])
def validate_handover(case_id: str, user: CurrentUser, repo: Repo, clock: Clock) -> Handover:
    """Referring doctor validates the AI proposal (sets `validated_by_referrer`)."""
    case = _case_or_404(repo, case_id)
    _require_referrer(user, case)
    try:
        handover = validate_case_handover(case, _handover_or_404(repo, case_id), user.id, clock.now())
    except HandoverLockedError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    repo.save_handover(handover)
    _audit(repo, case_id, user.id, "handover_validated", handover.validated_by_referrer.at)
    return handover


@router.post("/cases/{case_id}/send", tags=["referral"])
def send_referral(case_id: str, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """'Validovat a odeslat': koncept → odeslano, or vraceno_lekari → v_triage after a return
    (D-15). Requires a validated handover."""
    case = _case_or_404(repo, case_id)
    _require_referrer(user, case)
    returns = [
        m.sent_at
        for m in repo.list_messages(case_id)
        if m.kind is MessageKind.CASE_RETURNED and m.sent_at is not None
    ]
    now = clock.now()
    try:
        sent = send_case(case, _handover_or_404(repo, case_id), max(returns, default=None), now)
    except (NotValidatedError, TransitionError) as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    sent = _save_progress(repo, sent)
    _audit(repo, case_id, user.id, "referral_sent", now, audit_text.transition(case.state, sent.state))
    return sent


# --- Jobs (AI work, slice S2) ------------------------------------------------------------------


@router.get("/jobs/{job_id}", tags=["jobs"])
def get_job(job_id: str, repo: Repo) -> Job:
    """Poll a job until `done` / `failed`."""
    job = repo.get_job(job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    return job


@router.get("/cases/{case_id}/jobs", tags=["jobs"])
def list_case_jobs(case_id: str, repo: Repo) -> list[Job]:
    _case_or_404(repo, case_id)
    return repo.list_jobs(case_id)


@router.post("/cases/{case_id}/extract", status_code=202, tags=["jobs"])
def reextract_case(case_id: str, user: CurrentUser, repo: Repo, clock: Clock, llm: Llm, jobs: Jobs) -> Job:
    """Re-run extraction + checks over all case documents (e.g. after the model choice). The
    case's referring doctor or a coordinator of the case's KOC."""
    case = _case_or_404(repo, case_id)
    _require_party(user, case)
    job = queue_ingest(repo, clock.now(), case_id, None)
    _audit(repo, case_id, user.id, "reextraction_started", job.created_at)
    jobs.submit(run_ingest, job.id, repo, clock, llm)
    return job


@router.post("/cases/{case_id}/drafts", status_code=202, tags=["jobs"])
def create_draft(
    case_id: str, body: DraftCreate, user: CurrentUser, repo: Repo, clock: Clock, llm: Llm, jobs: Jobs
) -> Job:
    """A draft of what the MDT receives, for a coordinator of the case's KOC to edit and apply
    (Q-F37). Nothing on the case changes; once done the result is in `job.draft`:
    - `epicrisis_summary`, `mdt_question`: AI text from the live handover in `draft.text`; apply
      it with `updateHandoverField` (`epicrisis`, `mdt_question`).
    - `mdt_results`: AI one-liners for the MDT record's results in `draft.rows`; apply with
      `updateMdtRecord`.
    - `mdt_conclusion`: no AI, only the parts of `MDT_zaver` that restate the record (diagnosis,
      date, place, copy to the referring doctor) in `draft.fields`; apply with
      `upsertMdtConclusion`. The MDT's decision is never drafted.

    The last two need the MDT record (409 before *Připravit podklad pro MDT*)."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    if body.kind in RECORD_DRAFTS and repo.get_mdt_record(case_id) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "no MDT record yet: prepare the MDT input first")
    job = queue_draft(repo, clock.now(), case_id, body.kind.value)
    jobs.submit(run_draft, job.id, repo, clock, llm)
    return job


@router.post("/cases/{case_id}/suggestions/tasks", status_code=202, tags=["jobs"])
def suggest_tasks(case_id: str, actor_id: ActorId) -> Job:
    """Bonus (Q-F3): high-precision, quote-backed task proposals in `job.result.tasks`."""
    _todo()


@router.post("/cases/{case_id}/ask", status_code=202, tags=["jobs"])
def ask_case(case_id: str, body: CaseAsk, actor_id: ActorId, repo: Repo, clock: Clock, llm: Llm,
             jobs: Jobs) -> Job:
    """'Ask the case' (S8, Q-I19): the nearest document chunks go to the model, which may answer
    only with quotes; each is checked verbatim. The `CaseAnswer` arrives in `job.answer`
    (`found=false`, 'nenalezeno', when no quote passes)."""
    _case_or_404(repo, case_id)
    job = queue_ask(repo, clock.now(), case_id, body.question)
    jobs.submit(run_ask, job.id, repo, clock, llm)
    return job


# --- Coordinator: case (slice S4) --------------------------------------------------------------


@router.post("/cases/{case_id}/take-over", tags=["cases"])
def take_over_case(case_id: str, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """'Převzít': a coordinator of the case's KOC takes the case (sets coordinator_id),
    odeslano → v_triage. 409 in any other state."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    try:
        taken = take_over(case, user.id, repo.list_tasks(case_id))
    except TransitionError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    repo.save_case(taken)
    _audit(repo, case_id, user.id, "case_taken_over", clock.now(), audit_text.transition(case.state, taken.state))
    return taken


@router.patch("/cases/{case_id}", tags=["cases"])
def update_case(case_id: str, body: CaseUpdate, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """Priority, coordinator, planned MDT board/date. Omitted fields stay unchanged; `null` clears
    the MDT board or date. The coordinator and the board must belong to the case's KOC (400)."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    changes = body.model_dump(exclude_unset=True)
    if "coordinator_id" in changes:
        coordinator_id = changes["coordinator_id"]
        if coordinator_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "a taken-over case keeps a coordinator")
        if not any(a.id == coordinator_id and a.role == "coordinator"
                   and a.organization_id == case.koc_id for a in repo.list_actors()):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a coordinator of the case's KOC")
    if changes.get("mdt_board_id") is not None and not any(
        b.id == changes["mdt_board_id"] and b.organization_id == case.koc_id
        for b in repo.list_mdt_boards()
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not an MDT board of the case's KOC")
    try:
        updated = Case.model_validate({**case.model_dump(), **changes})
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"invalid value: {e.errors()[0]['msg']}") from None
    updated = _save_progress(repo, updated)
    _audit(repo, case_id, user.id, "case_updated", clock.now(), audit_text.changed(changes, _names(repo, case_id)))
    return updated


def _org_name(repo: CaseRepository, organization_id: str) -> str:
    return next((o.name for o in repo.list_organizations() if o.id == organization_id), organization_id)


def _names(repo: CaseRepository, case_id: str) -> dict[str, str]:
    """Names for the ids an audit detail mentions: people, organizations, MDT boards and the
    case's tasks and documents."""
    return {
        **{o.id: o.name for o in repo.list_organizations()},
        **{b.id: b.name for b in repo.list_mdt_boards()},
        **{a.id: a.name for a in repo.list_actors()},
        **{t.id: t.title for t in repo.list_tasks(case_id)},
        **{d.id: d.filename for d in repo.list_documents(case_id)},
    }


@router.post("/cases/{case_id}/transition", tags=["cases"])
def transition_case(case_id: str, body: CaseTransition, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """The coordinator's own moves: v_triage → ceka_na_podklady | kompletni and
    ceka_na_podklady ↔ kompletni. Every other change has its own endpoint (take-over, return, MDT
    snapshot and confirmation, feedback, receipt): 409. The note goes to the audit trail."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    try:
        moved = manual_transition(case, body.to)
    except TransitionError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    repo.save_case(moved)
    _audit(repo, case_id, user.id, "case_transitioned", clock.now(),
           audit_text.with_note(audit_text.transition(case.state, moved.state), body.note))
    return moved


@router.post("/cases/{case_id}/return", tags=["cases"])
def return_case(case_id: str, body: CaseReturn, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """'Vrátit lékaři': → vraceno_lekari; the note goes to the GP's inbox as a `case_returned`
    Message (D-15) and the GP is on the move. 409 outside v_triage / ceka_na_podklady /
    kompletni; 400 for a finding the case doesn't have."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    if body.finding_id is not None and not any(f.id == body.finding_id for f in repo.list_findings(case_id)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown finding")
    try:
        returned = return_to_referrer(case)
    except TransitionError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    now = clock.now()
    repo.save_case(returned)
    message = Message(
        id=new_id("msg"),
        case_id=case_id,
        kind=MessageKind.CASE_RETURNED,
        sender_id=user.id,
        recipient_ids=[case.referring_doctor_id],
        subject="Doporučení vráceno k doplnění",
        body=body.note,
        finding_id=body.finding_id,
    )
    send_message(message, {Channel.IN_APP: InAppInbox(repo)}, now)
    _audit(repo, case_id, user.id, "case_returned", now, body.note)
    return returned


@router.put("/cases/{case_id}/hold", tags=["cases"])
def set_hold(case_id: str, body: HoldSet, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """'Odložit': manual on-hold flag (Q-F9), from v_triage until the feedback is sent (409
    otherwise). Setting it again replaces it; `until` is information only."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    now = clock.now()
    try:
        held = put_on_hold(case, body.reason, user.id, now, body.until)
    except CaseStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    repo.save_case(held)
    until = f" (obnovit od {audit_text.date(body.until)})" if body.until else ""
    _audit(repo, case_id, user.id, "hold_set", now, body.reason + until)
    return held


@router.delete("/cases/{case_id}/hold", tags=["cases"])
def clear_hold(case_id: str, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """Resume the case; a case that isn't on hold stays as it is."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    if case.on_hold is None:
        return case
    resumed = resume(case)
    repo.save_case(resumed)
    _audit(repo, case_id, user.id, "hold_cleared", clock.now(), case.on_hold.reason)
    return resumed


@router.patch("/cases/{case_id}/milestones", tags=["cases"])
def update_milestones(case_id: str, body: MilestonesUpdate, user: CurrentUser, repo: Repo, clock: Clock) -> Case:
    """Symptom onset and treatment start for time to treatment. Omitted fields stay unchanged;
    `null` clears one."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    changes = body.model_dump(exclude_unset=True)
    milestones = Milestones.model_validate({**case.milestones.model_dump(), **changes})
    updated = case.model_copy(update={"milestones": milestones})
    repo.save_case(updated)
    _audit(repo, case_id, user.id, "milestones_updated", clock.now(), audit_text.changed(changes))
    return updated


@router.get("/cases/{case_id}/time-to-treatment", tags=["cases"])
def get_time_to_treatment(case_id: str, repo: Repo) -> TimeToTreatment:
    """T1 + T2 + T3 (Q-F18)."""
    return time_to_treatment(_case_or_404(repo, case_id))


@router.get("/cases/{case_id}/audit", tags=["cases"])
def list_audit(case_id: str, repo: Repo) -> list[AuditEvent]:
    """The case's audit trail, oldest first."""
    _case_or_404(repo, case_id)
    return repo.list_audit(case_id)


# --- Findings (slice S4) -----------------------------------------------------------------------


def _finding_or_404(repo: CaseRepository, case_id: str, finding_id: str) -> tuple[list[Finding], int]:
    findings = repo.list_findings(case_id)
    for i, finding in enumerate(findings):
        if finding.id == finding_id:
            return findings, i
    raise HTTPException(status.HTTP_404_NOT_FOUND, "finding not found")


@router.post("/cases/{case_id}/findings/{finding_id}/resolve", tags=["findings"])
def resolve_finding(
    case_id: str, finding_id: str, body: FindingResolve, user: CurrentUser, repo: Repo, clock: Clock
) -> Finding:
    """Resolve, override (note required, 422 without; 409 if not overridable) or dismiss a finding.
    A later resolution replaces an earlier one."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    findings, i = _finding_or_404(repo, case_id, finding_id)
    now = clock.now()
    try:
        resolved = resolve_case_finding(findings[i], body.kind, body.note, user.id, now)
    except OverrideNotAllowedError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, e.errors()[0]["msg"]) from None
    findings[i] = resolved
    repo.save_findings(case_id, findings)
    detail = f"{audit_text.quoted(resolved.message_cs)}: {audit_text.RESOLUTIONS[body.kind.value]}"
    _audit(repo, case_id, user.id, "finding_resolved", now, audit_text.with_note(detail, body.note))
    return resolved


def _owner_org(repo: CaseRepository, owner_id: str) -> str | None:
    try:
        return owner_organization(owner_id, repo.list_actors(), repo.list_organizations())
    except TaskError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None


def _writable_case(repo: CaseRepository, user: Actor, case_id: str) -> Case:
    """The case, if this user may change its tasks now (403 / 409 otherwise)."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    try:
        require_tasks_writable(case)
    except CaseStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    return case


@router.post("/cases/{case_id}/findings/{finding_id}/request", status_code=201, tags=["findings"])
def request_from_finding(
    case_id: str, finding_id: str, body: RequestTaskCreate, user: CurrentUser, repo: Repo, clock: Clock
) -> Task:
    """'Vyžádat': a `request_documents` task addressed to whoever holds the information, linked to
    the finding (`Task.finding_id`). The case state doesn't change; the note goes to the audit."""
    case = _writable_case(repo, user, case_id)
    findings, i = _finding_or_404(repo, case_id, finding_id)
    finding = findings[i]
    task = Task(
        id=new_id("task"),
        case_id=case_id,
        title=body.title or f"Vyžádat: {finding.message_cs}",
        kind="request_documents",
        owner=body.owner_id,
        priority=body.priority,
        due=body.due,
        external=is_external(_owner_org(repo, body.owner_id), case),
        finding_id=finding.id,
    )
    repo.save_task(task)
    _save_progress(repo, case)
    owner = _names(repo, case_id).get(body.owner_id, body.owner_id)
    _audit(repo, case_id, user.id, "finding_requested", clock.now(),
           audit_text.with_note(f"{audit_text.quoted(finding.message_cs)} → {owner}", body.note))
    return task


# --- Tasks and task sets (slice S4) ------------------------------------------------------------


@router.post("/cases/{case_id}/tasks", status_code=201, tags=["tasks"])
def create_task(case_id: str, body: TaskCreate, user: CurrentUser, repo: Repo, clock: Clock) -> Task:
    """'Přidat úkol': one-off task. The owner is a directory id; dependencies are tasks of the
    case without a cycle (400). `external` is set when the owner is outside the KOC unless given."""
    case = _writable_case(repo, user, case_id)
    owner_org = _owner_org(repo, body.owner_id)
    task_id = new_id("task")
    try:
        check_dependencies(task_id, body.depends_on, repo.list_tasks(case_id))
    except TaskError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    task = Task(
        id=task_id,
        case_id=case_id,
        title=body.title,
        kind=body.kind,
        location=body.location,
        owner=body.owner_id,
        priority=body.priority,
        due=body.due,
        depends_on=body.depends_on,
        external=body.external if "external" in body.model_fields_set
        else is_external(owner_org, case),
    )
    repo.save_task(task)
    _save_progress(repo, case)
    _audit(repo, case_id, user.id, "task_created", clock.now(), task.title)
    return task


@router.patch("/tasks/{task_id}", tags=["tasks"])
def update_task(task_id: str, body: TaskUpdate, user: CurrentUser, repo: Repo, clock: Clock) -> Task:
    """Status, owner, date, place, priority, dependencies, the arrived result document. Omitted
    fields stay unchanged."""
    task = repo.get_task(task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    case = _writable_case(repo, user, task.case_id)
    changes = body.model_dump(exclude_unset=True)
    if "owner_id" in changes:
        changes["owner"] = changes.pop("owner_id")
        if changes["owner"] is not None:
            owner_org = _owner_org(repo, changes["owner"])
            changes.setdefault("external", is_external(owner_org, case))
    if changes.get("depends_on") is not None:
        try:
            check_dependencies(task.id, changes["depends_on"], repo.list_tasks(case.id))
        except TaskError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    if changes.get("result_document_id") is not None:
        document = repo.get_document(changes["result_document_id"])
        if document is None or document.case_id != case.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a document of this case")
    try:
        updated = Task.model_validate({**task.model_dump(), **changes})
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"invalid value: {e.errors()[0]['msg']}") from None
    repo.save_task(updated)
    _save_progress(repo, case)
    _audit(repo, case.id, user.id, "task_updated", clock.now(),
           f"{updated.title}: {audit_text.changed(changes, _names(repo, case.id))}")
    return updated


@router.post("/cases/{case_id}/task-sets/start", status_code=201, tags=["tasks"])
def start_task_set(case_id: str, body: TaskSetStart, user: CurrentUser, repo: Repo, clock: Clock) -> list[Task]:
    """'Spustit sadu úkolů'. `owners` maps each step's owner role to a directory id; the
    coordinator role defaults to the case's coordinator, any other missing role is 400. 409 if the
    set already runs on the case."""
    case = _writable_case(repo, user, case_id)
    task_set = repo.get_task_set(body.task_set_id)
    if task_set is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task set not found")
    if task_set_started(case, task_set, repo.list_tasks(case_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "the task set already runs on this case")
    try:
        owners = resolve_owners(task_set, body.owners, case)
    except TaskError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    owner_orgs = {owner: _owner_org(repo, owner) for owner in set(owners.values())}
    now = clock.now()
    tasks = [
        t.model_copy(update={"external": is_external(owner_orgs[t.owner], case)})
        for t in start_case_task_set(case, task_set, owners, body.start or now)
    ]
    for t in tasks:
        repo.save_task(t)
    _save_progress(repo, case)
    _audit(repo, case_id, user.id, "task_set_started", now, task_set.name)
    return tasks


@router.get("/task-sets", tags=["tasks"])
def list_task_sets(repo: Repo, diagnosis_code: str | None = None) -> list[TaskSet]:
    """Task sets; `diagnosis_code` keeps those for the diagnosis (a `C25` set fits `C25.0`)."""
    task_sets = repo.list_task_sets()
    if diagnosis_code:
        task_sets = [s for s in task_sets if matches_diagnosis(s, diagnosis_code)]
    return task_sets


def _require_coordinator(user: Actor) -> None:
    if user.role != "coordinator":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a coordinator")


def _checked_steps(body: TaskSetUpsert) -> None:
    try:
        check_task_set(body.steps)
    except TaskError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None


@router.post("/task-sets", status_code=201, tags=["tasks"])
def create_task_set(body: TaskSetUpsert, user: CurrentUser, repo: Repo) -> TaskSet:
    """A coordinator's new task set (Q-F2). Step keys are unique and dependencies name steps of
    the set without a cycle (400)."""
    _require_coordinator(user)
    _checked_steps(body)
    task_set = TaskSet(id=new_id("taskset"), created_by=user.id, **body.model_dump())
    repo.save_task_set(task_set)
    return task_set


@router.put("/task-sets/{task_set_id}", tags=["tasks"])
def update_task_set(task_set_id: str, body: TaskSetUpsert, user: CurrentUser, repo: Repo) -> TaskSet:
    """Replace a set's name, codes and steps. Tasks already started from it don't change."""
    _require_coordinator(user)
    existing = repo.get_task_set(task_set_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task set not found")
    _checked_steps(body)
    task_set = TaskSet(id=existing.id, created_by=existing.created_by, **body.model_dump())
    repo.save_task_set(task_set)
    return task_set


@router.get("/notifications", tags=["tasks"])
def list_notifications(
    user: CurrentUser, repo: Repo, clock: Clock, within_days: Annotated[int, Query(ge=0)] = 2
) -> list[DueNotice]:
    """In-app deadline notifications for the current user (Q-F17): open tasks due within
    `within_days` or overdue, that the user owns (as a person or through their organisation) or
    that belong to a case they coordinate. Earliest due first."""
    cases = repo.list_cases()
    owner_ids = {user.id} | ({user.organization_id} if user.organization_id else set())
    coordinated = {c.id for c in cases if c.coordinator_id == user.id}
    tasks = [t for c in cases for t in repo.list_tasks(c.id)]
    return due_notices(tasks, owner_ids, coordinated, clock.now(), within_days)


# --- MDT (slice S5) ----------------------------------------------------------------------------


def _record_or_404(repo: CaseRepository, case_id: str) -> MdtRecord:
    record = repo.get_mdt_record(case_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no MDT record yet")
    return record


def _conclusion_or_404(repo: CaseRepository, case_id: str) -> MdtConclusion:
    conclusion = repo.get_mdt_conclusion(case_id)
    if conclusion is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no MDT conclusion yet")
    return conclusion


def _actor_or_none(repo: CaseRepository, actor_id: str) -> Actor | None:
    try:
        return repo.get_actor(actor_id)
    except KeyError:
        return None


def _conclusion_header(repo: CaseRepository, case: Case) -> list[str]:
    """The `MDT_zaver` letterhead: the KOC, then the board with the KOC's address."""
    koc = next((o for o in repo.list_organizations() if o.id == case.koc_id), None)
    lines = [koc.name] if koc else []
    if case.mdt_board_id:
        try:
            board = repo.get_mdt_board(case.mdt_board_id)
        except KeyError:
            return lines
        lines.append(", ".join(v for v in (board.name, koc.address if koc else None) if v))
    return lines


def _render_conclusion(repo: CaseRepository, case: Case, conclusion: MdtConclusion) -> bytes:
    return render_mdt_conclusion(conclusion, repo.get_mdt_record(case.id),
                                 header=_conclusion_header(repo, case))


def _pdf(data: bytes, filename: str) -> Response:
    return _file(data, PDF_MIME, filename)


def _file(data: bytes, mime_type: str, filename: str) -> Response:
    """Inline file; `filename*` (RFC 6266) keeps Czech file names, the plain one is an ASCII fallback."""
    fallback = filename.encode("ascii", "replace").decode().replace('"', "_")
    disposition = f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"
    return Response(content=data, media_type=mime_type, headers={"Content-Disposition": disposition})


@router.post("/cases/{case_id}/mdt/snapshot", status_code=201, tags=["mdt"])
def create_mdt_snapshot(
    case_id: str, body: MdtSnapshotCreate, user: CurrentUser, repo: Repo, clock: Clock
) -> MdtRecord:
    """'Připravit podklad pro MDT', a coordinator of the case's KOC: kompletni → pripraveno_k_mdt.
    Freezes a copy of the live handover (`as_of` = `mdt_date`, confirmed by the coordinator; read it
    with `getHandover?snapshot=true`) and builds the MDT record from it, with the board's members
    and the referring doctor from the directory. 409 in another state, while blockers are
    unresolved (resolve or override them first), while a document is still being extracted, or
    when the handover uses a document received after `mdt_date`; 400 for a board that isn't the
    KOC's."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    try:
        board = repo.get_mdt_board(body.board_id)
    except KeyError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown MDT board") from None
    handover = _handover_or_404(repo, case_id)
    now = clock.now()
    try:
        ready, snapshot = prepare_snapshot(
            case, handover, repo.list_findings(case_id), repo.list_documents(case_id),
            board=board, mdt_date=body.mdt_date, by=user.id, now=now, jobs=repo.list_jobs(case_id),
        )
    except MdtBoardError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    except (TransitionError, SnapshotBlockedError) as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    record = build_mdt_record(snapshot, ready, board,
                              _actor_or_none(repo, case.referring_doctor_id), by=user.id, now=now)
    ready = _save_progress(repo, ready)
    repo.save_handover(snapshot, snapshot=True)
    repo.save_mdt_record(record)
    _audit(repo, case_id, user.id, "mdt_snapshot_created", now,
           f"{audit_text.transition(case.state, ready.state)}, MDT {audit_text.date(body.mdt_date)} ({board.name})")
    return record


@router.get("/cases/{case_id}/mdt/record", tags=["mdt"])
def get_mdt_record(case_id: str, repo: Repo) -> MdtRecord:
    """The MDT record (`MDT_zapis` sections 1–5); 404 before the snapshot."""
    _case_or_404(repo, case_id)
    return _record_or_404(repo, case_id)


@router.patch("/cases/{case_id}/mdt/record", tags=["mdt"])
def update_mdt_record(
    case_id: str, body: MdtRecordUpdate, user: CurrentUser, repo: Repo, clock: Clock
) -> MdtRecord:
    """Edit the record before the meeting (e.g. apply an `mdt_results` draft), a coordinator of the
    case's KOC. Omitted fields stay unchanged. Only in pripraveno_k_mdt (409 otherwise)."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    record = _record_or_404(repo, case_id)
    changes = body.model_dump(exclude_unset=True)
    try:
        record = update_record(case, record, changes)
    except CaseStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"invalid value: {e.errors()[0]['msg']}") from None
    repo.save_mdt_record(record)
    _audit(repo, case_id, user.id, "mdt_record_updated", clock.now(),
           audit_text.fields(changes, audit_text.MDT_RECORD_LABELS))
    return record


@router.get("/cases/{case_id}/mdt/record.pdf", tags=["mdt"], response_class=Response, responses=PDF)
def get_mdt_record_pdf(case_id: str, repo: Repo) -> Response:
    """The MDT record as PDF in the `MDT_zapis` layout; sections 6–7 from a confirmed
    conclusion."""
    _case_or_404(repo, case_id)
    record = _record_or_404(repo, case_id)
    return _pdf(render_mdt_record(record, repo.get_mdt_conclusion(case_id)),
                f"mdt-zapis-{case_id}.pdf")


@router.put("/cases/{case_id}/mdt/conclusion", tags=["mdt"])
def upsert_mdt_conclusion(
    case_id: str, body: MdtConclusionUpsert, user: CurrentUser, repo: Repo, clock: Clock
) -> MdtConclusion:
    """Write / edit the conclusion (optionally starting from a `mdt_conclusion` draft), a
    coordinator of the case's KOC, in pripraveno_k_mdt or zaver_mdt (409 otherwise). Replaces
    every written field. After an upload the report stays the source and these are its structured
    fields (e.g. the definitive MKN-10). A confirmed conclusion loses its confirmation and needs a
    new one."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    existing = repo.get_mdt_conclusion(case_id)
    try:
        conclusion = save_conclusion(case, existing, body.model_dump())
    except CaseStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    repo.save_mdt_conclusion(conclusion)
    detail = audit_text.CONCLUSION_SOURCES[conclusion.source.value]
    if existing is not None and existing.confirmed is not None:
        detail += ", potvrzení zrušeno"
    _audit(repo, case_id, user.id, "mdt_conclusion_saved", clock.now(), detail)
    return conclusion


@router.post("/cases/{case_id}/mdt/conclusion/upload", status_code=201, tags=["mdt"])
def upload_mdt_conclusion(
    case_id: str,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
    repo: Repo,
    clock: Clock,
    llm: Llm,
    jobs: Jobs,
    received_at: ReceivedAt = None,
) -> UploadResult:
    """Upload the MDT's own report instead of writing it (source=uploaded), a coordinator of the
    case's KOC, in pripraveno_k_mdt or zaver_mdt (409 otherwise). It becomes a case document and is
    ingested like any upload; fields typed in earlier stay and a confirmation is dropped."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    document_id = new_id("doc")
    try:
        conclusion = attach_uploaded_conclusion(case, repo.get_mdt_conclusion(case_id), document_id)
    except CaseStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    result = _store_upload(case_id, user, file, repo, clock, llm, jobs, received_at,
                           document_id=document_id, doc_type=DocumentType.MDT_CONCLUSION)
    repo.save_mdt_conclusion(conclusion)
    _audit(repo, case_id, user.id, "mdt_conclusion_uploaded", clock.now(), result.document.filename)
    return result


@router.get("/cases/{case_id}/mdt/conclusion", tags=["mdt"])
def get_mdt_conclusion(case_id: str, repo: Repo) -> MdtConclusion:
    """The MDT conclusion (`MDT_zaver`); 404 until one is written or uploaded."""
    _case_or_404(repo, case_id)
    return _conclusion_or_404(repo, case_id)


@router.post("/cases/{case_id}/mdt/conclusion/confirm", tags=["mdt"])
def confirm_mdt_conclusion(case_id: str, user: CurrentUser, repo: Repo, clock: Clock) -> MdtConclusion:
    """A coordinator of the case's KOC confirms; pripraveno_k_mdt → zaver_mdt, or a correction is
    confirmed again in zaver_mdt. Required before sending. The definitive diagnosis and MKN-10
    code go into the live handover as manual values, and the MDT counts as held on the
    conclusion's date (T2); findings such as a provisional code stay until resolved (Q-F36). 409
    in another state or without the text (written) or the report (uploaded)."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    conclusion = _conclusion_or_404(repo, case_id)
    now = clock.now()
    try:
        moved, confirmed, handover = confirm_conclusion(
            case, conclusion, _handover_or_404(repo, case_id), by=user.id, now=now)
    except (CaseStateError, ConclusionIncompleteError) as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    pdf = (None if confirmed.source is ConclusionSource.UPLOADED
           else _render_conclusion(repo, moved, confirmed))
    repo.save_handover(handover)
    moved = _save_progress(repo, moved)
    repo.save_mdt_conclusion(confirmed, pdf=pdf)
    detail = audit_text.transition(case.state, moved.state)
    if confirmed.diagnosis_code:
        detail += f", definitivní kód {confirmed.diagnosis_code}"
    _audit(repo, case_id, user.id, "mdt_conclusion_confirmed", now, detail)
    return confirmed


@router.get("/cases/{case_id}/mdt/conclusion.pdf", tags=["mdt"], response_class=Response, responses=PDF)
def get_mdt_conclusion_pdf(case_id: str, repo: Repo) -> Response:
    """The conclusion as PDF: an uploaded PDF report as it is, otherwise rendered in the
    `MDT_zaver` layout from the conclusion and the MDT record."""
    case = _case_or_404(repo, case_id)
    conclusion = _conclusion_or_404(repo, case_id)
    if conclusion.source is ConclusionSource.UPLOADED and conclusion.document_id:
        meta = repo.get_document(conclusion.document_id)
        data = repo.document_data(conclusion.document_id)
        if meta is not None and meta.mime_type == PDF_MIME and data:
            return _pdf(data, meta.filename)
    return _pdf(_render_conclusion(repo, case, conclusion), f"mdt-zaver-{case_id}.pdf")


# --- Feedback and messages (slice S6) ----------------------------------------------------------


@router.post("/cases/{case_id}/feedback", status_code=201, tags=["feedback"])
def send_feedback(
    case_id: str, body: FeedbackSend, user: CurrentUser, repo: Repo, clock: Clock
) -> Message:
    """'Odeslat PL', a coordinator of the case's KOC: the confirmed conclusion goes to the referring
    doctor's in-app inbox as an `mdt_result` message; zaver_mdt → zpetna_vazba_odeslana, and the
    referring doctor is on the move until they confirm receipt. Attached: the uploaded MDT report
    (if any), then every document the frozen MDT snapshot quotes (the original context). Subject
    'Závěr MDT ze dne …'; body = `note`, then the conclusion text. The conclusion can't be changed
    afterwards. 404 without a conclusion; 409 in another state or while the conclusion isn't
    (re-)confirmed."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    conclusion = _conclusion_or_404(repo, case_id)
    try:
        sent_case = send_feedback_case(case, conclusion)
    except (TransitionError, ConclusionNotConfirmedError) as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    now = clock.now()
    attachments = feedback_attachments(conclusion, repo.get_handover(case_id, snapshot=True))
    message = mdt_result_message(
        message_id=new_id("msg"), case_id=case_id, sender_id=user.id,
        recipient_id=case.referring_doctor_id, conclusion=conclusion, mdt_date=case.mdt_date,
        attachment_document_ids=attachments, note=body.note,
    )
    message = send_message(message, {Channel.IN_APP: InAppInbox(repo)}, now)
    sent_case = _save_progress(repo, sent_case)
    _audit(repo, case_id, user.id, "feedback_sent", now,
           f"{audit_text.transition(case.state, sent_case.state)}, příloh: {len(attachments)}")
    return message


@router.post("/cases/{case_id}/patient-notices", status_code=201, tags=["feedback"])
def create_patient_notice(
    case_id: str, body: PatientNoticeCreate, user: CurrentUser, repo: Repo, clock: Clock
) -> Message:
    """'Informovat pacienta', a coordinator of the case's KOC: recorded as sent with
    `simulated=True` and no recipients, never delivered (Q-F16), so it is in no inbox. 409 before
    the take-over or once the case is closed."""
    case = _case_or_404(repo, case_id)
    _require_koc_coordinator(user, case)
    try:
        require_patient_notice_allowed(case)
    except CaseStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    now = clock.now()
    notice = patient_notice(message_id=new_id("msg"), case_id=case_id, sender_id=user.id,
                            subject=body.subject, body=body.body, now=now)
    repo.save_message(notice)
    _audit(repo, case_id, user.id, "patient_notice_sent", now, f"{body.subject} (simulováno)")
    return notice


@router.get("/cases/{case_id}/messages", tags=["feedback"])
def list_case_messages(case_id: str, repo: Repo) -> list[Message]:
    """Every message of the case (MDT result, returned referral, patient notices), oldest first."""
    _case_or_404(repo, case_id)
    return repo.list_messages(case_id)


@router.get("/cases/{case_id}/receipts", tags=["feedback"])
def list_case_receipts(case_id: str, repo: Repo) -> list[Receipt]:
    """Proof of delivery ('doložit doručení'): the confirmed receipts, oldest first."""
    _case_or_404(repo, case_id)
    return repo.list_receipts(case_id)


@router.get("/inbox", tags=["feedback"])
def list_inbox(user: CurrentUser, repo: Repo) -> list[Message]:
    """The current user's in-app inbox (MVP: the GP's MDT results and returned referrals), across
    cases, newest first."""
    return repo.list_inbox(user.id)


@router.post("/messages/{message_id}/confirm", status_code=201, tags=["feedback"])
def confirm_receipt(message_id: str, user: CurrentUser, repo: Repo, clock: Clock) -> Receipt:
    """'Potvrzuji převzetí', a recipient of an `mdt_result` message: zpetna_vazba_odeslana →
    uzavreno. Closing ends a hold; open tasks stay. 404 for an unknown message; 403 for anyone
    but a recipient; 409 for another kind of message, a receipt already confirmed, or a case not
    awaiting it."""
    message = repo.get_message(message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "message not found")
    case = _case_or_404(repo, message.case_id)
    now = clock.now()
    try:
        receipt = confirm_message(message, user.id, now, receipts=repo.list_receipts(case.id))
    except NotRecipientError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from None
    except (NotConfirmableError, AlreadyConfirmedError) as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    try:
        closed = close_after_receipt(case)
    except TransitionError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    repo.save_receipt(receipt)
    closed = _save_progress(repo, closed)
    detail = audit_text.transition(case.state, closed.state)
    if case.on_hold is not None:
        detail += ", odložení zrušeno"
    _audit(repo, case.id, user.id, "receipt_confirmed", now, detail)
    return receipt


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
