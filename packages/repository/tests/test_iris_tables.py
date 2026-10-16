"""Model <-> row mapping of the generated IRIS tables (no IRIS needed)."""

from __future__ import annotations

from datetime import date, datetime

from onko_contracts import (
    Case,
    Evidence,
    Finding,
    FindingKind,
    Milestones,
    OnHold,
    Resolution,
    ResolutionKind,
    Severity,
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


def test_vector_tables_carry_the_embedding_dimension_and_their_foreign_keys():
    from onko_contracts import DocChunk
    from onko_repository.adapters.iris import _vector, vector_tables

    chunks, codes = vector_tables(3)

    assert '"embedding" VECTOR(DOUBLE, 3)' in chunks.create_sql("onko.doc_chunk")
    assert '"embedding" VECTOR(DOUBLE, 3)' in codes.create_sql("onko.mkn10_code")
    assert 'PRIMARY KEY ("code")' in codes.create_sql("onko.mkn10_code")
    assert chunks.foreign_keys == {"case_id": "app_case", "document_id": "app_document"}
    assert chunks.indexes == ("case_id", "document_id")
    chunk = DocChunk(id="d1-0", document_id="d1", case_id="c1", ord=0, start=0, end=4, text="ECOG")
    row = chunks.row(chunk)
    assert chunks.model_from([row[n] for n in chunks.column_names]) == chunk
    assert _vector([1, 0.5, -2e-05]) == "1.0,0.5,-2e-05"
