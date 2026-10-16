"""Load the reference case into a repository so the UI has realistic data before the AI exists."""

from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path

from onko_cases import next_step, queue_column, start_task_set
from onko_contracts import (
    Case,
    CaseState,
    DocumentMeta,
    Finding,
    Handover,
    Milestones,
    Priority,
    TaskSet,
    TaskStatus,
    TaskTemplate,
)
from onko_repository import CaseRepository
from pydantic import TypeAdapter

DATA = Path(os.environ.get("ONKO_DATA_DIR", Path(__file__).resolve().parents[4] / "data"))
REF = DATA / "vzp-structured" / "reference"
REPORTS = DATA / "vzp-structured" / "reports"
CASE_ID = "vzp-prochazkova"

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
