"""The `CaseRepository` contract. Every adapter passes the same tests (PER-3).

The IRIS variant runs only with `ONKO_TEST_IRIS=1` and an IRIS configured in `.env`. It writes to its
own throwaway SQL schema (`test_<user>_<random>`), dropped afterwards, so the shared namespace keeps
clean demo data (Q-I3, PER-10).
"""

from __future__ import annotations

import getpass
import os
import re
import uuid
from datetime import date, datetime

import pytest
from onko_contracts import (
    Case,
    CaseState,
    DocumentMeta,
    Evidence,
    FieldStatus,
    Finding,
    FindingKind,
    Handover,
    Message,
    MessageKind,
    Receipt,
    Severity,
    Sourced,
    Task,
    TaskStatus,
)
from onko_repository import InMemoryRepository, IrisRepository, IrisSettings

NOW = datetime(2026, 10, 16, 9, 30)


def _iris_repo() -> IrisRepository:
    if os.environ.get("ONKO_TEST_IRIS") != "1":
        pytest.skip("set ONKO_TEST_IRIS=1 to run the contract against IRIS")
    settings = IrisSettings()
    if not settings.iris_configured:
        pytest.skip("ONKO_IRIS_CONNECTION_STRING is not set")
    user = re.sub(r"[^a-z0-9]", "", getpass.getuser().lower()) or "dev"
    # No FHIR projection here: the contract is about app state. test_fhir.py covers the projection.
    return IrisRepository(settings.model_copy(update={"fhir_base_url": None}),
                          schema=f"test_{user}_{uuid.uuid4().hex[:8]}")


@pytest.fixture(params=["memory", "iris"])
def repo(request):
    if request.param == "memory":
        yield InMemoryRepository()
        return
    iris_repo = _iris_repo()
    try:
        yield iris_repo
    finally:
        iris_repo.drop_tables()
        iris_repo.close()


def _case(case_id: str = "c1", **update) -> Case:
    case = Case(id=case_id, patient_name="Jana Testová", koc_id="koc-a", referring_doctor_id="pl-a",
                created_at=NOW)
    return case.model_copy(update=update)


def test_case_round_trip_and_upsert(repo):
    repo.save_case(_case("c1"))
    repo.save_case(_case("c2"))
    repo.save_case(_case("c1", state=CaseState.TRIAGE, mdt_date=date(2026, 10, 21)))

    assert repo.get_case("c1").state is CaseState.TRIAGE
    assert repo.get_case("c1").mdt_date == date(2026, 10, 21)
    assert [c.id for c in repo.list_cases()] == ["c1", "c2"]  # updates keep their place


def test_unknown_case_raises_key_error(repo):
    with pytest.raises(KeyError):
        repo.get_case("nope")


def test_ids_are_case_sensitive(repo):
    repo.save_case(_case("abc"))
    with pytest.raises(KeyError):
        repo.get_case("ABC")


def test_documents_by_case_with_text(repo):
    long_text = "ZÁVĚR: " + "příliš žluťoučký kůň " * 5000  # beyond a short VARCHAR
    repo.save_document(DocumentMeta(id="d1", case_id="c1", filename="01.docx"), b"\x00\x01PK", long_text)
    repo.save_document(DocumentMeta(id="d2", case_id="c1", filename="02.docx"), b"", "druhá")
    repo.save_document(DocumentMeta(id="d3", case_id="c2", filename="03.docx"), b"", "jiný případ")
    repo.save_document(DocumentMeta(id="d1", case_id="c1", filename="01.docx", title="Opraveno"),
                       b"\x00\x01PK", long_text)

    docs = repo.list_documents("c1")
    assert [d.id for d in docs] == ["d1", "d2"]
    assert docs[0].title == "Opraveno"
    assert repo.document_text("d1") == long_text
    assert repo.document_text("d2") == "druhá"
    with pytest.raises(KeyError):
        repo.document_text("missing")


def test_live_handover_and_snapshot_are_separate(repo):
    assert repo.get_handover("c1") is None

    live = Handover(case_id="c1", as_of=date(2026, 10, 16))
    snapshot = live.model_copy(update={
        "as_of": date(2026, 10, 21),
        "diagnosis": Sourced[str](value="Karcinom", status=FieldStatus.FOUND,
                                  evidence=[Evidence(document_id="d1", quote="Karcinom")]),
    })
    repo.save_handover(live)
    repo.save_handover(snapshot, snapshot=True)
    repo.save_handover(live.model_copy(update={"as_of": date(2026, 10, 22)}))

    assert repo.get_handover("c1").as_of == date(2026, 10, 22)
    frozen = repo.get_handover("c1", snapshot=True)
    assert frozen == snapshot
    assert frozen.diagnosis.evidence[0].quote == "Karcinom"


def test_findings_are_replaced_per_case_in_order(repo):
    def finding(fid: str) -> Finding:
        return Finding(id=fid, kind=FindingKind.MISSING, severity=Severity.WARNING, message_cs=fid)

    repo.save_findings("c1", [finding("F02"), finding("F01")])
    repo.save_findings("c2", [finding("F01")])
    repo.save_findings("c1", [finding("F03"), finding("F01")])

    assert [f.id for f in repo.list_findings("c1")] == ["F03", "F01"]
    assert [f.id for f in repo.list_findings("c2")] == ["F01"]
    assert repo.list_findings("c3") == []


def test_tasks_by_case_and_update(repo):
    repo.save_task(Task(id="t1", case_id="c1", title="CT", kind="imaging", owner="koc", due=NOW))
    repo.save_task(Task(id="t2", case_id="c1", title="EUS", kind="biopsy", owner="k", depends_on=["t1"]))
    repo.save_task(Task(id="t3", case_id="c2", title="Lab", kind="lab", owner="k"))
    repo.save_task(Task(id="t1", case_id="c1", title="CT", kind="imaging", owner="koc", due=NOW,
                        status=TaskStatus.DONE))

    tasks = repo.list_tasks("c1")
    assert [t.id for t in tasks] == ["t1", "t2"]
    assert tasks[0].status is TaskStatus.DONE
    assert tasks[0].due == NOW
    assert tasks[1].depends_on == ["t1"]


def test_messages_and_receipts(repo):
    message = Message(id="m1", case_id="c1", kind=MessageKind.MDT_RESULT, sender_id="k",
                      recipient_ids=["pl-a"], subject="Závěr MDT", body="…", sent_at=NOW)
    repo.save_message(message)
    repo.save_message(Message(id="m2", case_id="c2", kind=MessageKind.NOTIFICATION, sender_id="k",
                              recipient_ids=["k"], subject="Termín", body="…"))
    repo.save_receipt(Receipt(message_id="m1", recipient_id="pl-a", confirmed_at=NOW))

    assert repo.list_messages("c1") == [message]
    assert [m.id for m in repo.list_messages("c2")] == ["m2"]
