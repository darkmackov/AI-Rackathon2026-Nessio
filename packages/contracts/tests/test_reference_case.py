"""The VZP reference case must conform to the contracts and quote its sources verbatim."""

from __future__ import annotations

import json
import re
from datetime import date
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
REF = ROOT / "data" / "vzp-structured" / "reference"
REPORTS = ROOT / "data" / "vzp-structured" / "reports"
MDT_DATE = date(2026, 10, 21)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


@pytest.fixture(scope="module")
def manifest() -> list[DocumentMeta]:
    raw = (REF / "manifest.json").read_text(encoding="utf-8")
    return TypeAdapter(list[DocumentMeta]).validate_json(raw)


@pytest.fixture(scope="module")
def handover() -> Handover:
    return Handover.model_validate_json((REF / "expected_handover.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def findings() -> list[Finding]:
    raw = (REF / "expected_findings.json").read_text(encoding="utf-8")
    return TypeAdapter(list[Finding]).validate_json(raw)


@pytest.fixture(scope="module")
def report_text(manifest: list[DocumentMeta]) -> dict[str, str]:
    return {
        m.id: _norm((REPORTS / (Path(m.filename).stem + ".md")).read_text(encoding="utf-8"))
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


def test_manifest_covers_all_reports(manifest):
    assert [m.id for m in manifest] == [f"{i:02d}" for i in range(1, 14)]


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
        assert received[ev.document_id] <= MDT_DATE, f"post-MDT source {ev.document_id}"


def test_known_gaps_are_flagged(handover, findings):
    assert handover.performance_status.status is FieldStatus.MISSING
    assert handover.contacts.patient_email.status is FieldStatus.MISSING
    flagged = {field for f in findings for field in f.fields}
    assert {"performance_status", "contacts.patient_email", "diagnosis_code"} <= flagged
    assert all(f.overridable for f in findings if f.severity == "blocker")
    assert [f.id for f in findings if f.advisory] == ["F06"]


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
