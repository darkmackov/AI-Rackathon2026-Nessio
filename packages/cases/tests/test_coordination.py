"""The coordinator's workflow (S4): pure logic, fixed NOW (TEST-3)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from onko_cases import (
    CaseStateError,
    OverrideNotAllowedError,
    TaskError,
    TransitionError,
    check_dependencies,
    check_task_set,
    due_notices,
    is_external,
    manual_transition,
    matches_diagnosis,
    owner_organization,
    put_on_hold,
    refresh_progress,
    require_tasks_writable,
    resolve_finding,
    resolve_owners,
    return_to_referrer,
    start_task_set,
    take_over,
    task_set_started,
)
from onko_contracts import (
    Actor,
    Case,
    CaseState,
    Finding,
    FindingKind,
    Organization,
    OrganizationKind,
    QueueColumn,
    ResolutionKind,
    Severity,
    Task,
    TaskSet,
    TaskStatus,
    TaskTemplate,
)
from pydantic import ValidationError

NOW = datetime(2026, 10, 2, 14, 0)


def _case(state: CaseState = CaseState.SENT, **update) -> Case:
    case = Case(id="c1", patient_name="Alena Procházková", koc_id="koc2", referring_doctor_id="pl",
                state=state, created_at=NOW)
    return case.model_copy(update=update)


def _task(task_id: str, **update) -> Task:
    fields = {"title": task_id.upper(), "kind": "lab", "owner": "koord", **update}
    return Task(id=task_id, case_id="c1", **fields)


def test_take_over_moves_a_sent_referral_to_triage_with_the_coordinator_on_the_move():
    taken = take_over(_case(), "koord", [])
    assert taken.state is CaseState.TRIAGE
    assert taken.coordinator_id == "koord"
    assert (taken.on_move, taken.next_step, taken.next_due) == ("koord", None, None)
    assert taken.queue is QueueColumn.NEW


def test_take_over_only_from_sent():
    with pytest.raises(TransitionError):
        take_over(_case(CaseState.TRIAGE), "koord", [])


@pytest.mark.parametrize(("start", "to"), [
    (CaseState.TRIAGE, CaseState.WAITING_FOR_DOCUMENTS),
    (CaseState.TRIAGE, CaseState.COMPLETE),
    (CaseState.WAITING_FOR_DOCUMENTS, CaseState.COMPLETE),
    (CaseState.COMPLETE, CaseState.WAITING_FOR_DOCUMENTS),
])
def test_manual_moves_between_triage_waiting_and_complete(start, to):
    moved = manual_transition(_case(start), to)
    assert moved.state is to
    assert moved.queue is QueueColumn.ACTIVE


@pytest.mark.parametrize(("start", "to"), [
    (CaseState.SENT, CaseState.TRIAGE),  # take-over
    (CaseState.TRIAGE, CaseState.RETURNED_TO_REFERRER),  # return
    (CaseState.COMPLETE, CaseState.READY_FOR_MDT),  # MDT snapshot
    (CaseState.READY_FOR_MDT, CaseState.MDT_CONCLUSION),  # conclusion confirmed
])
def test_moves_with_their_own_action_are_not_manual(start, to):
    with pytest.raises(TransitionError):
        manual_transition(_case(start), to)


def test_return_puts_the_referring_doctor_on_the_move():
    returned = return_to_referrer(_case(CaseState.COMPLETE, coordinator_id="koord"))
    assert returned.state is CaseState.RETURNED_TO_REFERRER
    assert (returned.on_move, returned.next_step, returned.next_due) == ("pl", None, None)
    with pytest.raises(TransitionError):
        return_to_referrer(_case(CaseState.READY_FOR_MDT))


def test_progress_follows_the_earliest_ready_task():
    case = _case(CaseState.TRIAGE, coordinator_id="koord")
    tasks = [
        _task("ct", owner="koc1", due=NOW + timedelta(days=6)),
        _task("lab", due=NOW + timedelta(days=3), depends_on=["ct"]),
        _task("psych", owner="psych", due=NOW + timedelta(days=9)),
    ]
    progress = refresh_progress(case, tasks)
    assert (progress.on_move, progress.next_step, progress.next_due) == (
        "koc1", "CT", NOW + timedelta(days=6))

    done = [t.model_copy(update={"status": TaskStatus.DONE}) for t in tasks]
    assert refresh_progress(case, done).on_move == "koord"
    assert refresh_progress(case, done).next_step is None


@pytest.mark.parametrize("state", [CaseState.DRAFT, CaseState.SENT,
                                   CaseState.RETURNED_TO_REFERRER, CaseState.CLOSED])
def test_hold_is_refused_outside_triage_to_feedback(state):
    with pytest.raises(CaseStateError):
        put_on_hold(_case(state), "čeká na CT", "koord", NOW)


def test_hold_again_replaces_the_reason():
    held = put_on_hold(_case(CaseState.COMPLETE), "první", "koord", NOW)
    again = put_on_hold(held, "druhý", "koord", NOW + timedelta(hours=1))
    assert again.on_hold.reason == "druhý"
    assert again.queue is QueueColumn.ON_HOLD


def _finding(**update) -> Finding:
    return Finding(id="F01", kind=FindingKind.MISSING, severity=Severity.BLOCKER,
                   message_cs="Chybí ECOG", **update)


def test_override_with_a_note_resolves_the_finding():
    resolved = resolve_finding(_finding(), ResolutionKind.OVERRIDDEN, "ECOG nedostupný", "koord", NOW)
    assert resolved.resolved
    assert resolved.resolution.kind is ResolutionKind.OVERRIDDEN
    assert (resolved.resolution.by, resolved.resolution.at) == ("koord", NOW)


def test_override_needs_a_note_and_an_overridable_finding():
    with pytest.raises(ValidationError):
        resolve_finding(_finding(), ResolutionKind.OVERRIDDEN, None, "koord", NOW)
    with pytest.raises(OverrideNotAllowedError):
        resolve_finding(_finding(overridable=False), ResolutionKind.OVERRIDDEN, "x", "koord", NOW)
    dismissed = resolve_finding(_finding(overridable=False), ResolutionKind.DISMISSED, None, "k", NOW)
    assert dismissed.resolved


@pytest.mark.parametrize("state", [CaseState.DRAFT, CaseState.SENT, CaseState.CLOSED])
def test_tasks_are_locked_before_take_over_and_after_closing(state):
    with pytest.raises(CaseStateError):
        require_tasks_writable(_case(state))


def test_tasks_stay_writable_after_the_mdt():
    require_tasks_writable(_case(CaseState.FEEDBACK_SENT))


def test_dependencies_must_be_tasks_of_the_case_without_cycles():
    tasks = [_task("a"), _task("b", depends_on=["a"])]
    check_dependencies("c", ["a", "b"], tasks)
    with pytest.raises(TaskError):
        check_dependencies("c", ["nope"], tasks)
    with pytest.raises(TaskError):
        check_dependencies("a", ["b"], tasks)  # a -> b -> a
    with pytest.raises(TaskError):
        check_dependencies("a", ["a"], tasks)


def _step(key: str, role: str = "coordinator", depends_on: list[str] | None = None) -> TaskTemplate:
    return TaskTemplate(key=key, title=key.upper(), kind="lab", owner_role=role,
                        depends_on=depends_on or [])


def test_task_set_steps_must_hold_together():
    check_task_set([_step("ct"), _step("mdt", depends_on=["ct"])])
    with pytest.raises(TaskError):
        check_task_set([_step("ct"), _step("ct")])
    with pytest.raises(TaskError):
        check_task_set([_step("mdt", depends_on=["ct"])])
    with pytest.raises(TaskError):
        check_task_set([_step("a", depends_on=["b"]), _step("b", depends_on=["a"])])


def test_task_sets_match_diagnosis_by_prefix():
    task_set = TaskSet(id="ts", name="Pankreas", diagnosis_codes=["C25"], steps=[])
    assert matches_diagnosis(task_set, "C25.0")
    assert matches_diagnosis(task_set, "c25")
    assert not matches_diagnosis(task_set, "C18")


def test_coordinator_role_defaults_to_the_case_coordinator_and_other_roles_must_be_given():
    task_set = TaskSet(id="ts", name="Pankreas", steps=[_step("ct", "imaging_site"), _step("mdt")])
    case = _case(CaseState.TRIAGE, coordinator_id="koord")
    owners = resolve_owners(task_set, {"imaging_site": "koc1"}, case)
    assert owners == {"imaging_site": "koc1", "coordinator": "koord"}
    with pytest.raises(TaskError):
        resolve_owners(task_set, {}, case)


def test_a_started_task_set_is_recognised():
    task_set = TaskSet(id="ts", name="Pankreas", steps=[_step("ct")])
    case = _case(CaseState.TRIAGE)
    tasks = start_task_set(case, task_set, {"coordinator": "koord"}, NOW)
    assert task_set_started(case, task_set, tasks)
    assert not task_set_started(case, task_set, [_task("other")])


def test_owners_resolve_to_their_organisation_and_outside_the_koc_is_external():
    actors = [Actor(id="koord", name="K", role="coordinator", organization_id="koc2"),
              Actor(id="pato", name="P", role="specialist", organization_id="lab")]
    orgs = [Organization(id="koc1", name="KOC 1", kind=OrganizationKind.KOC)]
    case = _case()
    assert owner_organization("koc1", actors, orgs) == "koc1"
    assert owner_organization("pato", actors, orgs) == "lab"
    assert not is_external(owner_organization("koord", actors, orgs), case)
    assert is_external(owner_organization("koc1", actors, orgs), case)
    with pytest.raises(TaskError):
        owner_organization("nobody", actors, orgs)


def test_due_notices_cover_owned_and_coordinated_tasks_within_the_window():
    tasks = [
        _task("overdue", owner="koord", due=NOW - timedelta(days=1)),
        _task("soon", owner="koc2", due=NOW + timedelta(days=1)),
        _task("later", owner="koord", due=NOW + timedelta(days=5)),
        _task("done", owner="koord", due=NOW, status=TaskStatus.DONE),
        _task("nodue", owner="koord"),
        Task(id="other", case_id="c2", title="X", kind="lab", owner="someone", due=NOW),
        Task(id="coord", case_id="c3", title="Y", kind="lab", owner="someone", due=NOW),
    ]
    notices = due_notices(tasks, {"koord", "koc2"}, {"c3"}, NOW, within_days=2)
    assert [n.task_id for n in notices] == ["overdue", "coord", "soon"]
    assert {n.task_id: n.overdue for n in notices} == {"overdue": True, "soon": False, "coord": False}
