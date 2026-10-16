"""Bench scoring on the reference data itself: the expected output must score perfectly."""

from __future__ import annotations

from pathlib import Path

import pytest
from onko_bench.adapters.files import load_case
from onko_bench.service import (
    score_evidence,
    score_examinations,
    score_fields,
    score_findings,
    score_labs,
    score_metadata,
    similar,
)
from onko_contracts import FieldStatus, Sourced

ROOT = Path(__file__).resolve().parents[3]
CASES = [ROOT / "data/vzp-structured", ROOT / "data/reference-2"]


@pytest.fixture(params=CASES, ids=lambda p: p.name)
def case(request):
    return load_case(request.param)


def test_snapshot_excludes_documents_received_after_the_mdt(case):
    assert all(m.received_at.date() <= case.as_of for m, _ in case.documents)
    assert not any(t.startswith("<!--") for _, t in case.documents)


def test_expected_output_scores_perfectly(case):
    h, f = case.expected_handover, case.expected_findings
    texts = {m.id: t for m, t in case.documents}
    assert score_metadata([m for m, _ in case.documents], [m for m, _ in case.documents]).rate == 1
    assert score_fields(h, h).rate == 1
    assert score_examinations(h, h).rate == 1
    assert score_labs(h, h).rate == 1
    assert score_evidence(h, f, texts).rate == 1
    recall, false_pos, extra = score_findings(f, f)
    assert recall.rate == 1 and not false_pos
    assert all(
        e.split(":")[0]
        in {x.id for x in f if x.fields[0].startswith(("referring_doctor.", "mdt_record."))}
        for e in extra
    )


def test_a_wrong_value_and_a_missing_finding_are_counted(case):
    h = case.expected_handover
    wrong = h.model_copy(
        update={"height_cm": Sourced[float](value=None, status=FieldStatus.MISSING)}
    )
    fields = score_fields(h, wrong)
    assert fields.total - fields.hits == (1 if h.height_cm.status is FieldStatus.FOUND else 0)

    open_expected = [x for x in case.expected_findings if not x.resolved]
    recall, _, _ = score_findings(case.expected_findings, open_expected[1:])
    assert recall.hits == recall.total - 1


def test_reopened_resolved_finding_is_a_false_positive():
    case = load_case(CASES[0])
    reopened = [
        f.model_copy(update={"resolved": False, "resolution": None}) if f.resolved else f
        for f in case.expected_findings
    ]
    _, false_pos, _ = score_findings(case.expected_findings, reopened)
    assert false_pos


def test_similar_is_token_f1():
    assert similar("Duktální adenokarcinom pankreatu", "duktalni adenokarcinom hlavy pankreatu")
    assert not similar("adenokarcinom rekta", "tumor plic")
