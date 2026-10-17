"""S2 endpoints: upload, jobs, metadata correction, re-extraction. Offline: fake model, no threads."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from api_testkit import FakeGateway
from fastapi.testclient import TestClient
from onko_api.jobs import ImmediateExecutor
from onko_api.main import app

ROOT = Path(__file__).resolve().parents[3]
REFERRAL = ROOT / "data/cesta-pacienta-data/Pacient/07_PL_zadost_KOC2_2026-10-02.docx"
CASE = "vzp-prochazkova"
GP = {"X-Actor-Id": "pl-reznicek"}


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.app.state.gateway = FakeGateway()
        c.app.state.jobs = ImmediateExecutor()
        yield c


def _upload(client, name="07.docx", data=None, **form):
    files = {
        "file": (
            name,
            data if data is not None else REFERRAL.read_bytes(),
            "application/octet-stream",
        )
    }
    return client.post(f"/cases/{CASE}/documents", files=files, data=form, headers=GP)


def test_upload_stores_the_document_and_the_job_fills_handover_and_metadata(client):
    r = _upload(client, received_at="2026-10-02T14:00:00")
    assert r.status_code == 201
    doc, job = r.json()["document"], r.json()["job"]
    assert doc["id"].startswith("doc-") and doc["received_at"] == "2026-10-02T14:00:00"
    assert job["status"] == "queued" and job["document_id"] == doc["id"]

    done = client.get(f"/jobs/{job['id']}").json()
    assert done["status"] == "done", done["error"]
    meta = next(d for d in client.get(f"/cases/{CASE}/documents").json() if d["id"] == doc["id"])
    assert meta["doc_type"] == "referral" and meta["author"] == "MUDr. Tomáš Řezníček"
    handover = client.get(f"/cases/{CASE}/handover").json()
    assert handover["allergies"]["value"] == "neguje"
    assert "AA: neguje" in client.get(f"/documents/{doc['id']}/text").json()["text"]
    assert any(
        f["fields"] == ["performance_status"] for f in client.get(f"/cases/{CASE}/findings").json()
    )
    assert [j["id"] for j in client.get(f"/cases/{CASE}/jobs").json()] == [job["id"]]


def test_uploaded_document_opens_as_the_original_file_with_its_czech_name(client):
    doc = _upload(client, name="Žádost PL.docx").json()["document"]
    r = client.get(f"/documents/{doc['id']}/file")
    assert r.status_code == 200
    assert r.content == REFERRAL.read_bytes()
    assert r.headers["content-type"] == doc["mime_type"]
    assert "filename*=UTF-8''%C5%BD%C3%A1dost%20PL.docx" in r.headers["content-disposition"]


def test_job_fails_with_a_reason_when_no_model_is_configured(client):
    client.app.state.gateway = None
    job = _upload(client).json()["job"]
    failed = client.get(f"/jobs/{job['id']}").json()
    assert failed["status"] == "failed" and "model" in failed["error"]


def test_upload_rejects_unknown_cases_and_file_types(client):
    assert (
        client.post(
            "/cases/nope/documents", files={"file": ("a.docx", b"x")}, headers=GP
        ).status_code
        == 404
    )
    assert _upload(client, name="photo.jpg", data=b"x").status_code == 415
    assert _upload(client, name="broken.docx", data=b"not a zip").status_code == 422


def test_update_document_corrects_only_the_given_fields(client):
    r = client.patch("/documents/01", json={"doc_type": "imaging"}, headers=GP)
    assert r.status_code == 200
    assert r.json()["doc_type"] == "imaging" and r.json()["author"] == "MUDr. Petr Malý"
    assert client.patch("/documents/nope", json={}, headers=GP).status_code == 404


def test_reextract_queues_a_case_job(client):
    r = client.post(f"/cases/{CASE}/extract", headers=GP)
    assert r.status_code == 202 and r.json()["document_id"] is None
    assert client.get(f"/jobs/{r.json()['id']}").json()["status"] == "done"
    assert client.get("/jobs/nope").status_code == 404
    assert client.post("/cases/nope/extract", headers=GP).status_code == 404


def test_uploading_a_copy_warns_about_the_duplicate_but_stores_it(client):
    seeded = next(d for d in client.get(f"/cases/{CASE}/documents").json()
                  if d["filename"] == REFERRAL.name)
    r = _upload(client, name="kopie.docx")
    assert r.status_code == 201  # a warning, never a refusal (Q-I22)
    [dup] = r.json()["duplicates"]
    assert dup == {"document_id": seeded["id"], "filename": REFERRAL.name, "kind": "exact",
                   "similarity": 1.0}
    doc = r.json()["document"]
    assert doc["sha256"] == hashlib.sha256(REFERRAL.read_bytes()).hexdigest()
    assert any(d["id"] == doc["id"] for d in client.get(f"/cases/{CASE}/documents").json())


def test_a_new_report_has_no_duplicates(client):
    later = ROOT / "data/cesta-pacienta-data/Pacient/12_Algeziologie_2026-10-26.docx"
    r = _upload(client, name=later.name, data=later.read_bytes())
    assert r.status_code == 201 and r.json()["duplicates"] == []
