"""DTOs for cases and tasks. Mirror `onko_contracts.cases`."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from ..cases import CaseState, QueueColumn, TaskStatus
from .common import Dto


class OnHoldDto(Dto):
    reason: str
    until: date | None
    set_by: str
    set_at: datetime


class MilestonesDto(Dto):
    symptom_onset: date | None
    referred_at: datetime | None
    mdt_held: date | None
    treatment_start: date | None


class CaseDto(Dto):
    id: str
    patient_name: str
    diagnosis_label: str | None
    koc: str
    referring_doctor_id: str
    coordinator_id: str | None
    state: CaseState
    queue: QueueColumn
    on_move: str | None = Field(description="Actor id responsible for the next step")
    next_step: str | None
    next_due: datetime | None
    mdt_date: date | None
    created_at: datetime
    on_hold: OnHoldDto | None = Field(description="Manual 'odloženo' flag (Q-F9)")
    milestones: MilestonesDto


class TaskDto(Dto):
    id: str
    case_id: str
    title: str
    kind: str
    location: str | None
    owner: str = Field(description="Actor id of whoever is 'na tahu' (on the move)")
    due: datetime | None
    status: TaskStatus
    depends_on: list[str] = Field(description="Task ids that must be done first")
    external: bool = Field(description="Waiting on someone outside the KOC")
    result_document_id: str | None
