"""S9 referral in: a FHIR Bundle creates a sent case in Nový and its documents go through
extraction (Q-I20, Q-I21). Offline: fake model, no threads."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from api_testkit import FakeGateway
from fastapi.testclient import TestClient
from onko_api.jobs import ImmediateExecutor
from onko_api.main import app

ROOT = Path(__file__).resolve().parents[3]
REFERRAL = ROOT / "data/cesta-pacienta-data/Pacient/07_PL_zadost_KOC2_2026-10-02.docx"
GP = {"X-Actor-Id": "pl-reznicek"}
KOC = "koc2-lipova"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.app.state.gateway = FakeGateway()
        c.app.state.jobs = ImmediateExecutor()
        yield c


def _bundle(*attachments: dict) -> dict:
    return {"resourceType": "Bundle", "type": "collection", "entry": [
        {"resource": {"resourceType": "ServiceRequest", "status": "active", "intent": "order"}},
        {"resource": {"resourceType": "DocumentReference", "status": "current",
                      "content": [{"attachment": a} for a in attachments]}},
    ]}


def _referral_doc() -> dict:
    return {"contentType": DOCX, "title": "07_zadost.docx",
            "data": base64.b64encode(REFERRAL.read_bytes()).decode("ascii")}


def _send(client, payload, koc_id=KOC, headers=GP):
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return client.post("/referrals/fhir", files={"file": ("referral.json", raw, "application/fhir+json")},
                       data={"koc_id": koc_id}, headers=headers)


def test_bundle_creates_a_sent_case_in_novy_and_extracts_its_documents(client):
    r = _send(client, _bundle(_referral_doc()))
    assert r.status_code == 201, r.text
    case = r.json()
    assert (case["state"], case["queue"]) == ("odeslano", "novy")
    assert case["koc_id"] == KOC and case["referring_doctor_id"] == "pl-reznicek"
    assert case["milestones"]["referred_at"] is not None

    [doc] = client.get(f"/cases/{case['id']}/documents").json()
    assert doc["filename"] == "07_zadost.docx" and doc["mime_type"] == DOCX
    [job] = client.get(f"/cases/{case['id']}/jobs").json()
    assert job["status"] == "done", job["error"]
    handover = client.get(f"/cases/{case['id']}/handover").json()
    assert handover["allergies"]["value"] == "neguje"  # extracted with evidence, origin=ai
    assert handover["validated_by_referrer"] is None  # never inferred
    on_dashboard = client.get("/cases", params={"koc_id": KOC, "queue": "novy"}).json()
    assert case["id"] in [c["id"] for c in on_dashboard]


@pytest.mark.parametrize(("payload", "headers", "koc_id", "code"), [
    (None, {"X-Actor-Id": "koordinator"}, KOC, 403),
    (None, GP, "nope", 400),
    (b"not json", GP, KOC, 422),
    ({"resourceType": "Patient"}, GP, KOC, 422),
    ({"resourceType": "Bundle", "type": "collection", "entry": []}, GP, KOC, 400),
    (_bundle({"contentType": "image/png", "title": "foto.png", "data": "iVBORw0K"}), GP, KOC, 415),
    (_bundle({"contentType": DOCX, "title": "x.docx", "data": "AAAA"}), GP, KOC, 422),
])
def test_unusable_referrals_are_rejected_and_nothing_is_saved(client, payload, headers, koc_id,
                                                               code):
    before = client.get("/cases").json()
    r = _send(client, payload if payload is not None else _bundle(_referral_doc()),
              koc_id=koc_id, headers=headers)
    assert r.status_code == code, r.text
    assert client.get("/cases").json() == before
