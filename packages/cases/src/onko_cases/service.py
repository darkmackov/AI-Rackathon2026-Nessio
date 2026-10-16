"""State machine, dashboard queue, tasks and task sets."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from onko_contracts import (
    ALLOWED_TRANSITIONS,
    Case,
    CaseState,
    OnHold,
    QueueColumn,
    Task,
    TaskSet,
    TaskStatus,
)

from .models import TimeToTreatment, TransitionError


def transition(case: Case, to: CaseState) -> Case:
    if to not in ALLOWED_TRANSITIONS[case.state]:
        raise TransitionError(f"{case.state} -> {to} is not allowed")
    return case.model_copy(update={"state": to})


def open_tasks(tasks: list[Task]) -> list[Task]:
    return [t for t in tasks if t.status not in (TaskStatus.DONE, TaskStatus.CANCELLED)]


def ready_tasks(tasks: list[Task]) -> list[Task]:
    """Open tasks whose dependencies are all done: what can happen next."""
    done = {t.id for t in tasks if t.status is TaskStatus.DONE}
    return [t for t in open_tasks(tasks) if set(t.depends_on) <= done]


def queue_column(case: Case) -> QueueColumn:
    """Dashboard column. 'Odložený' is a manual coordinator flag (Q-F9), not derived."""
    if case.state in (CaseState.SENT, CaseState.TRIAGE):
        return QueueColumn.NEW
    if case.on_hold is not None:
        return QueueColumn.ON_HOLD
    return QueueColumn.ACTIVE


def put_on_hold(case: Case, reason: str, by: str, now: datetime, until: date | None = None) -> Case:
    hold = OnHold(reason=reason, until=until, set_by=by, set_at=now)
    case = case.model_copy(update={"on_hold": hold})
    return case.model_copy(update={"queue": queue_column(case)})


def resume(case: Case) -> Case:
    case = case.model_copy(update={"on_hold": None})
    return case.model_copy(update={"queue": queue_column(case)})


def time_to_treatment(case: Case) -> TimeToTreatment:
    m = case.milestones
    referred = m.referred_at.date() if m.referred_at else None

    def days(a: date | None, b: date | None) -> int | None:
        return (b - a).days if a and b else None

    return TimeToTreatment(
        t1=days(m.symptom_onset, referred),
        t2=days(referred, m.mdt_held),
        t3=days(m.mdt_held, m.treatment_start),
    )


def next_step(tasks: list[Task]) -> Task | None:
    """The ready task with the earliest due date: drives 'who is on the move and by when'."""
    ready = ready_tasks(tasks)
    return min(ready, key=lambda t: t.due or datetime.max) if ready else None


def start_task_set(case: Case, task_set: TaskSet, owners: dict[str, str], now: datetime) -> list[Task]:
    """Instantiate a task set for a case. `owners` maps owner_role -> actor id."""
    ids = {s.key: f"{case.id}-{task_set.id}-{s.key}" for s in task_set.steps}
    return [
        Task(
            id=ids[s.key],
            case_id=case.id,
            title=s.title,
            kind=s.kind,
            owner=owners.get(s.owner_role, s.owner_role),
            due=now + timedelta(days=s.due_offset_days) if s.due_offset_days is not None else None,
            depends_on=[ids[d] for d in s.depends_on],
        )
        for s in task_set.steps
    ]
