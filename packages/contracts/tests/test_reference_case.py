"""Both reference cases must conform to the contracts and quote their sources verbatim."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import pytest
from onko_contracts import (
    ALLOWED_TRANSITIONS,
    CaseState,
    DocumentMeta,
    Evidence,
    FieldStatus,
    Finding,
    Handover,
)
from pydantic import TypeAdapter

ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class RefCase:
    """One reference folder plus the gaps its expected files must flag."""

    folder: Path
    documents: int
    statuses: dict[str, FieldStatus]  # handover path -> expected status
    flagged: frozenset[str]  # fields some finding must name
    advisory: tuple[str, ...]  # ids of the advisory findings

    @property
    def ref(self) -> Path:
        return self.folder / "reference"

    @property
    def reports(self) -> Path:
        return self.folder / "reports"


CASES = {
    "vzp": RefCase(
        folder=ROOT / "data" / "vzp-structured",
        documents=13,
        statuses={
            "performance_status": FieldStatus.MISSING,
            "contacts.patient_email": FieldStatus.MISSING,
        },
        flagged=frozenset({"performance_status", "contacts.patient_email", "diagnosis_code"}),
        advisory=("F06",),
    ),
    "reference-2": RefCase(
        folder=ROOT / "data" / "reference-2",
        documents=10,
        statuses={
            "performance_status": FieldStatus.FOUND,
            "height_cm": FieldStatus.MISSING,
            "allergies": FieldStatus.CONFLICT,
            "patient.birth_date": FieldStatus.FOUND,
        },
        flagged=frozenset({"height_cm", "allergies", "patient.birth_date", "histology"}),
        advisory=("F08",),
    ),
}


@pytest.fixture(scope="module", params=list(CASES), ids=list(CASES))
def case(request) -> RefCase:
    return CASES[request.param]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


@pytest.fixture(scope="module")
def manifest(case: RefCase) -> list[DocumentMeta]:
    raw = (case.ref / "manifest.json").read_text(encoding="utf-8")
    return TypeAdapter(list[DocumentMeta]).validate_json(raw)


@pytest.fixture(scope="module")
def handover(case: RefCase) -> Handover:
    raw = (case.ref / "expected_handover.json").read_text(encoding="utf-8")
    return Handover.model_validate_json(raw)


@pytest.fixture(scope="module")
def findings(case: RefCase) -> list[Finding]:
    raw = (case.ref / "expected_findings.json").read_text(encoding="utf-8")
    return TypeAdapter(list[Finding]).validate_json(raw)


@pytest.fixture(scope="module")
def report_text(case: RefCase, manifest: list[DocumentMeta]) -> dict[str, str]:
    return {
        m.id: _norm((case.reports / (Path(m.filename).stem + ".md")).read_text(encoding="utf-8"))
        for m in manifest
    }


def _all_evidence(obj) -> list[Evidence]:
    found: list[Evidence] = []
    if isinstance(obj, Evidence):
        return [obj]
    if isinstance(obj, list):
        for item in obj:
            found += _all_evidence(item)
    elif hasattr(obj, "__pydantic_fields__"):
        for name in type(obj).model_fields:
            found += _all_evidence(getattr(obj, name))
    return found


def test_manifest_covers_all_reports(case, manifest):
    assert [m.id for m in manifest] == [f"{i:02d}" for i in range(1, case.documents + 1)]
    assert sorted(Path(m.filename).stem for m in manifest) == sorted(
        p.stem for p in case.reports.glob("*.md")
    )


def test_evidence_quotes_are_verbatim(handover, findings, report_text):
    evidence = _all_evidence(handover) + [e for f in findings for e in f.evidence]
    assert evidence
    for ev in evidence:
        assert _norm(ev.quote) in report_text[ev.document_id], f"{ev.document_id}: {ev.quote!r}"


def test_verbatim_text_fields(handover, report_text):
    """Full-text fields are copied, never paraphrased (Q-C8, Q-F15)."""
    for exam in handover.examinations:
        source = exam.evidence[0].document_id
        assert _norm(exam.result_full_text) in report_text[source], f"{source}: {exam.type}"
    epi = handover.epicrisis_source
    assert _norm(epi.value) in report_text[epi.evidence[0].document_id]


def test_handover_uses_only_documents_known_at_mdt(handover, manifest):
    received = {m.id: m.received_at.date() for m in manifest}
    for ev in _all_evidence(handover):
        assert received[ev.document_id] <= handover.as_of, f"post-MDT source {ev.document_id}"


def _field(handover: Handover, path: str):
    obj = handover
    for part in path.split("."):
        obj = getattr(obj, part)
    return obj


def test_known_gaps_are_flagged(case, handover, findings):
    for path, status in case.statuses.items():
        assert _field(handover, path).status is status, path
    flagged = {field for f in findings for field in f.fields}
    assert case.flagged <= flagged
    assert all(f.overridable for f in findings if f.severity == "blocker")
    assert tuple(f.id for f in findings if f.advisory) == case.advisory
    assert len({f.id for f in findings}) == len(findings)


def test_conflicts_carry_every_side(handover):
    """A conflict keeps no value and shows each disagreeing source (Sourced, FieldStatus)."""
    for name in type(handover).model_fields:
        value = getattr(handover, name)
        if getattr(value, "status", None) is FieldStatus.CONFLICT:
            assert value.value is None, name
            assert len({e.document_id for e in value.evidence}) >= 2, name


def test_state_machine_reaches_closed():
    path = [
        CaseState.DRAFT,
        CaseState.SENT,
        CaseState.TRIAGE,
        CaseState.WAITING_FOR_DOCUMENTS,
        CaseState.COMPLETE,
        CaseState.READY_FOR_MDT,
        CaseState.MDT_CONCLUSION,
        CaseState.FEEDBACK_SENT,
        CaseState.CLOSED,
    ]
    for a, b in pairwise(path):
        assert b in ALLOWED_TRANSITIONS[a]
    assert set(ALLOWED_TRANSITIONS) == set(CaseState)


def test_coordinator_can_return_the_referral_until_the_mdt_snapshot():
    returnable = {CaseState.TRIAGE, CaseState.WAITING_FOR_DOCUMENTS, CaseState.COMPLETE}
    for state in CaseState:
        assert (CaseState.RETURNED_TO_REFERRER in ALLOWED_TRANSITIONS[state]) is (state in returnable)
    assert ALLOWED_TRANSITIONS[CaseState.RETURNED_TO_REFERRER] == {CaseState.TRIAGE}


def test_handover_json_schema_exports():
    schema = Handover.model_json_schema()
    assert "performance_status" in schema["properties"]
    json.dumps(schema)
