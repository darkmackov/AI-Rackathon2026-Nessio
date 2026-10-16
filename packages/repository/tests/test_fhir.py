"""FHIR projection: pure mapping tests on the reference handover, plus an opt-in live round trip
against the IRIS FHIR server (`ONKO_TEST_IRIS=1` and `ONKO_FHIR_BASE_URL` in `.env`)."""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from onko_contracts import Case, DocumentMeta, Handover, Stamp
from onko_repository import IrisSettings
from onko_repository.adapters.fhir import (
    ICD10_SYSTEM,
    RC_SYSTEM,
    FhirClient,
    FhirProjector,
    document_resources,
    handover_resources,
    transaction,
)

REF = Path(__file__).resolve().parents[3] / "data" / "vzp-structured" / "reference"
FHIR_ID = re.compile(r"^[A-Za-z0-9.-]{1,64}$")


@pytest.fixture(scope="module")
def handover() -> Handover:
    return Handover.model_validate_json((REF / "expected_handover.json").read_bytes())


@pytest.fixture(scope="module")
def case(handover) -> Case:
    return Case(id=handover.case_id, patient_name="Test", koc_id="koc", referring_doctor_id="pl-x",
                created_at=datetime(2026, 10, 2, 14))


def _by_type(resources, kind):
    return [r for r in resources if r["resourceType"] == kind]


def test_reference_handover_projection(handover, case):
    resources = handover_resources(handover, case, snapshot=False)

    assert all(FHIR_ID.match(r["id"]) for r in resources)
    assert len({(r["resourceType"], r["id"]) for r in resources}) == len(resources)

    [patient] = _by_type(resources, "Patient")
    assert patient["identifier"] == [{"system": RC_SYSTEM, "value": handover.patient.birth_number.value}]
    assert patient["gender"] == "female"

    dx = next(c for c in _by_type(resources, "Condition") if c["id"].endswith("-dx"))
    assert dx["code"]["coding"] == [{"system": ICD10_SYSTEM, "code": handover.diagnosis_code.value}]
    assert dx["verificationStatus"]["coding"][0]["code"] == "provisional"  # Q-C9

    observations = _by_type(resources, "Observation")
    weight = next(o for o in observations if o["id"].endswith("-weight"))
    assert weight["valueQuantity"]["value"] == handover.weight_kg.value
    # ECOG is missing in the reference case: a Finding, never a fake Observation (PER-7)
    assert not any("performance-status" in o["id"] for o in observations)

    reports = _by_type(resources, "DiagnosticReport")
    assert len([r for r in reports if "-lab-" in r["id"]]) == len(handover.labs)

    [composition] = _by_type(resources, "Composition")
    assert composition["status"] == "preliminary"
    assert composition["subject"] == {"reference": f"Patient/{patient['id']}"}
    assert composition["section"]


def test_ai_values_carry_verbatim_evidence(handover, case):
    resources = handover_resources(handover, case, snapshot=False)
    provenance = _by_type(resources, "Provenance")
    quotes = {e["what"]["display"] for p in provenance for e in p.get("entity", [])}
    assert handover.patient.birth_number.evidence[0].quote in quotes
    referenced = {e["what"]["reference"] for p in provenance for e in p.get("entity", [])}
    assert all(r.startswith("DocumentReference/doc-") for r in referenced)
    assert all(p["recorded"].endswith(("+02:00", "+01:00")) for p in provenance)


def test_validation_is_its_own_provenance(handover, case):
    signed = handover.model_copy(update={
        "validated_by_referrer": Stamp(by="pl-x", at=datetime(2026, 10, 2, 13, 55)),
    })
    resources = handover_resources(signed, case, snapshot=False)
    [composition] = _by_type(resources, "Composition")
    assert composition["status"] == "final"
    verifier = [p for p in _by_type(resources, "Provenance")
                if p["agent"][0]["type"]["coding"][0]["code"] == "verifier"]
    assert [p["agent"][0]["who"]["display"] for p in verifier] == ["pl-x"]


def test_snapshot_has_its_own_resources_but_the_same_patient(handover, case):
    live = {(r["resourceType"], r["id"]) for r in handover_resources(handover, case, snapshot=False)}
    frozen = {(r["resourceType"], r["id"]) for r in handover_resources(handover, case, snapshot=True)}
    [patient_id] = [i for t, i in live if t == "Patient"]
    assert all(i.startswith(patient_id) for _, i in live & frozen)  # the Patient and its Provenance


def test_document_reference_and_binary():
    meta = DocumentMeta(id="07", case_id="c1", filename="07.docx", received_at=datetime(2026, 10, 2, 14))
    binary, reference = document_resources(meta, b"PK\x03\x04", "text")
    assert base64.b64decode(binary["data"]) == b"PK\x03\x04"
    assert reference["content"][0]["attachment"]["url"] == f"Binary/{binary['id']}"
    assert reference["date"] == "2026-10-02T14:00:00+02:00"

    text_binary, _ = document_resources(meta, b"", "ZÁVĚR")
    assert base64.b64decode(text_binary["data"]).decode() == "ZÁVĚR"


def test_projector_posts_one_transaction(handover, case):
    posted = []

    def handler(request: httpx.Request) -> httpx.Response:
        posted.append(json.loads(request.content))
        return httpx.Response(200, json={"resourceType": "Bundle", "type": "transaction-response"})

    client = FhirClient("https://fhir.example/r4", "u", "p", transport=httpx.MockTransport(handler))
    FhirProjector(client).project_handover(handover, case, snapshot=False)

    [bundle] = posted
    assert bundle["type"] == "transaction"
    assert all(e["request"]["method"] == "PUT" for e in bundle["entry"])


def test_live_fhir_round_trip(handover, case):
    if os.environ.get("ONKO_TEST_IRIS") != "1":
        pytest.skip("set ONKO_TEST_IRIS=1 to run against the IRIS FHIR server")
    settings = IrisSettings()
    if not settings.fhir_configured:
        pytest.skip("ONKO_FHIR_BASE_URL is not set")
    projector = FhirProjector.from_settings(settings)
    # Dev-prefixed ids keep the shared server's demo data clean (PER-10).
    test_case = case.model_copy(update={"id": "test-fhir-roundtrip"})
    test_handover = handover.model_copy(update={"case_id": test_case.id})
    for document_id in {e.document_id for r in [test_handover] for e in r.patient.birth_number.evidence}:
        projector.project_document(DocumentMeta(id=document_id, filename=f"{document_id}.docx"), b"", "x")
    projector.client.transaction(transaction(handover_resources(test_handover, test_case,
                                                                snapshot=False)))
    patient = projector.client.read("Patient", "test-fhir-roundtrip-patient")
    assert patient is not None
    assert patient["identifier"][0]["system"] == RC_SYSTEM
