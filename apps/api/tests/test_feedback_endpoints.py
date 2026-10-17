"""S6 endpoints: the feedback loop (demo steps 10, 13, 14) on the seeded reference case. The patient
notice, sending the confirmed conclusion with its context, the GP's inbox and receipt closing the
case, with permissions, state rules and audit. Offline: in-memory repository, a fake model, jobs
run inline."""

from __future__ import annotations

import pytest
from api_testkit import FakeGateway
from fastapi.testclient import TestClient
from onko_api.jobs import ImmediateExecutor
from onko_api.main import app
from onko_contracts import MdtRecord, Stamp
from onko_documents import render_mdt_record

CASE = "vzp-prochazkova"
GP = {"X-Actor-Id": "pl-reznicek"}
OTHER_GP = {"X-Actor-Id": "pl-novakova"}
COORDINATOR = {"X-Actor-Id": "koordinator"}
OTHER_KOC = {"X-Actor-Id": "koord-severni"}
SNAPSHOT = {"board_id": "mdt-git-lipova", "mdt_date": "2026-10-21"}
CONCLUSION = {
    "diagnosis_name": "Duktální adenokarcinom hlavy pankreatu",
    "diagnosis_code": "C25.0",
    "conclusion": "Neoadjuvantní chemoterapie a restaging.",
    "recommendations": ["Onkologické konzilium"],
    "date": "2026-10-21",
}
NOTICE = {"subject": "Termín MDT", "body": "Váš případ projedná MDT 21. 10. 2026."}


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/demo/reset", json={"scenario": "reference_at_mdt"})
        c.app.state.gateway = FakeGateway()
        c.app.state.jobs = ImmediateExecutor()
        yield c


def _case(client) -> dict:
    return client.get(f"/cases/{CASE}").json()


def _actions(client) -> list[str]:
    return [e["action"] for e in client.get(f"/cases/{CASE}/audit").json()]


def _audit(client, action: str) -> dict:
    return next(e for e in client.get(f"/cases/{CASE}/audit").json() if e["action"] == action)


def _snapshot(client) -> None:
    assert client.post(f"/cases/{CASE}/findings/F01/resolve", headers=COORDINATOR,
                       json={"kind": "overridden", "note": "ECOG neuveden"}).status_code == 200
    assert client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT).status_code == 201


def _confirmed(client) -> None:
    _snapshot(client)
    assert client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json=CONCLUSION).status_code == 200
    assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR).status_code == 200


def _send(client, note: str | None = None) -> dict:
    r = client.post(f"/cases/{CASE}/feedback", headers=COORDINATOR, json={"note": note})
    assert r.status_code == 201, r.text
    return r.json()


def _quoted(handover) -> set[str]:
    """Every document id the handover's evidence quotes."""
    if isinstance(handover, dict):
        found = {e["document_id"] for e in handover.get("evidence") or [] if isinstance(e, dict)}
        return found.union(*(_quoted(v) for k, v in handover.items() if k != "evidence"))
    if isinstance(handover, list):
        return set().union(*(_quoted(v) for v in handover))
    return set()


def test_feedback_loop_from_the_patient_notice_to_the_closed_case(client):
    # Step 10: 'Informovat pacienta' about the MDT date, recorded and never delivered.
    r = client.post(f"/cases/{CASE}/patient-notices", headers=COORDINATOR, json=NOTICE)
    assert r.status_code == 201, r.text
    notice = r.json()
    assert (notice["kind"], notice["simulated"], notice["recipient_ids"]) == ("patient_notice", True, [])
    assert (notice["subject"], notice["sender_id"]) == ("Termín MDT", "koordinator")
    assert notice["sent_at"] is not None
    assert client.get("/inbox", headers=GP).json() == []

    # Steps 11–12, then step 13: send to the GP with the original context.
    _confirmed(client)
    snapshot = client.get(f"/cases/{CASE}/handover", params={"snapshot": True}).json()
    message = _send(client, note="Prosím o převzetí.")
    assert message["kind"] == "mdt_result"
    assert (message["sender_id"], message["recipient_ids"]) == ("koordinator", ["pl-reznicek"])
    assert message["subject"] == "Závěr MDT ze dne 21. 10. 2026"
    assert message["body"] == "Prosím o převzetí.\n\nNeoadjuvantní chemoterapie a restaging."
    assert message["attachment_document_ids"] == sorted(_quoted(snapshot))
    assert message["attachment_document_ids"]  # the reference snapshot quotes its documents
    assert (message["simulated"], message["sent_at"] is not None) == (False, True)

    case = _case(client)
    assert (case["state"], case["on_move"], case["next_step"]) == ("zpetna_vazba_odeslana", "pl-reznicek", None)
    assert _audit(client, "feedback_sent")["detail"] == (
        f"zaver_mdt → zpetna_vazba_odeslana, příloh: {len(message['attachment_document_ids'])}")
    assert client.post(f"/cases/{CASE}/feedback", headers=COORDINATOR, json={}).status_code == 409  # once

    # Step 14: the GP's inbox, then 'Potvrzuji převzetí'.
    assert client.get("/inbox", headers=GP).json() == [message]
    assert client.get("/inbox", headers=COORDINATOR).json() == []
    assert client.get(f"/cases/{CASE}/receipts").json() == []
    r = client.post(f"/messages/{message['id']}/confirm", headers=GP)
    assert r.status_code == 201, r.text
    receipt = r.json()
    assert (receipt["message_id"], receipt["recipient_id"]) == (message["id"], "pl-reznicek")

    case = _case(client)
    assert (case["state"], case["on_move"], case["next_step"], case["next_due"]) == ("uzavreno", None, None, None)
    assert client.get(f"/cases/{CASE}/time-to-treatment").json()["t2"] == 19  # 2. 10. → 21. 10.
    assert client.get(f"/cases/{CASE}/receipts").json() == [receipt]
    assert _audit(client, "receipt_confirmed")["actor_id"] == "pl-reznicek"
    assert _audit(client, "receipt_confirmed")["detail"] == "zpetna_vazba_odeslana → uzavreno"
    assert _actions(client)[-3:] == ["mdt_conclusion_confirmed", "feedback_sent", "receipt_confirmed"]
    assert "patient_notice_sent" in _actions(client)
    assert [m["kind"] for m in client.get(f"/cases/{CASE}/messages").json()] == ["patient_notice", "mdt_result"]

    assert client.post(f"/messages/{message['id']}/confirm", headers=GP).status_code == 409  # once
    assert client.post(f"/cases/{CASE}/patient-notices", headers=COORDINATOR, json=NOTICE).status_code == 409


def test_feedback_needs_a_confirmed_conclusion_in_zaver_mdt(client):
    r = client.post(f"/cases/{CASE}/feedback", headers=COORDINATOR, json={})
    assert r.status_code == 404  # no conclusion yet
    _snapshot(client)
    client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json=CONCLUSION)
    assert client.post(f"/cases/{CASE}/feedback", headers=COORDINATOR, json={}).status_code == 409  # pripraveno_k_mdt
    client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR)

    # A correction drops the confirmation: nothing goes out until it is confirmed again.
    client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json={**CONCLUSION, "conclusion": "Opraveno."})
    r = client.post(f"/cases/{CASE}/feedback", headers=COORDINATOR, json={})
    assert r.status_code == 409
    assert r.json()["detail"] == "confirm the MDT conclusion before sending it"
    assert _case(client)["state"] == "zaver_mdt"
    assert client.get(f"/cases/{CASE}/messages").json() == []

    client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR)
    assert _send(client)["body"] == "Opraveno."


def test_only_a_coordinator_of_the_case_koc_sends_and_notifies(client):
    _confirmed(client)
    for headers in (GP, OTHER_KOC):
        assert client.post(f"/cases/{CASE}/feedback", headers=headers, json={}).status_code == 403
        assert client.post(f"/cases/{CASE}/patient-notices", headers=headers, json=NOTICE).status_code == 403
    assert client.post(f"/cases/{CASE}/feedback", json={}).status_code == 422  # no X-Actor-Id
    assert _case(client)["state"] == "zaver_mdt"


def test_an_uploaded_report_goes_first_and_the_body_points_to_it(client):
    _snapshot(client)
    report = render_mdt_record(MdtRecord(case_id=CASE, mdt_date="2026-10-21", board_id="mdt-git-lipova",
                                         members=[], created=Stamp(by="k", at="2026-10-21T15:00")))
    r = client.post(f"/cases/{CASE}/mdt/conclusion/upload", headers=COORDINATOR,
                    files={"file": ("zaver-mdt.pdf", report, "application/pdf")})
    assert r.status_code == 201, r.text
    uploaded = r.json()["document"]["id"]
    assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR).status_code == 200

    message = _send(client)
    assert message["attachment_document_ids"][0] == uploaded
    assert message["attachment_document_ids"].count(uploaded) == 1
    assert message["subject"] == "Závěr MDT ze dne 21. 10. 2026"  # the MDT date
    assert message["body"] == "Závěr MDT v příloze"


def test_only_the_recipient_confirms_an_mdt_result(client):
    _confirmed(client)
    message = _send(client)
    assert client.post("/messages/nope/confirm", headers=GP).status_code == 404
    for headers in (COORDINATOR, OTHER_GP):
        assert client.post(f"/messages/{message['id']}/confirm", headers=headers).status_code == 403
    assert client.get(f"/cases/{CASE}/receipts").json() == []
    assert _case(client)["state"] == "zpetna_vazba_odeslana"


def test_closing_ends_a_hold(client):
    _confirmed(client)
    message = _send(client)
    assert client.put(f"/cases/{CASE}/hold", headers=COORDINATOR,
                      json={"reason": "čeká na převzetí"}).status_code == 200
    assert _case(client)["queue"] == "odlozeny"

    assert client.post(f"/messages/{message['id']}/confirm", headers=GP).status_code == 201
    case = _case(client)
    assert (case["state"], case["on_hold"], case["queue"]) == ("uzavreno", None, "aktivni")
    assert _audit(client, "receipt_confirmed")["detail"] == "zpetna_vazba_odeslana → uzavreno, odložení zrušeno"


def test_a_returned_referral_is_in_the_inbox_but_not_confirmable(client):
    assert client.post(f"/cases/{CASE}/return", headers=COORDINATOR,
                       json={"note": "Doplňte ECOG"}).status_code == 200
    inbox = client.get("/inbox", headers=GP).json()
    assert [(m["kind"], m["body"]) for m in inbox] == [("case_returned", "Doplňte ECOG")]
    r = client.post(f"/messages/{inbox[0]['id']}/confirm", headers=GP)
    assert r.status_code == 409
    assert _case(client)["state"] == "vraceno_lekari"


def test_inbox_is_newest_first_and_needs_a_user(client):
    assert client.post(f"/cases/{CASE}/return", headers=COORDINATOR, json={"note": "Doplňte ECOG"}).status_code == 200
    client.put("/demo/clock", json={"now": "2026-10-21T16:00:00"})
    # Back from the GP so the MDT can go ahead (D-15).
    assert client.post(f"/cases/{CASE}/handover/validate", headers=GP).status_code == 200
    assert client.post(f"/cases/{CASE}/send", headers=GP).status_code == 200
    assert client.post(f"/cases/{CASE}/transition", headers=COORDINATOR, json={"to": "kompletni"}).status_code == 200
    _confirmed(client)
    _send(client)
    assert [m["kind"] for m in client.get("/inbox", headers=GP).json()] == ["mdt_result", "case_returned"]
    assert client.get("/inbox").status_code == 422
    assert client.get("/inbox", headers={"X-Actor-Id": "nobody"}).status_code in (401, 403, 404)


def test_patient_notice_needs_a_taken_over_case(client):
    r = client.post("/referrals", headers=GP, json={"koc_id": "koc2-lipova"})
    assert r.status_code == 201, r.text
    draft = r.json()["id"]
    assert client.post(f"/cases/{draft}/patient-notices", headers=COORDINATOR, json=NOTICE).status_code == 409
    assert client.get(f"/cases/{draft}/messages").json() == []


def test_case_lists_answer_404_for_an_unknown_case(client):
    for path in ("messages", "receipts"):
        r = client.get(f"/cases/nope/{path}")
        assert (r.status_code, r.json()["detail"]) == (404, "case not found")
    assert client.post("/cases/nope/feedback", headers=COORDINATOR, json={}).status_code == 404
    assert client.post("/cases/nope/patient-notices", headers=COORDINATOR, json=NOTICE).status_code == 404
