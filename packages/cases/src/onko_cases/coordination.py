"""The coordinator's workflow (S4): take-over, manual state moves, returns, findings, tasks, task
sets, who is on the move, deadline notices and the audit log."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta

from onko_contracts import (
    Actor,
    AuditEvent,
    Case,
    CaseState,
    DueNotice,
    Finding,
    Organization,
    Resolution,
    ResolutionKind,
    Task,
    TaskSet,
    TaskTemplate,
)

from .models import CaseStateError, OverrideNotAllowedError, TaskError, TransitionError
from .service import next_step, open_tasks, queue_column, transition

# The moves a coordinator makes by hand. Every other state change has its own action: take-over,
# return, MDT snapshot / confirmation, feedback, receipt.
MANUAL_TRANSITIONS: dict[CaseState, frozenset[CaseState]] = {
    CaseState.TRIAGE: frozenset({CaseState.WAITING_FOR_DOCUMENTS, CaseState.COMPLETE}),
    CaseState.WAITING_FOR_DOCUMENTS: frozenset({CaseState.COMPLETE}),
    CaseState.COMPLETE: frozenset({CaseState.WAITING_FOR_DOCUMENTS}),
}

# Tasks are worked on once the case is taken over, until it closes.
TASK_LOCKED_STATES = frozenset({CaseState.DRAFT, CaseState.SENT, CaseState.CLOSED})

COORDINATOR_ROLE = "coordinator"


def _moved(case: Case, to: CaseState) -> Case:
    moved = transition(case, to)
    return moved.model_copy(update={"queue": queue_column(moved)})


def refresh_progress(case: Case, tasks: list[Task]) -> Case:
    """Who is on the move, the next step and its due date. A returned case waits on the referring
    doctor; otherwise the earliest ready task decides, and without one the coordinator is on the
    move with no step. The step text only ever comes from a task title."""
    if case.state is CaseState.RETURNED_TO_REFERRER:
        on_move, title, due = case.referring_doctor_id, None, None
    elif (step := next_step(tasks)) is not None:
        on_move, title, due = step.owner, step.title, step.due
    else:
        on_move, title, due = case.coordinator_id, None, None
    return case.model_copy(update={"on_move": on_move, "next_step": title, "next_due": due})


def take_over(case: Case, coordinator_id: str, tasks: list[Task]) -> Case:
    """'Převzít': odeslano → v_triage with this coordinator."""
    if case.state is not CaseState.SENT:
        raise TransitionError(f"only a sent referral can be taken over, not {case.state}")
    taken = _moved(case, CaseState.TRIAGE).model_copy(update={"coordinator_id": coordinator_id})
    return refresh_progress(taken, tasks)


def manual_transition(case: Case, to: CaseState) -> Case:
    """A coordinator's move between triage, waiting for documents and complete."""
    if to not in MANUAL_TRANSITIONS.get(case.state, frozenset()):
        raise TransitionError(f"{case.state} -> {to} is not a manual move")
    return _moved(case, to)


def return_to_referrer(case: Case) -> Case:
    """'Vrátit lékaři' (D-15): the referring doctor is on the move until they resend."""
    return refresh_progress(_moved(case, CaseState.RETURNED_TO_REFERRER), [])


def resolve_finding(
    finding: Finding, kind: ResolutionKind, note: str | None, by: str, now: datetime
) -> Finding:
    """Resolve, override (note required) or dismiss; a later resolution replaces an earlier one.
    A missing override note raises pydantic's `ValidationError`."""
    if kind is ResolutionKind.OVERRIDDEN and not finding.overridable:
        raise OverrideNotAllowedError(f"finding {finding.id} can't be overridden")
    resolution = Resolution(kind=kind, note=note, by=by, at=now)
    return finding.model_copy(update={"resolved": True, "resolution": resolution})


def require_tasks_writable(case: Case) -> None:
    if case.state in TASK_LOCKED_STATES:
        raise CaseStateError(f"tasks can't be changed in state {case.state}")


def _cycle(graph: Mapping[str, Iterable[str]]) -> bool:
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(node: str) -> bool:
        if node in done:
            return False
        if node in visiting:
            return True
        visiting.add(node)
        found = any(visit(d) for d in graph.get(node, ()))
        visiting.discard(node)
        done.add(node)
        return found

    return any(visit(node) for node in graph)


def check_dependencies(task_id: str, depends_on: list[str], case_tasks: list[Task]) -> None:
    """`depends_on` names other tasks of the same case and closes no cycle."""
    known = {t.id for t in case_tasks}
    unknown = [d for d in depends_on if d not in known or d == task_id]
    if unknown:
        raise TaskError(f"unknown dependencies: {', '.join(unknown)}")
    graph = {t.id: list(t.depends_on) for t in case_tasks}
    graph[task_id] = list(depends_on)
    if _cycle(graph):
        raise TaskError("the dependencies form a cycle")


def check_task_set(steps: list[TaskTemplate]) -> None:
    """Unique step keys, dependencies on steps of the same set, no cycle."""
    keys = [s.key for s in steps]
    if len(set(keys)) != len(keys):
        raise TaskError("step keys must be unique")
    for step in steps:
        unknown = [d for d in step.depends_on if d not in keys or d == step.key]
        if unknown:
            raise TaskError(f"step {step.key}: unknown dependencies {', '.join(unknown)}")
    if _cycle({s.key: s.depends_on for s in steps}):
        raise TaskError("the steps' dependencies form a cycle")


def matches_diagnosis(task_set: TaskSet, diagnosis_code: str) -> bool:
    """A set for `C25` fits `C25.0`."""
    return any(diagnosis_code.upper().startswith(code.upper()) for code in task_set.diagnosis_codes)


def owner_organization(
    owner_id: str, actors: Iterable[Actor], organizations: Iterable[Organization]
) -> str | None:
    """The organisation an owner belongs to: itself for an organisation, the actor's for a person.
    `TaskError` if the id isn't in the directory."""
    if any(o.id == owner_id for o in organizations):
        return owner_id
    for actor in actors:
        if actor.id == owner_id:
            return actor.organization_id
    raise TaskError(f"unknown owner: {owner_id}")


def is_external(owner_org: str | None, case: Case) -> bool:
    """Performed outside the case's KOC (informational, Q-F9)."""
    return owner_org is not None and owner_org != case.koc_id


def resolve_owners(task_set: TaskSet, owners: Mapping[str, str], case: Case) -> dict[str, str]:
    """owner_role -> owner id for every step. The coordinator role defaults to the case's
    coordinator; any other role must be given, so no role name ever becomes an owner."""
    resolved = dict(owners)
    if COORDINATOR_ROLE not in resolved and case.coordinator_id:
        resolved[COORDINATOR_ROLE] = case.coordinator_id
    missing = sorted({s.owner_role for s in task_set.steps} - resolved.keys())
    if missing:
        raise TaskError(f"no owner for: {', '.join(missing)}")
    return resolved


def task_set_started(case: Case, task_set: TaskSet, case_tasks: list[Task]) -> bool:
    """Whether the set's tasks already exist on the case (their ids are `{case}-{set}-{key}`)."""
    ids = {f"{case.id}-{task_set.id}-{s.key}" for s in task_set.steps}
    return any(t.id in ids for t in case_tasks)


def due_notices(
    tasks: Iterable[Task],
    owner_ids: set[str],
    coordinated_case_ids: set[str],
    now: datetime,
    within_days: int,
) -> list[DueNotice]:
    """In-app deadline notices (Q-F17): open tasks due within `within_days` or overdue, that the
    user owns (as a person or through their organisation) or that belong to a case they
    coordinate. Earliest due first."""
    horizon = now + timedelta(days=within_days)
    notices = [
        DueNotice(task_id=t.id, case_id=t.case_id, title=t.title, due=t.due, overdue=t.due < now)
        for t in open_tasks(list(tasks))
        if t.due is not None
        and t.due <= horizon
        and (t.owner in owner_ids or t.case_id in coordinated_case_ids)
    ]
    return sorted(notices, key=lambda n: n.due)


def audit_event(
    event_id: str, case_id: str, by: str, action: str, now: datetime, detail: str | None = None
) -> AuditEvent:
    """One row of the case's append-only audit trail (PER-13)."""
    return AuditEvent(id=event_id, case_id=case_id, at=now, actor_id=by, action=action,
                      detail=detail)
