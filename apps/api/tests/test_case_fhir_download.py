"""S9 binary export: party-scoped, read-only and without real IRIS/FHIR access."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from onko_api.main import app
from onko_repository import FhirExportError, FhirExportUnavailableError

CASE = "vzp-prochazkova"
GP = {"X-Actor-Id": "pl-reznicek"}
RAW = b'{"resourceType":"Bundle","type":"searchset","entry":[]}'


@pytest.mark.parametrize("actor", ["pl-reznicek", "koordinator"])
def test_download_returns_existing_bundle_bytes_without_changing_the_case(monkeypatch, actor):
    with TestClient(app) as client:
        calls = []

        def read(case_id):
            calls.append(case_id)
            return RAW

        monkeypatch.setattr(client.app.state.repo, "case_fhir_bundle", read)
        before = client.get(f"/cases/{CASE}").json()
        response = client.get(f"/cases/{CASE}/fhir", headers={"X-Actor-Id": actor})
        assert response.status_code == 200 and response.content == RAW
        assert response.headers["content-type"] == "application/fhir+json"
        assert response.headers["cache-control"] == "no-store"
        assert f"case-{CASE}.fhir.json" in response.headers["content-disposition"]
        assert response.headers["content-disposition"].startswith("attachment;")
        assert calls == [CASE]
        assert client.get(f"/cases/{CASE}").json() == before


@pytest.mark.parametrize(("headers", "status"), [({}, 422),
    ({"X-Actor-Id": "pl-novakova"}, 403), ({"X-Actor-Id": "koord-severni"}, 403),
    ({"X-Actor-Id": "missing"}, 404)])
def test_unauthorized_requests_never_read_fhir(monkeypatch, headers, status):
    with TestClient(app) as client:
        def never(case_id):
            pytest.fail("FHIR must not be read for unauthorized actors")

        monkeypatch.setattr(client.app.state.repo, "case_fhir_bundle", never)
        assert client.get(f"/cases/{CASE}/fhir", headers=headers).status_code == status


def test_unknown_case_is_404_before_export():
    with TestClient(app) as client:
        response = client.get("/cases/missing/fhir", headers=GP)
        assert response.status_code == 404 and response.json()["detail"] == "case not found"


@pytest.mark.parametrize(("failure", "status"), [(None, 404),
    (FhirExportError("private upstream detail"), 502),
    (FhirExportUnavailableError("private config"), 503)])
def test_export_errors_are_safe_and_never_downloaded(monkeypatch, failure, status):
    with TestClient(app) as client:
        def read(case_id):
            if failure:
                raise failure

        monkeypatch.setattr(client.app.state.repo, "case_fhir_bundle", read)
        response = client.get(f"/cases/{CASE}/fhir", headers=GP)
        assert response.status_code == status
        assert "content-disposition" not in response.headers
        assert "private" not in response.text


def test_a_backend_without_fhir_returns_503():
    with TestClient(app) as client:
        assert client.get(f"/cases/{CASE}/fhir", headers=GP).status_code == 503
