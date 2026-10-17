"""S3 endpoints: the GP's referral from draft to the KOC's 'Nový' column, and the resend after a
return (D-15). Offline: fake model, no threads, the app clock from the `empty` scenario."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from api_testkit import ALLERGIES, FakeGateway, claim
from fastapi.testclient import TestClient
from onko_ai.models import FieldPath
from onko_api.jobs import ImmediateExecutor
from onko_api.main import app
from onko_contracts import CaseState, Message, MessageKind

ROOT = Path(__file__).resolve().parents[3]
REFERRAL = ROOT / "data/cesta-pacienta-data/Pacient/07_PL_zadost_KOC2_2026-10-02.docx"
KOC = "koc2-lipova"
GP = {"X-Actor-Id": "pl-reznicek"}
COORDINATOR = {"X-Actor-Id": "koordinator"}


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.app.state.gateway = FakeGateway([
            claim(FieldPath.FIRST_NAME, "Alena", "Alena Procházková"),
            claim(FieldPath.LAST_NAME, "Procházková", "Alena Procházková"),
            ALLERGIES,
        ])
        c.app.state.jobs = ImmediateExecutor()
        c.post("/demo/reset", json={"scenario": "empty"})
        yield c


def _create(client) -> str:
    r = client.post("/referrals", json={"koc_id": KOC}, headers=GP)
    assert r.status_code == 201
    return r.json()["id"]


def _koc_new(client) -> list[str]:
    return [c["id"] for c in client.get("/cases", params={"koc_id": KOC, "queue": "novy"}).json()]


def test_gp_referral_reaches_the_koc_new_column(client):
    case_id = _create(client)
    case = client.get(f"/cases/{case_id}").json()
    assert case["state"] == "koncept" and case["patient_name"] == ""
    assert client.get(f"/cases/{case_id}/handover").json()["validated_by_referrer"] is None
    assert case_id not in _koc_new(client)  # drafts stay with the GP

    files = {"file": ("07.docx", REFERRAL.read_bytes(), "application/octet-stream")}
    r = client.post(f"/cases/{case_id}/documents", files=files, headers=GP)
    assert r.status_code == 201
    assert client.get(f"/jobs/{r.json()['job']['id']}").json()["status"] == "done"
    assert client.get(f"/cases/{case_id}").json()["patient_name"] == "Alena Procházková"

    r = client.patch(f"/cases/{case_id}/handover", headers=GP,
                     json={"path": "performance_status", "not_available": True, "note": "nevím"})
    assert r.status_code == 200
    ecog = r.json()["performance_status"]
    assert ecog["status"] == "missing" and ecog["origin"] == "manual"
    assert ecog["entered"]["by"] == "pl-reznicek"

    r = client.post(f"/cases/{case_id}/handover/examinations", headers=GP, json={
        "date": "2026-09-30", "place": "Ordinace PL", "type": "UZ břicha",
        "result_full_text": "Ložisko v oblasti hlavy pankreatu.",
    })
    assert r.status_code == 201 and r.json()["examinations"][-1]["origin"] == "manual"

    assert client.post(f"/cases/{case_id}/send", headers=GP).status_code == 409  # not validated
    r = client.post(f"/cases/{case_id}/handover/validate", headers=GP)
    assert r.status_code == 200 and r.json()["validated_by_referrer"]["by"] == "pl-reznicek"

    r = client.post(f"/cases/{case_id}/send", headers=GP)
    assert r.status_code == 200
    sent = r.json()
    assert sent["state"] == "odeslano" and sent["queue"] == "novy"
    details = [(e["action"], e["detail"]) for e in client.get(f"/cases/{case_id}/audit").json()
               if e["action"] in ("handover_field_updated", "examination_added", "referral_sent")]
    assert details == [
        ("handover_field_updated", "Stav výkonnosti: není k dispozici"),
        ("examination_added", "30. 9. 2026 UZ břicha"),
        ("referral_sent", "Koncept → Odesláno"),
    ]
    assert sent["milestones"]["referred_at"].startswith("2026-10-02T08:00")  # the app clock runs
    assert case_id in _koc_new(client)

    # Sent: the GP can no longer edit it.
    r = client.patch(f"/cases/{case_id}/handover", headers=GP, json={"path": "allergies", "value": "PNC"})
    assert r.status_code == 409


def test_only_a_gp_refers_and_only_to_a_koc(client):
    assert client.post("/referrals", json={"koc_id": KOC}, headers=COORDINATOR).status_code == 403
    assert client.post("/referrals", json={"koc_id": "nope"}, headers=GP).status_code == 400


def test_handover_edits_are_checked(client):
    case_id = _create(client)
    url = f"/cases/{case_id}/handover"
    assert client.patch(url, headers=GP, json={"path": "nope", "value": "x"}).status_code == 400
    assert client.patch(url, headers=GP, json={"path": "weight_kg", "value": "hodně"}).status_code == 422
    # The coordinator edits only after triage; nobody edits an unknown case.
    assert client.patch(url, headers=COORDINATOR, json={"path": "allergies", "value": "x"}).status_code == 409
    assert client.patch("/cases/nope/handover", headers=GP, json={"path": "allergies", "value": "x"}).status_code == 404
    assert client.post(f"/cases/{case_id}/handover/validate", headers=COORDINATOR).status_code == 403


def test_returned_referral_is_revalidated_and_goes_back_to_triage(client):
    case_id = _create(client)
    client.post(f"/cases/{case_id}/handover/validate", headers=GP)
    repo = client.app.state.repo
    # What S4's returnCase leaves behind: the state and the coordinator's note to the GP.
    case = repo.get_case(case_id).model_copy(
        update={"state": CaseState.RETURNED_TO_REFERRER, "coordinator_id": "koordinator"}
    )
    repo.save_case(case)
    repo.save_message(Message(
        id="msg-1", case_id=case_id, kind=MessageKind.CASE_RETURNED, sender_id="koordinator",
        recipient_ids=["pl-reznicek"], subject="Vráceno", body="Doplňte ECOG.",
        sent_at=datetime(2026, 10, 3, 9, 0),
    ))
    client.put("/demo/clock", json={"now": "2026-10-03T10:00:00"})

    url = f"/cases/{case_id}/handover"
    r = client.patch(url, headers=GP, json={"path": "performance_status", "value": "ECOG 1"})
    assert r.status_code == 200
    assert r.json()["performance_score"] == {"scale": "ecog", "score": 1}  # read right away (Q-C13)
    assert client.post(f"/cases/{case_id}/send", headers=GP).status_code == 409  # old validation

    client.post(f"/cases/{case_id}/handover/validate", headers=GP)
    r = client.post(f"/cases/{case_id}/send", headers=GP)
    assert r.status_code == 200
    assert r.json()["state"] == "v_triage" and r.json()["coordinator_id"] == "koordinator"
