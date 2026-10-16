from datetime import date, datetime

import pytest
from onko_cases import (
    TransitionError,
    next_step,
    put_on_hold,
    queue_column,
    resume,
    start_task_set,
    time_to_treatment,
    transition,
)
from onko_contracts import (
    Case,
    CaseState,
    Milestones,
    QueueColumn,
    TaskSet,
    TaskStatus,
    TaskTemplate,
)

NOW = datetime(2026, 10, 2, 14, 0)

PANCREAS = TaskSet(
    id="ca-pankreas",
    name="Karcinom pankreatu",
    diagnosis_codes=["C25"],
    steps=[
        TaskTemplate(key="ct", title="CT břicha a hrudníku, pankreatický protokol", kind="imaging",
                     owner_role="coordinator", due_offset_days=6),
        TaskTemplate(key="eus", title="EUS-FNB", kind="biopsy", owner_role="coordinator",
                     due_offset_days=10, depends_on=["ct"]),
        TaskTemplate(key="mdt", title="MDT", kind="mdt", owner_role="coordinator",
                     due_offset_days=19, depends_on=["eus"]),
    ],
)


def _case(state=CaseState.COMPLETE):
    return Case(id="c1", patient_name="Alena Procházková", koc_id="koc2-lipova", referring_doctor_id="pl",
                state=state, created_at=NOW)


def test_illegal_transition_rejected():
    with pytest.raises(TransitionError):
        transition(_case(CaseState.SENT), CaseState.CLOSED)


def test_task_set_respects_dependencies():
    tasks = start_task_set(_case(), PANCREAS, {"coordinator": "lucie"}, NOW)
    assert next_step(tasks).title.startswith("CT")
    tasks[0] = tasks[0].model_copy(update={"status": TaskStatus.DONE})
    assert next_step(tasks).title == "EUS-FNB"


def test_on_hold_is_a_manual_flag():
    case = _case()
    assert queue_column(case) is QueueColumn.ACTIVE
    held = put_on_hold(case, "čeká na termín CT v KOC 1", "lucie", NOW, until=date(2026, 10, 8))
    assert held.queue is QueueColumn.ON_HOLD
    assert resume(held).queue is QueueColumn.ACTIVE
    assert queue_column(_case(CaseState.SENT)) is QueueColumn.NEW


def test_time_to_treatment_parts():
    case = _case().model_copy(update={"milestones": Milestones(
        symptom_onset=date(2026, 8, 15), referred_at=NOW, mdt_held=date(2026, 10, 21))})
    ttt = time_to_treatment(case)
    assert (ttt.t1, ttt.t2, ttt.t3, ttt.total) == (48, 19, None, None)
