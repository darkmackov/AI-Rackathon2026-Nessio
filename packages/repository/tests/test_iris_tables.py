"""Model <-> row mapping of the generated IRIS tables (no IRIS needed)."""

from __future__ import annotations

from datetime import date, datetime

from onko_contracts import (
    Case,
    Evidence,
    Finding,
    FindingKind,
    MdtMember,
    MdtRecord,
    MdtResultRow,
    Milestones,
    OnHold,
    Resolution,
    ResolutionKind,
    Severity,
    Stamp,
    Task,
)
from onko_repository.adapters.iris_tables import ID, TEXT, ModelTable, _timestamp

NOW = datetime(2026, 10, 16, 9, 30)
CASES = ModelTable("app_case", Case, key=("id",))


def _round_trip(table: ModelTable, model):
    values = table.row(model)
    return table.model_from([values[name] for name in table.column_names])


def test_columns_are_typed_and_nested_models_flattened():
    types = CASES.column_types()
    assert types["id"] == ID
    assert types["created_at"] == "TIMESTAMP"
    assert types["mdt_date"] == "DATE"
    assert types["on_hold__present"] == "BIT"
    assert types["on_hold__reason"] == TEXT
    assert types["milestones__symptom_onset"] == "DATE"
    assert "milestones__present" not in types  # not optional


def test_case_round_trip_with_and_without_hold():
    case = Case(id="c1", patient_name="Jana", koc_id="koc", referring_doctor_id="pl", created_at=NOW,
                milestones=Milestones(symptom_onset=date(2026, 8, 15)))
    assert _round_trip(CASES, case) == case
    held = case.model_copy(update={"on_hold": OnHold(reason="Čeká", set_by="k", set_at=NOW)})
    assert _round_trip(CASES, held) == held
    row = CASES.row(held)
    assert row["state"] == "odeslano"
    assert row["on_hold__present"] == 1


def test_lists_and_optional_nested_models():
    findings = ModelTable("app_finding", Finding, key=("case_id", "id"), extra={"case_id": ID})
    finding = Finding(
        id="F01", kind=FindingKind.MISSING, severity=Severity.BLOCKER, message_cs="Chybí ECOG",
        fields=["performance_status"], evidence=[Evidence(document_id="07", quote="ECOG")],
        resolved=True, resolution=Resolution(kind=ResolutionKind.OVERRIDDEN, note="OK", by="k", at=NOW),
    )
    assert _round_trip(findings, finding) == finding
    assert findings.row(finding, case_id="c1")["case_id"] == "c1"

    tasks = ModelTable("app_task", Task, key=("id",))
    task = Task(id="t1", case_id="c1", title="CT", kind="imaging", owner="koc", depends_on=["t0"],
                external=True)
    assert _round_trip(tasks, task) == task


def test_mdt_record_round_trip():
    records = ModelTable("app_mdt_record", MdtRecord, key=("case_id",))
    record = MdtRecord(
        case_id="c1", mdt_date=date(2026, 10, 21), board_id="mdt-git",
        members=[MdtMember(name="MUDr. Hrubý", specialty="chirurgie")],
        patient_name="Jana Nováková", weight_kg=65.0, comorbidities=["hypertenze"],
        results=[MdtResultRow(date=date(2026, 10, 8), examination="CT", result="tumor 35 mm")],
        created=Stamp(by="k", at=NOW),
    )
    assert _round_trip(records, record) == record
    assert records.column_types()["mdt_date"] == "DATE"
    assert records.column_types()["members"] == TEXT


def test_column_added_later_falls_back_to_the_default():
    tasks = ModelTable("app_task", Task, key=("id",))
    task = Task(id="t1", case_id="c1", title="CT", kind="imaging", owner="koc", external=True)
    values = tasks.row(task)
    values["external"] = None  # an old row, written before the column existed
    assert tasks.model_from([values[n] for n in tasks.column_names]).external is False


def test_posix_time_from_an_ordered_query_reads_as_a_datetime():
    # What IRIS returns for 2026-10-16 09:30 when the query is ordered by that column.
    assert _timestamp("1154713647606846976") == datetime(2026, 10, 16, 9, 30)
    assert _timestamp(1154713647606846976) == datetime(2026, 10, 16, 9, 30)
    assert _timestamp("2026-10-16 09:30:00") == "2026-10-16 09:30:00"
