"""S8 endpoints: 'ask the case' as a job, MKN-10 candidates and the pick. Offline: fake model with
bag-of-words embeddings, no threads, in-memory repository."""

from __future__ import annotations

from pathlib import Path

import pytest
from api_testkit import FakeGateway
from fastapi.testclient import TestClient
from onko_ai import load_codes
from onko_api.jobs import ImmediateExecutor
from onko_api.main import app
from onko_contracts import CaseState, CodeCandidate, Sourced

ROOT = Path(__file__).resolve().parents[3]
REFERRAL = ROOT / "data/cesta-pacienta-data/Pacient/07_PL_zadost_KOC2_2026-10-02.docx"
CASE = "vzp-prochazkova"
GP = {"X-Actor-Id": "pl-reznicek"}
KOORDINATOR = {"X-Actor-Id": "koordinator"}
CODES = [
    CodeCandidate(code="X01.0", title_cs="Zhoubný novotvar hlavy slinivky břišní"),
    CodeCandidate(code="X02.1", title_cs="Zhoubný novotvar horního laloku plic"),
    CodeCandidate(code="X03.9", title_cs="Zlomenina stehenní kosti"),
]


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.app.state.gateway = FakeGateway()
        c.app.state.jobs = ImmediateExecutor()
        yield c


def _ask(client, question="Jaké má pacient alergie?", case_id=CASE):
    return client.post(f"/cases/{case_id}/ask", json={"question": question}, headers=GP)


def _upload(client):
    files = {"file": ("07.docx", REFERRAL.read_bytes(), "application/octet-stream")}
    r = client.post(f"/cases/{CASE}/documents", files=files, headers=GP)
    assert client.get(f"/jobs/{r.json()['job']['id']}").json()["status"] == "done"
    return r.json()["document"]["id"]


def test_ask_the_case_returns_a_job_whose_answer_quotes_the_documents(client):
    doc_id = _upload(client)

    r = _ask(client)

    assert r.status_code == 202
    job = r.json()
    assert job["kind"] == "ask_case" and job["params"] == {"question": "Jaké má pacient alergie?"}
    done = client.get(f"/jobs/{job['id']}").json()
    assert done["status"] == "done", done["error"]
    answer = done["answer"]
    assert answer["found"] and answer["question"] == "Jaké má pacient alergie?"
    quote = next(q for q in answer["quotes"] if q["document_id"] == doc_id)
    text = client.get(f"/documents/{doc_id}/text").json()["text"]
    assert text[quote["start"]:quote["end"]] == quote["quote"] == "AA: neguje"


def test_an_answer_without_a_verbatim_quote_is_not_found(client):
    client.app.state.gateway = FakeGateway(answer_quote="AA: penicilin")
    _upload(client)

    done = client.get(f"/jobs/{_ask(client).json()['id']}").json()

    assert done["status"] == "done"
    assert done["answer"] == {"question": "Jaké má pacient alergie?", "found": False, "quotes": []}


def test_ask_the_case_fails_with_a_reason_without_an_embedding_model(client):
    client.app.state.gateway = FakeGateway(can_embed=False)

    done = client.get(f"/jobs/{_ask(client).json()['id']}").json()

    assert done["status"] == "failed" and "ONKO_EMBED_MODEL" in done["error"]
    assert done["answer"] is None


def test_ask_an_unknown_case_is_404(client):
    assert _ask(client, case_id="nope").status_code == 404


def test_ask_needs_a_question(client):
    assert client.post(f"/cases/{CASE}/ask", json={"question": ""}, headers=GP).status_code == 422


def _uncoded(client, state: CaseState = CaseState.TRIAGE) -> None:
    """The seeded case with its diagnosis code removed, in a state the coordinator may edit."""
    repo = client.app.state.repo
    handover = repo.get_handover(CASE)
    repo.save_handover(handover.model_copy(update={"diagnosis_code": Sourced()}))
    repo.save_case(repo.get_case(CASE).model_copy(update={"state": state}))
    load_codes(CODES, repo, client.app.state.gateway)


def test_code_candidates_for_a_diagnosis_without_a_code(client):
    _uncoded(client)

    r = client.get(f"/cases/{CASE}/handover/code-candidates")

    assert r.status_code == 200
    assert {c["code"] for c in r.json()} == {"X01.0", "X02.1", "X03.9"}
    assert r.json()[0]["code"] == "X01.0"  # the pancreas, as the seeded diagnosis says


def test_no_candidates_once_the_diagnosis_has_a_code(client):
    load_codes(CODES, client.app.state.repo, client.app.state.gateway)
    r = client.get(f"/cases/{CASE}/handover/code-candidates")
    assert r.status_code == 409 and "already has a code" in r.json()["detail"]


def test_no_candidates_without_an_embedding_model_or_a_code_list(client):
    _uncoded(client)
    client.app.state.gateway = FakeGateway(can_embed=False)
    assert client.get(f"/cases/{CASE}/handover/code-candidates").status_code == 409

    client.app.state.gateway = FakeGateway()
    client.app.state.repo.save_codes([], [])
    r = client.get(f"/cases/{CASE}/handover/code-candidates")
    assert r.status_code == 409 and "code list" in r.json()["detail"]


def test_the_picked_code_is_manual_and_the_ai_suggestion_is_audited(client):
    _uncoded(client)

    r = client.post(f"/cases/{CASE}/handover/diagnosis-code", json={"code": "X01.0"},
                    headers=KOORDINATOR)

    assert r.status_code == 200
    code = r.json()["diagnosis_code"]
    assert code["value"] == "X01.0" and code["origin"] == "manual"
    assert code["entered"]["by"] == "koordinator"
    assert client.get(f"/cases/{CASE}/handover").json()["diagnosis_code"]["value"] == "X01.0"
    [event] = [e for e in client.app.state.repo.list_audit(CASE)
               if e.action == "diagnosis_code_from_ai"]
    assert event.actor_id == "koordinator" and "X01.0" in event.detail


def test_only_a_suggested_code_can_be_picked(client):
    _uncoded(client)
    r = client.post(f"/cases/{CASE}/handover/diagnosis-code", json={"code": "Z99.9"},
                    headers=KOORDINATOR)
    assert r.status_code == 400


def test_the_pick_follows_who_may_edit_the_handover(client):
    _uncoded(client, CaseState.READY_FOR_MDT)
    r = client.post(f"/cases/{CASE}/handover/diagnosis-code", json={"code": "X01.0"},
                    headers=KOORDINATOR)
    assert r.status_code == 409
