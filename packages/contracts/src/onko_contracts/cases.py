"""Case, journey tasks and task sets (maps to FHIR CarePlan / Task)."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import Field

from .common import Model


class CaseState(StrEnum):
    """The 8 case states from the VZP brief (slide 10), plus `koncept` (D-8) and
    `vraceno_lekari` (D-15)."""

    DRAFT = "koncept"  # GP is preparing the referral; not on the KOC dashboard
    SENT = "odeslano"
    TRIAGE = "v_triage"
    RETURNED_TO_REFERRER = "vraceno_lekari"  # coordinator sent it back to the GP with a note
    WAITING_FOR_DOCUMENTS = "ceka_na_podklady"
    COMPLETE = "kompletni"
    READY_FOR_MDT = "pripraveno_k_mdt"
    MDT_CONCLUSION = "zaver_mdt"
    FEEDBACK_SENT = "zpetna_vazba_odeslana"
    CLOSED = "uzavreno"


ALLOWED_TRANSITIONS: dict[CaseState, set[CaseState]] = {
    CaseState.DRAFT: {CaseState.SENT},
    CaseState.SENT: {CaseState.TRIAGE},
    CaseState.TRIAGE: {
        CaseState.WAITING_FOR_DOCUMENTS,
        CaseState.COMPLETE,
        CaseState.RETURNED_TO_REFERRER,
    },
    # The GP resends; the case goes straight back to the coordinator who returned it (D-15)
    CaseState.RETURNED_TO_REFERRER: {CaseState.TRIAGE},
    CaseState.WAITING_FOR_DOCUMENTS: {CaseState.COMPLETE, CaseState.RETURNED_TO_REFERRER},
    CaseState.COMPLETE: {
        CaseState.READY_FOR_MDT,
        CaseState.WAITING_FOR_DOCUMENTS,
        CaseState.RETURNED_TO_REFERRER,
    },
    CaseState.READY_FOR_MDT: {CaseState.MDT_CONCLUSION},
    CaseState.MDT_CONCLUSION: {CaseState.FEEDBACK_SENT},
    CaseState.FEEDBACK_SENT: {CaseState.CLOSED},
    CaseState.CLOSED: set(),
}


class QueueColumn(StrEnum):
    """Coordinator dashboard columns (slide 9)."""

    NEW = "novy"
    ACTIVE = "aktivni"
    ON_HOLD = "odlozeny"  # set manually by the coordinator (Q-F9)


class Priority(StrEnum):
    """Slide 9: 'pacienti, priority, úkoly'."""

    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class TaskStatus(StrEnum):
    PLANNED = "planned"
    BOOKED = "booked"  # objednáno, has a date
    DONE = "done"
    CANCELLED = "cancelled"


class Task(Model):
    id: str
    case_id: str
    title: str
    kind: str = Field(description="e.g. imaging, biopsy, lab, consult, request_documents, mdt")
    location: str | None = None
    owner: str = Field(description="Actor or organization id of whoever is 'na tahu' (on the move)")
    priority: Priority = Priority.NORMAL
    due: datetime | None = None
    status: TaskStatus = TaskStatus.PLANNED
    depends_on: list[str] = Field(default_factory=list, description="Task ids that must be done first")
    external: bool = Field(
        default=False,
        description="Performed outside the KOC (e.g. CT at KOC 1). Informational; on hold is manual (Q-F9)",
    )
    finding_id: str | None = Field(
        default=None, description="Finding this task resolves, e.g. a request task for F09 (Q-F23)"
    )
    result_document_id: str | None = None


class TaskTemplate(Model):
    key: str
    title: str
    kind: str
    owner_role: str
    due_offset_days: int | None = None
    depends_on: list[str] = Field(default_factory=list, description="Keys of other steps in the set")


class TaskSet(Model):
    """A reusable set of steps for a diagnosis, created and edited by coordinators in the UI."""

    id: str
    name: str
    diagnosis_codes: list[str] = Field(default_factory=list, description="e.g. ['C25']")
    steps: list[TaskTemplate]
    created_by: str | None = None


class OnHold(Model):
    """Set by the coordinator; puts the case in the 'Odložený' column."""

    reason: str
    until: date | None = None
    set_by: str
    set_at: datetime


class Milestones(Model):
    """Dates behind time to treatment = T1 + T2 + T3 (slide 4)."""

    symptom_onset: date | None = Field(default=None, description="First symptoms (from documents)")
    referred_at: datetime | None = Field(default=None, description="Referral sent to the KOC")
    mdt_held: date | None = None
    treatment_start: date | None = None


class TimeToTreatment(Model):
    """Slide 4: T1 symptom -> referral, T2 referral -> MDT, T3 MDT -> treatment, in days.
    A part is None until both of its dates are known."""

    t1: int | None = None
    t2: int | None = None
    t3: int | None = None
    total: int | None = None


class Case(Model):
    id: str
    patient_name: str
    diagnosis_label: str | None = None
    koc_id: str = Field(description="Organization id of the receiving KOC")
    mdt_board_id: str | None = None
    referring_doctor_id: str
    coordinator_id: str | None = None
    state: CaseState = CaseState.SENT
    priority: Priority = Priority.NORMAL
    queue: QueueColumn = QueueColumn.NEW
    on_move: str | None = Field(default=None, description="Actor id responsible for the next step")
    next_step: str | None = None
    next_due: datetime | None = None
    mdt_date: date | None = None
    created_at: datetime
    on_hold: OnHold | None = Field(default=None, description="Manual 'odloženo' flag (Q-F9)")
    milestones: Milestones = Field(default_factory=Milestones)

