"""Demo data: the directory, the reference case and the reset scenarios, so the UI has realistic
data before the AI exists."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

from onko_cases import next_step, queue_column, start_task_set
from onko_contracts import (
    Actor,
    Case,
    CaseState,
    DocumentMeta,
    Finding,
    Handover,
    MdtBoard,
    Milestones,
    Organization,
    Priority,
    TaskSet,
    TaskStatus,
    TaskTemplate,
)
from onko_repository import CaseRepository
from pydantic import TypeAdapter

from .clock import AppClock
from .schemas import DemoScenario

DATA = Path(os.environ.get("ONKO_DATA_DIR", Path(__file__).resolve().parents[4] / "data"))
DIRECTORY = DATA / "demo" / "directory.json"
REF = DATA / "vzp-structured" / "reference"
REPORTS = DATA / "vzp-structured" / "reports"
CASE_ID = "vzp-prochazkova"

# Where each scenario puts the app clock (D-10): the start of the story (referral, 2. 10.) or the
# morning of the MDT (21. 10.).
SCENARIO_CLOCK = {
    DemoScenario.EMPTY: datetime(2026, 10, 2, 8, 0),
    DemoScenario.REFERENCE_AT_MDT: datetime(2026, 10, 21, 8, 0),
}

# Starter task set as a coordinator would create it in the UI; stored as user data.
PANCREAS_TASK_SET = TaskSet(
    id="ca-pankreas",
    name="Karcinom pankreatu – diagnostika do MDT",
    diagnosis_codes=["C25"],
    created_by="koordinator",
    steps=[
        TaskTemplate(key="ct", title="CT břicha a hrudníku, pankreatický protokol (KOC 1)", kind="imaging",
                     owner_role="imaging_site", due_offset_days=6),
        TaskTemplate(key="eus", title="EUS-FNB ložiska hlavy pankreatu", kind="biopsy",
                     owner_role="coordinator", due_offset_days=10, depends_on=["ct"]),
        TaskTemplate(key="lab", title="Kontrolní odběry: KO, biochemie, nádorové markery", kind="lab",
                     owner_role="coordinator", due_offset_days=13),
        TaskTemplate(key="histo", title="Výsledek histologie", kind="histology",
                     owner_role="pathology", due_offset_days=17, depends_on=["eus"]),
        TaskTemplate(key="mdt", title="MDT pro nádory GIT", kind="mdt", owner_role="coordinator",
                     due_offset_days=19, depends_on=["ct", "lab", "histo"]),
        TaskTemplate(key="pain", title="Algeziologie (KOC 1)", kind="consult",
                     owner_role="pain_clinic", due_offset_days=24),
        TaskTemplate(key="psych", title="Klinický psycholog", kind="consult",
                     owner_role="psycho_oncology", due_offset_days=25),
    ],
)

# Reports 01–07 come with the referral (the GP supplies everything for the initial handover, Q-F6);
# the KOC arranges the rest.
DONE_BY_MDT = {"ct", "eus", "lab", "histo"}


def load_directory(repo: CaseRepository) -> None:
    """Organisations, actors and MDT boards from the demo directory (Q-A5, D-12), and the starter
    task set (D-7), so every scenario can start it."""
    raw = json.loads(DIRECTORY.read_text(encoding="utf-8"))
    for organization in TypeAdapter(list[Organization]).validate_python(raw["organizations"]):
        repo.save_organization(organization)
    for actor in TypeAdapter(list[Actor]).validate_python(raw["actors"]):
        repo.save_actor(actor)
    for board in TypeAdapter(list[MdtBoard]).validate_python(raw["mdt_boards"]):
        repo.save_mdt_board(board)
    seed_task_sets(repo)


def seed_task_sets(repo: CaseRepository) -> None:
    """The starter task set as user data (Q-F2); a set coordinators edited keeps their edits."""
    if repo.get_task_set(PANCREAS_TASK_SET.id) is None:
        repo.save_task_set(PANCREAS_TASK_SET)


def apply_scenario(repo: CaseRepository, clock: AppClock, scenario: DemoScenario) -> None:
    """Reset all data to `scenario` and move the app clock to where it starts."""
    repo.clear()
    load_directory(repo)
    if scenario is DemoScenario.REFERENCE_AT_MDT:
        seed_reference_case(repo)
    clock.set(SCENARIO_CLOCK[scenario])


def seed_reference_case(repo: CaseRepository) -> None:
    manifest = TypeAdapter(list[DocumentMeta]).validate_json((REF / "manifest.json").read_bytes())
    handover = Handover.model_validate_json((REF / "expected_handover.json").read_bytes())
    findings = TypeAdapter(list[Finding]).validate_json((REF / "expected_findings.json").read_bytes())

    created = datetime(2026, 10, 2, 14, 0)
    case = Case(
        id=CASE_ID,
        patient_name="Alena Procházková",
        diagnosis_label="C25.0 Duktální adenokarcinom hlavy pankreatu",
        koc_id="koc2-lipova",
        mdt_board_id="mdt-git-lipova",
        referring_doctor_id="pl-reznicek",
        coordinator_id="koordinator",
        state=CaseState.READY_FOR_MDT,
        priority=Priority.HIGH,  # the GP asked for urgent handling (07)
        mdt_date=date(2026, 10, 21),
        created_at=created,
        milestones=Milestones(symptom_onset=date(2026, 8, 15), referred_at=created),
    )
    # Owners are directory ids (data/demo/directory.json): people or organisations.
    owners = {
        "coordinator": "koordinator",
        "imaging_site": "koc1-severni",
        "pathology": "pato-pokorny",
        "pain_clinic": "koc1-severni",
        "psycho_oncology": "psycholog-vesela",
    }
    outside_koc2 = {"koc1-severni"}
    tasks = start_task_set(case, PANCREAS_TASK_SET, owners, created)
    tasks = [
        t.model_copy(update={
            "status": TaskStatus.DONE if t.id.rsplit("-", 1)[-1] in DONE_BY_MDT else TaskStatus.PLANNED,
            "external": t.owner in outside_koc2,
        })
        for t in tasks
    ]
    step = next_step(tasks)
    case = case.model_copy(update={
        "queue": queue_column(case),
        "next_step": step.title if step else None,
        "on_move": step.owner if step else None,
        "next_due": step.due if step else None,
    })

    repo.save_case(case)
    for meta in manifest:
        if meta.received_at and meta.received_at.date() > case.mdt_date:
            continue  # post-MDT reports arrive later in the demo
        text = (REPORTS / (Path(meta.filename).stem + ".md")).read_text(encoding="utf-8")
        repo.save_document(meta.model_copy(update={"case_id": CASE_ID}), b"", text)
    repo.save_handover(handover)
    repo.save_findings(CASE_ID, findings)
    for t in tasks:
        repo.save_task(t)
