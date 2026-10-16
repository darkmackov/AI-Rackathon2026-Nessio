"""Flow 1 (S3): the GP's referral draft, manual handover edits, validation and sending."""

from __future__ import annotations

import datetime as dt
from typing import Any

from onko_contracts import (
    Case,
    CaseState,
    Examination,
    FieldStatus,
    Handover,
    Origin,
    QueueColumn,
    Sourced,
    Stamp,
)

from .models import HandoverEditError, HandoverLockedError, NotValidatedError, TransitionError
from .service import queue_column, transition

# Who may edit the handover when (Q-F22, D-15): the GP while drafting or after a return, the
# coordinator from triage until the MDT snapshot.
EDITABLE_STATES: dict[str, frozenset[CaseState]] = {
    "referring_doctor": frozenset({CaseState.DRAFT, CaseState.RETURNED_TO_REFERRER}),
    "coordinator": frozenset(
        {CaseState.TRIAGE, CaseState.WAITING_FOR_DOCUMENTS, CaseState.COMPLETE}
    ),
}

# 'Validovat a odeslat': a draft goes to the KOC, a returned referral back to its coordinator.
_SEND = {
    CaseState.DRAFT: CaseState.SENT,
    CaseState.RETURNED_TO_REFERRER: CaseState.TRIAGE,
}

_GROUPS = ("patient", "contacts")


def new_referral(
    case_id: str, koc_id: str, referring_doctor_id: str, now: dt.datetime
) -> tuple[Case, Handover]:
    """A referral draft (`koncept`) and its empty handover. The patient name comes from the
    handover once a document is extracted (`sync_case_from_handover`)."""
    case = Case(
        id=case_id,
        patient_name="",
        koc_id=koc_id,
        referring_doctor_id=referring_doctor_id,
        state=CaseState.DRAFT,
        queue=QueueColumn.NEW,
        created_at=now,
    )
    return case, Handover(case_id=case_id, as_of=now.date())


def receive_referral(
    case_id: str, koc_id: str, referring_doctor_id: str, now: dt.datetime
) -> tuple[Case, Handover]:
    """A referral that arrives already sent, as a FHIR Bundle from the GP's system (S9, Q-I20):
    `odeslano` in Nový, referred now. The handover is empty until its documents are extracted and
    carries no validation stamp, because the GP never validated it in the app (never inferred)."""
    draft, handover = new_referral(case_id, koc_id, referring_doctor_id, now)
    sent = transition(draft, CaseState.SENT)
    sent = sent.model_copy(update={
        "milestones": sent.milestones.model_copy(update={"referred_at": now}),
    })
    return sent.model_copy(update={"queue": queue_column(sent)}), handover


def require_editable(case: Case, role: str) -> None:
    """`HandoverLockedError` unless `role` may change the handover in the case's state."""
    if case.state not in EDITABLE_STATES.get(role, frozenset()):
        raise HandoverLockedError(f"handover can't be changed by {role} in state {case.state}")


def set_handover_field(
    handover: Handover,
    path: str,
    value: Any,
    *,
    not_available: bool,
    note: str | None,
    by: str,
    now: dt.datetime,
) -> Handover:
    """'Doplnit' (a value) or 'Není k dispozici' on one `Sourced` field, as origin=manual.
    A value of the wrong type raises pydantic's `ValidationError`."""
    parts = path.split(".")
    if not _is_sourced_path(handover, parts):
        raise HandoverEditError(f"not an editable handover field: {path}")
    if not not_available and value is None:
        raise HandoverEditError("give a value or not_available")
    entry: dict[str, Any] = {
        "value": None if not_available else value,
        "status": FieldStatus.MISSING if not_available else FieldStatus.FOUND,
        "origin": Origin.MANUAL,
        "entered": Stamp(by=by, at=now).model_dump(),
        "note": note,
    }
    data = handover.model_dump()
    target = data
    for part in parts[:-1]:
        target = target[part]
    target[parts[-1]] = entry
    return Handover.model_validate(data)


def _is_sourced_path(handover: Handover, parts: list[str]) -> bool:
    if len(parts) == 1:
        return parts[0] in Handover.model_fields and isinstance(getattr(handover, parts[0]), Sourced)
    if len(parts) == 2 and parts[0] in _GROUPS:
        group = getattr(handover, parts[0])
        return parts[1] in type(group).model_fields
    return False


def add_examination(
    handover: Handover,
    *,
    date: dt.date,
    place: str,
    type: str,
    result_full_text: str,
    by: str,
    now: dt.datetime,
) -> Handover:
    """Append a manually entered examination (origin=manual)."""
    exam = Examination(
        date=date,
        place=place,
        type=type,
        result_full_text=result_full_text,
        origin=Origin.MANUAL,
        entered=Stamp(by=by, at=now),
    )
    return handover.model_copy(update={"examinations": [*handover.examinations, exam]})


def validate_handover(case: Case, handover: Handover, by: str, now: dt.datetime) -> Handover:
    """The referring doctor validates the AI proposal before sending (Q-F5)."""
    if case.state not in _SEND:
        raise HandoverLockedError(f"handover can't be validated in state {case.state}")
    return handover.model_copy(update={"validated_by_referrer": Stamp(by=by, at=now)})


def send_referral(
    case: Case, handover: Handover, last_returned_at: dt.datetime | None, now: dt.datetime
) -> Case:
    """'Validovat a odeslat': koncept → odeslano, or vraceno_lekari → v_triage (D-15).

    Needs the GP's validation; after a return it must be newer than the return. Gaps never block
    sending (Q-F22)."""
    if case.state not in _SEND:
        raise TransitionError(f"{case.state} can't be sent")
    stamp = handover.validated_by_referrer
    if stamp is None:
        raise NotValidatedError("the referring doctor hasn't validated the handover")
    if (
        case.state is CaseState.RETURNED_TO_REFERRER
        and last_returned_at is not None
        and stamp.at <= last_returned_at
    ):
        raise NotValidatedError("validate the handover again after the return")
    sent = transition(case, _SEND[case.state])
    if sent.milestones.referred_at is None:
        sent = sent.model_copy(
            update={"milestones": sent.milestones.model_copy(update={"referred_at": now})}
        )
    return sent.model_copy(update={"queue": queue_column(sent)})


def sync_case_from_handover(case: Case, handover: Handover) -> Case:
    """Patient name and diagnosis label for the dashboard, from the handover's values. A value
    the handover doesn't have leaves the case's one unchanged."""
    names = [v for v in (handover.patient.first_name.value, handover.patient.last_name.value) if v]
    update: dict[str, Any] = {}
    if names:
        update["patient_name"] = " ".join(names)
    if handover.diagnosis.value:
        update["diagnosis_label"] = handover.diagnosis.value
    return case.model_copy(update=update) if update else case
