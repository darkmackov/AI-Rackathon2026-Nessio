"""Feedback loop (S6): sending the result, closing on receipt, attachments, patient notices. Pure
logic, fixed NOW."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from onko_cases import (
    CaseStateError,
    ConclusionNotConfirmedError,
    TransitionError,
    close_after_receipt,
    feedback_attachments,
    refresh_progress,
    require_patient_notice_allowed,
    send_feedback,
)
from onko_contracts import (
    Case,
    CaseState,
    ConclusionSource,
    Evidence,
    Examination,
    FieldStatus,
    Handover,
    MdtConclusion,
    OnHold,
    QueueColumn,
    Sourced,
    Stamp,
    Task,
)

NOW = datetime(2026, 10, 22, 9, 0)
CONFIRMED = MdtConclusion(case_id="c1", conclusion="Resekabilní.", confirmed=Stamp(by="koord-a", at=NOW))
HOLD = OnHold(reason="čeká na CT", set_by="koord-a", set_at=NOW)


def _case(state: CaseState, **update) -> Case:
    case = Case(id="c1", patient_name="Jana Nováková", koc_id="koc-a", referring_doctor_id="pl-a",
                coordinator_id="koord-a", state=state, queue=QueueColumn.ACTIVE,
                created_at=datetime(2026, 10, 2, 14, 0), on_move="koord-a",
                next_step="MDT", next_due=NOW)
    return case.model_copy(update=update)


def _snapshot() -> Handover:
    return Handover(
        case_id="c1", as_of=date(2026, 10, 21),
        diagnosis=Sourced(value="Karcinom", status=FieldStatus.FOUND,
                          evidence=[Evidence(document_id="d9", quote="Karcinom"),
                                    Evidence(document_id="d1", quote="Karcinom")]),
        examinations=[Examination(date=date(2026, 10, 8), place="KOC 1", type="CT",
                                  result_full_text="Tumor.",
                                  evidence=[Evidence(document_id="d2", quote="Tumor")])],
    )


def test_sending_moves_to_feedback_sent_and_waits_on_the_gp():
    sent = send_feedback(_case(CaseState.MDT_CONCLUSION), CONFIRMED)
    assert sent.state is CaseState.FEEDBACK_SENT
    assert (sent.on_move, sent.next_step, sent.next_due) == ("pl-a", None, None)


@pytest.mark.parametrize("state", [CaseState.READY_FOR_MDT, CaseState.FEEDBACK_SENT, CaseState.CLOSED])
def test_sending_outside_zaver_mdt_is_refused(state):
    with pytest.raises(TransitionError):
        send_feedback(_case(state), CONFIRMED)


def test_an_unconfirmed_conclusion_is_not_sent():
    with pytest.raises(ConclusionNotConfirmedError):
        send_feedback(_case(CaseState.MDT_CONCLUSION), CONFIRMED.model_copy(update={"confirmed": None}))


def test_receipt_closes_the_case_ends_the_hold_and_nobody_is_on_the_move():
    closed = close_after_receipt(_case(CaseState.FEEDBACK_SENT, on_hold=HOLD, queue=QueueColumn.ON_HOLD,
                                       on_move="pl-a"))
    assert closed.state is CaseState.CLOSED
    assert closed.on_hold is None
    assert closed.queue is QueueColumn.ACTIVE
    assert (closed.on_move, closed.next_step, closed.next_due) == (None, None, None)


@pytest.mark.parametrize("state", [CaseState.MDT_CONCLUSION, CaseState.CLOSED])
def test_only_a_sent_feedback_closes(state):
    with pytest.raises(TransitionError):
        close_after_receipt(_case(state))


def test_open_tasks_do_not_put_anyone_else_on_the_move_after_sending_or_closing():
    task = Task(id="t1", case_id="c1", title="Kontrola", kind="lab", owner="koord-a", due=NOW)
    assert refresh_progress(_case(CaseState.FEEDBACK_SENT), [task]).on_move == "pl-a"
    assert refresh_progress(_case(CaseState.CLOSED), [task]).on_move is None


def test_attachments_are_the_snapshot_quotes_sorted():
    assert feedback_attachments(CONFIRMED, _snapshot()) == ["d1", "d2", "d9"]


def test_an_uploaded_report_comes_first_and_only_once():
    uploaded = CONFIRMED.model_copy(update={"source": ConclusionSource.UPLOADED, "document_id": "d2"})
    assert feedback_attachments(uploaded, _snapshot()) == ["d2", "d1", "d9"]
    assert feedback_attachments(uploaded, None) == ["d2"]


@pytest.mark.parametrize("state", [CaseState.DRAFT, CaseState.SENT, CaseState.CLOSED])
def test_no_patient_notice_before_take_over_or_after_closing(state):
    with pytest.raises(CaseStateError):
        require_patient_notice_allowed(_case(state))


@pytest.mark.parametrize("state", [CaseState.TRIAGE, CaseState.COMPLETE, CaseState.READY_FOR_MDT,
                                   CaseState.FEEDBACK_SENT, CaseState.RETURNED_TO_REFERRER])
def test_patient_notice_allowed_after_take_over(state):
    require_patient_notice_allowed(_case(state))
