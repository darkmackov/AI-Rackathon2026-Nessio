"""S9 case downloads read existing FHIR projections, offline with mocked HTTP."""

from __future__ import annotations

import json

import httpx
import pytest
from onko_contracts import Case
from onko_repository import FhirExportError, FhirExportUnavailableError, InMemoryRepository
from onko_repository.adapters.fhir import FhirClient, FhirProjector, patient_id
from onko_repository.adapters.iris import IrisRepository


def test_download_preserves_server_bytes_and_follows_the_case_patient(monkeypatch):
    raw = b'{"resourceType":"Bundle", "type":"searchset","entry":[]}'
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=raw)

    client = FhirClient("https://fhir.example/r4", transport=httpx.MockTransport(handler))
    # Exercise the IRIS read adapter without SQL or constructor I/O.
    repo = IrisRepository.__new__(IrisRepository)
    repo.projector = FhirProjector(client)
    item = Case(id="arbitrary-case", patient_name="", koc_id="koc", referring_doctor_id="gp",
                created_at="2026-10-17T09:00:00")
    monkeypatch.setattr(repo, "get_case", {item.id: item}.__getitem__)
    try:
        assert repo.case_fhir_bundle(item.id) == raw
        assert requests[0].url.path == f"/r4/Patient/{patient_id(item.id)}/$everything"
        assert requests[0].method == "GET"
        with pytest.raises(KeyError):
            repo.case_fhir_bundle("missing")
        repo.projector = None
        with pytest.raises(FhirExportUnavailableError):
            repo.case_fhir_bundle(item.id)
    finally:
        client.close()


def test_all_pages_are_downloaded_without_changing_resources():
    resources = [{"resourceType": "Patient", "id": "c-patient"},
                 {"resourceType": "Task", "id": "c-task"}]
    paths = []

    def handler(request):
        paths.append(str(request.url))
        if len(paths) == 1:
            return httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset",
                "total": 2, "entry": [{"resource": resources[0]}],
                "link": [{"relation": "next", "url": "?page=2"}]})
        return httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset",
                                        "entry": [{"resource": resources[1]}]})

    client = FhirClient("https://fhir.example/r4", transport=httpx.MockTransport(handler))
    try:
        result = json.loads(client.patient_bundle("c-patient"))
        assert [entry["resource"] for entry in result["entry"]] == resources
        assert result["total"] == 2 and result["link"] == []
        assert paths == ["https://fhir.example/r4/Patient/c-patient/$everything",
                         "https://fhir.example/r4/Patient/c-patient/$everything?page=2"]
    finally:
        client.close()


@pytest.mark.parametrize("next_url", ["https://other.example/private", "/outside/r4?page=2",
    "https://u:p@fhir.example/r4/page", "https://fhir.example/r4/Patient/p/$everything",
    "/r4/%2e%2e/private", ""])
def test_unsafe_or_cyclic_pagination_never_leaks_credentials_or_returns_a_partial_file(next_url):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"resourceType": "Bundle", "entry": [],
                                        "link": [{"relation": "next", "url": next_url}]})

    client = FhirClient("https://fhir.example/r4", "u", "p",
                        transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(FhirExportError):
            client.patient_bundle("p")
        assert len(requests) == 1
    finally:
        client.close()


@pytest.mark.parametrize("response", [httpx.Response(503), httpx.Response(200, text="broken"),
    httpx.Response(200, json={"resourceType": "OperationOutcome"}),
    httpx.Response(200, json={"resourceType": "Bundle", "entry": {}})])
def test_failed_or_invalid_response_never_becomes_a_download(response):
    client = FhirClient("https://fhir.example/r4",
                        transport=httpx.MockTransport(lambda request: response))
    try:
        with pytest.raises(FhirExportError):
            client.patient_bundle("p")
    finally:
        client.close()


def test_a_missing_projected_patient_returns_no_file():
    client = FhirClient("https://fhir.example/r4",
                        transport=httpx.MockTransport(lambda request: httpx.Response(404)))
    try:
        assert client.patient_bundle("p") is None
    finally:
        client.close()


def test_a_failure_after_the_first_page_discards_the_partial_export():
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, json={"resourceType": "Bundle", "entry": [],
                "link": [{"relation": "next", "url": "?page=2"}]})
        raise httpx.ReadTimeout("private upstream information")

    client = FhirClient("https://fhir.example/r4", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(FhirExportError, match="^FHIR export failed$"):
            client.patient_bundle("p")
        assert len(calls) == 2
    finally:
        client.close()


def test_in_memory_never_invents_a_fhir_export():
    repo = InMemoryRepository()
    with pytest.raises(KeyError):
        repo.case_fhir_bundle("missing")
    repo.save_case(Case(id="c", patient_name="", koc_id="k", referring_doctor_id="g",
                        created_at="2026-10-17T09:00:00"))
    with pytest.raises(FhirExportUnavailableError):
        repo.case_fhir_bundle("c")
