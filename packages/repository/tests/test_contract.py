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
from datetime import date, datetime, timedelta

import pytest
from onko_contracts import (
    Actor,
    AuditEvent,
    Case,
    CaseState,
    CodeCandidate,
    DocChunk,
    DocumentMeta,
    Evidence,
    FieldStatus,
    Finding,
    FindingKind,
    Handover,
    Job,
    JobKind,
    JobStatus,
    MdtBoard,
    MdtConclusion,
    MdtMember,
    Message,
    MessageKind,
    Organization,
    OrganizationKind,
    Receipt,
    Severity,
    Sourced,
    Stamp,
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
    # 3-dimensional embeddings, like the vectors these tests save.
    return IrisRepository(settings.model_copy(update={"fhir_base_url": None, "embed_dim": 3}),
                          schema=f"test_{user}_{uuid.uuid4().hex[:8]}")


@pytest.fixture(scope="module")
def shared_iris():
    """One schema and connection for the whole module: creating tables over the remote link is
    the slow part, so each test starts from `clear()` instead (TEST-6)."""
    iris_repo = _iris_repo()
    try:
        yield iris_repo
    finally:
        iris_repo.drop_tables()
        iris_repo.close()


@pytest.fixture(params=["memory", "iris"])
def repo(request):
    if request.param == "memory":
        return InMemoryRepository()
    iris_repo = request.getfixturevalue("shared_iris")
    iris_repo.clear()
    return iris_repo


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


def test_single_document_and_its_bytes(repo):
    meta = DocumentMeta(id="doc-0a1b2c3d", case_id="c1", filename="01.docx")
    repo.save_document(meta, b"\x00\x01PK\xff", "text")

    assert repo.get_document("doc-0a1b2c3d") == meta
    assert repo.document_data("doc-0a1b2c3d") == b"\x00\x01PK\xff"
    assert repo.get_document("missing") is None
    assert repo.document_data("missing") is None


def test_update_document_replaces_meta_and_keeps_content(repo):
    meta = DocumentMeta(id="d1", case_id="c1", filename="01.docx")
    repo.save_document(meta, b"\x00\x01PK", "původní text")
    updated = meta.model_copy(update={"title": "CT hrudníku", "document_date": date(2026, 10, 1)})

    repo.update_document(updated)

    assert repo.get_document("d1") == updated
    assert repo.list_documents("c1") == [updated]
    assert repo.document_data("d1") == b"\x00\x01PK"
    assert repo.document_text("d1") == "původní text"
    with pytest.raises(KeyError):
        repo.update_document(DocumentMeta(id="missing", case_id="c1", filename="x.docx"))


def _job(job_id: str, case_id: str = "c1", minutes: int = 0, **update) -> Job:
    job = Job(id=job_id, kind=JobKind.INGEST_DOCUMENT, case_id=case_id, document_id="d1",
              created_at=NOW + timedelta(minutes=minutes))
    return job.model_copy(update=update)


def test_job_round_trip_and_upsert(repo):
    queued = _job("job-0a1b2c3d", params={"lang": "cs"})
    repo.save_job(queued)
    assert repo.get_job("job-0a1b2c3d") == queued
    assert repo.get_job("missing") is None

    done = queued.model_copy(update={
        "status": JobStatus.DONE, "started_at": NOW, "finished_at": NOW + timedelta(seconds=5),
        "result": {"fields": 3},
    })
    repo.save_job(done)
    assert repo.get_job("job-0a1b2c3d") == done
    assert repo.list_jobs("c1") == [done]


def test_jobs_by_case_ordered_by_created_at(repo):
    repo.save_job(_job("job-late", minutes=10))
    repo.save_job(_job("job-early", minutes=0))
    repo.save_job(_job("job-other", case_id="c2", minutes=5))
    repo.save_job(_job("job-mid", minutes=5, status=JobStatus.FAILED, error="timeout"))

    assert [j.id for j in repo.list_jobs("c1")] == ["job-early", "job-mid", "job-late"]
    assert [j.id for j in repo.list_jobs("c2")] == ["job-other"]
    assert repo.list_jobs("c3") == []


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


def test_directory_round_trip_and_upsert(repo):
    org = Organization(id="koc-a", name="KOC A", kind=OrganizationKind.KOC,
                       identifiers={"icp": "72045318"})
    gp = Actor(id="pl-a", name="MUDr. A", role="referring_doctor", organization_id="pl-praxe")
    coordinator = Actor(id="koord-a", name="Koordinátor A", role="coordinator",
                        organization_id="koc-a")
    board = MdtBoard(id="mdt-a", name="MDT A", organization_id="koc-a",
                     members=[MdtMember(name="MUDr. Člen", specialty="onkologie", actor_id="koord-a")])
    repo.save_organization(org)
    repo.save_actor(gp)
    repo.save_actor(coordinator)
    repo.save_mdt_board(board)
    repo.save_mdt_board(board.model_copy(update={"name": "MDT A2"}))

    assert repo.list_organizations() == [org]
    assert repo.get_actor("koord-a") == coordinator
    assert [a.id for a in repo.list_actors()] == ["pl-a", "koord-a"]
    assert repo.get_mdt_board("mdt-a").name == "MDT A2"
    assert repo.get_mdt_board("mdt-a").members == board.members
    assert [b.id for b in repo.list_mdt_boards()] == ["mdt-a"]


@pytest.mark.parametrize("getter", ["get_actor", "get_mdt_board"])
def test_unknown_directory_entry_raises_key_error(repo, getter):
    with pytest.raises(KeyError):
        getattr(repo, getter)("nope")


def test_clear_removes_everything(repo):
    repo.save_organization(Organization(id="koc-a", name="KOC A", kind=OrganizationKind.KOC))
    repo.save_actor(Actor(id="pl-a", name="MUDr. A", role="referring_doctor"))
    repo.save_mdt_board(MdtBoard(id="mdt-a", name="MDT A", organization_id="koc-a"))
    repo.save_case(_case("c1"))
    repo.save_document(DocumentMeta(id="d1", case_id="c1", filename="01.docx"), b"", "text")
    repo.save_handover(Handover(case_id="c1", as_of=date(2026, 10, 16)))
    repo.save_job(_job("job-1"))
    repo.save_audit(_audit("a1"))
    repo.save_mdt_conclusion(MdtConclusion(case_id="c1", conclusion="Chemoterapie"))

    repo.clear()

    assert repo.list_organizations() == []
    assert repo.list_actors() == []
    assert repo.list_mdt_boards() == []
    assert repo.list_cases() == []
    assert repo.list_documents("c1") == []
    assert repo.get_handover("c1") is None
    assert repo.list_jobs("c1") == []
    assert repo.list_audit("c1") == []
    assert repo.get_mdt_conclusion("c1") is None


def _audit(event_id: str, case_id: str = "c1", minutes: int = 0) -> AuditEvent:
    return AuditEvent(id=event_id, case_id=case_id, at=NOW + timedelta(minutes=minutes),
                      actor_id="koord-a", action="transition", detail="odeslano -> v_triage")


def test_audit_is_listed_per_case_oldest_first(repo):
    repo.save_case(_case("c1"))
    repo.save_case(_case("c2"))
    repo.save_audit(_audit("a-late", minutes=10))
    repo.save_audit(_audit("a-early"))
    repo.save_audit(_audit("a-other", case_id="c2"))

    assert [e.id for e in repo.list_audit("c1")] == ["a-early", "a-late"]
    assert repo.list_audit("c1")[0] == _audit("a-early")
    assert [e.id for e in repo.list_audit("c2")] == ["a-other"]


def test_audit_is_append_only(repo):
    repo.save_case(_case("c1"))
    repo.save_audit(_audit("a1"))
    with pytest.raises(ValueError):
        repo.save_audit(_audit("a1").model_copy(update={"detail": "přepsáno"}))
    assert repo.list_audit("c1") == [_audit("a1")]


@pytest.mark.parametrize("save", [
    lambda repo: repo.save_audit(_audit("a1", case_id="nope")),
    lambda repo: repo.save_mdt_conclusion(MdtConclusion(case_id="nope")),
])
def test_audit_and_conclusion_need_an_existing_case(repo, save):
    with pytest.raises(KeyError):
        save(repo)


def test_mdt_conclusion_round_trip_and_replace(repo):
    repo.save_case(_case("c1"))
    assert repo.get_mdt_conclusion("c1") is None

    draft = MdtConclusion(case_id="c1", diagnosis_code="C25.0", recommendations=["CT", "Chemo"])
    repo.save_mdt_conclusion(draft)
    assert repo.get_mdt_conclusion("c1") == draft

    confirmed = draft.model_copy(update={"confirmed": Stamp(by="koord-a", at=NOW)})
    repo.save_mdt_conclusion(confirmed)
    assert repo.get_mdt_conclusion("c1") == confirmed


def test_no_pending_fhir_writes_without_a_fhir_server(repo):
    repo.save_case(_case("c1"))
    repo.save_task(Task(id="t1", case_id="c1", title="CT", kind="imaging", owner="koc"))
    assert repo.pending_fhir_writes() == 0


# --- vector search (S8, Q-I19) ---------------------------------------------------------------


def _chunk(document_id: str, case_id: str, ord_: int, text: str) -> DocChunk:
    return DocChunk(id=f"{document_id}-{ord_}", document_id=document_id, case_id=case_id, ord=ord_,
                    start=ord_ * 100, end=ord_ * 100 + len(text), text=text)


def _save_cases(repo, *case_ids: str) -> None:
    for case_id in case_ids:
        repo.save_case(_case(case_id))


def _chunked_cases(repo) -> None:
    _save_cases(repo, "c1", "c2")
    for doc, case in (("d1", "c1"), ("d2", "c1"), ("d3", "c2")):
        repo.save_document(DocumentMeta(id=doc, case_id=case, filename=f"{doc}.docx"), b"", "text")
    repo.save_chunks("d1", [_chunk("d1", "c1", 0, "ECOG 1"), _chunk("d1", "c1", 1, "CT hrudníku")],
                     [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
    repo.save_chunks("d2", [_chunk("d2", "c1", 0, "Histologie")], [[0.6, 0.0, 0.8]])
    repo.save_chunks("d3", [_chunk("d3", "c2", 0, "jiný pacient")], [[1.0, 0.0, 0.0]])


def test_nearest_chunks_rank_by_cosine_within_the_case(repo):
    _chunked_cases(repo)

    nearest = repo.nearest_chunks("c1", [0.9, 0.1, 0.0], 2)

    assert [c.id for c in nearest] == ["d1-0", "d2-0"]
    assert nearest[0] == _chunk("d1", "c1", 0, "ECOG 1")
    assert [c.id for c in repo.nearest_chunks("c1", [0.9, 0.1, 0.0], 5, document_id="d2")] == ["d2-0"]
    assert repo.nearest_chunks("c3", [1.0, 0.0, 0.0], 5) == []


def test_saving_chunks_replaces_the_documents_chunks(repo):
    _chunked_cases(repo)
    repo.save_chunks("d1", [_chunk("d1", "c1", 0, "nový text")], [[0.0, 0.0, 1.0]])

    assert [c.id for c in repo.list_chunks("c1")] == ["d1-0", "d2-0"]
    assert repo.list_chunks("c1")[0].text == "nový text"


def test_chunks_need_their_document(repo):
    _save_cases(repo, "c1")
    with pytest.raises(KeyError):
        repo.save_chunks("nope", [_chunk("nope", "c1", 0, "x")], [[1.0, 0.0, 0.0]])
    repo.save_document(DocumentMeta(id="d1", case_id="c1", filename="d1.docx"), b"", "text")
    with pytest.raises(ValueError):
        repo.save_chunks("d1", [_chunk("d2", "c1", 0, "x")], [[1.0, 0.0, 0.0]])
    with pytest.raises(ValueError):
        repo.save_chunks("d1", [_chunk("d1", "c1", 0, "x")], [])


def test_codes_rank_by_cosine_and_survive_the_demo_reset(repo):
    codes = [CodeCandidate(code="C25.0", title_cs="Zhoubný novotvar hlavy slinivky břišní"),
             CodeCandidate(code="C34.1", title_cs="Zhoubný novotvar horního laloku plic"),
             CodeCandidate(code="J18.9", title_cs="Pneumonie, neurčená")]
    repo.save_codes(codes, [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.7, 0.7]])
    repo.clear()

    assert repo.count_codes() == 3
    assert repo.nearest_codes([0.1, 1.0, 0.0], 2) == [codes[1], codes[2]]
    repo.save_codes(codes[:1], [[1.0, 0.0, 0.0]])
    assert repo.count_codes() == 1
