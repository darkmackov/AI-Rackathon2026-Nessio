"""S5 draft contracts: a draft job carries its result typed, exactly the part of its kind."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from onko_contracts import (
    ConclusionPrefill,
    DraftKind,
    DraftResult,
    Job,
    JobKind,
    JobStatus,
    MdtResultRow,
)
from pydantic import ValidationError

ROW = MdtResultRow(date=date(2026, 10, 8), examination="CT", result="Ložisko 35 mm")
PREFILL = ConclusionPrefill(diagnosis_code="C25.0", date=date(2026, 10, 21), place="Praha 4",
                            copy_to=["MUDr. Řezníček"])


@pytest.mark.parametrize("draft", [
    DraftResult(kind=DraftKind.EPICRISIS_SUMMARY, text="Souhrn."),
    DraftResult(kind=DraftKind.MDT_QUESTION, text="Otázka?"),
    DraftResult(kind=DraftKind.MDT_RESULTS, rows=[ROW]),
    DraftResult(kind=DraftKind.MDT_RESULTS),  # a record without results
    DraftResult(kind=DraftKind.MDT_CONCLUSION, fields=PREFILL),
])
def test_draft_job_round_trips_with_its_result(draft):
    job = Job(id="job-1", kind=JobKind.DRAFT, case_id="c1", params={"kind": draft.kind.value},
              status=JobStatus.DONE, created_at=datetime(2026, 10, 21, 9, 0), draft=draft)
    assert Job.model_validate_json(job.model_dump_json()) == job


@pytest.mark.parametrize("parts", [
    {"kind": DraftKind.EPICRISIS_SUMMARY},  # text missing
    {"kind": DraftKind.MDT_QUESTION, "text": "Otázka?", "rows": [ROW]},
    {"kind": DraftKind.MDT_RESULTS, "text": "řádky"},
    {"kind": DraftKind.MDT_CONCLUSION},  # fields missing
    {"kind": DraftKind.MDT_CONCLUSION, "fields": PREFILL, "text": "Závěr MDT"},  # never the decision
    {"kind": DraftKind.EPICRISIS_SUMMARY, "text": "Souhrn.", "fields": PREFILL},
])
def test_a_draft_carries_exactly_the_part_of_its_kind(parts):
    with pytest.raises(ValidationError):
        DraftResult(**parts)


def test_prefill_has_no_decision_fields():
    assert set(ConclusionPrefill.model_fields) == {"diagnosis_name", "diagnosis_code", "date", "place",
                                                   "copy_to"}
