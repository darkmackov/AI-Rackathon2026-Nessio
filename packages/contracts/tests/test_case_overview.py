"""CaseOverview (S10) holds the existing models whole and round-trips through JSON."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from onko_contracts import Case, CaseOverview, Finding, Task, TimeToTreatment
from pydantic import TypeAdapter

REF = Path(__file__).resolve().parents[3] / "data" / "vzp-structured" / "reference"
NOW = datetime(2026, 10, 21, 9, 0)


def test_case_overview_round_trips_with_the_reference_findings():
    findings = TypeAdapter(list[Finding]).validate_json(
        (REF / "expected_findings.json").read_text(encoding="utf-8")
    )
    overview = CaseOverview(
        case=Case(id="c1", patient_name="Test", koc_id="koc", referring_doctor_id="gp", created_at=NOW),
        time_to_treatment=TimeToTreatment(t1=10),
        findings=findings,
        open_tasks=[Task(id="t1", case_id="c1", title="MDT", kind="mdt", owner="koc", due=NOW)],
    )
    assert CaseOverview.model_validate_json(overview.model_dump_json()) == overview


def test_case_overview_lists_default_to_empty():
    overview = CaseOverview(
        case=Case(id="c1", patient_name="Test", koc_id="koc", referring_doctor_id="gp", created_at=NOW),
        time_to_treatment=TimeToTreatment(),
    )
    assert overview.findings == [] and overview.open_tasks == []
