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
from onko_contracts import (
    AuditEvent,
    Case,
    DocumentMeta,
    Handover,
    MdtConclusion,
    Priority,
    Stamp,
    Task,
    TaskStatus,
)
from onko_repository import IrisSettings
from onko_repository.adapters.fhir import (
    ICD10_SYSTEM,
    RC_SYSTEM,
    FhirClient,
    FhirProjector,
    audit_resource,
    document_resources,
    handover_resources,
    mdt_conclusion_resources,
    task_resource,
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


def _live_projector() -> FhirProjector:
    if os.environ.get("ONKO_TEST_IRIS") != "1":
        pytest.skip("set ONKO_TEST_IRIS=1 to run against the IRIS FHIR server")
    settings = IrisSettings()
    if not settings.fhir_configured:
        pytest.skip("ONKO_FHIR_BASE_URL is not set")
    return FhirProjector.from_settings(settings)


def test_live_fhir_round_trip(handover, case):
    projector = _live_projector()
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


NOW = datetime(2026, 10, 16, 9, 30)
CONFIRMED = Stamp(by="koordinator", at=datetime(2026, 10, 22, 10, 15))


def _task(**update) -> Task:
    task = Task(id="t-ct", case_id="c1", title="CT hrudníku", kind="imaging", owner="koc-1",
                due=datetime(2026, 10, 9, 8), priority=Priority.HIGH, status=TaskStatus.BOOKED,
                location="KOC 1", result_document_id="09")
    return task.model_copy(update=update)


def test_task_is_a_fhir_task_from_the_koc_to_its_owner():
    task = task_resource(_task(), requester="KOC 2", owner="KOC 1", patient_on_server=True,
                         patient_name="Jana Testová")

    assert FHIR_ID.match(task["id"])
    assert (task["status"], task["intent"], task["priority"]) == ("accepted", "order", "urgent")
    assert task["requester"] == {"display": "KOC 2"}
    assert task["owner"] == {"display": "KOC 1"}
    assert task["for"] == {"reference": "Patient/c1-patient"}
    assert task["restriction"]["period"]["end"] == "2026-10-09T08:00:00+02:00"
    assert task["output"][0]["valueReference"] == {"reference": "DocumentReference/doc-09"}


def test_task_without_a_projected_patient_names_the_patient_only():
    task = task_resource(_task(status=TaskStatus.DONE, due=None, result_document_id=None),
                         requester="KOC 2", owner="KOC 1", patient_on_server=False,
                         patient_name="Jana Testová")
    assert task["status"] == "completed"
    assert task["for"] == {"display": "Jana Testová"}
    assert "restriction" not in task and "output" not in task


def test_audit_event_projection():
    event = AuditEvent(id="a1", case_id="c1", at=NOW, actor_id="koordinator", action="transition",
                       detail="odeslano -> v_triage")
    audit = audit_resource(event, patient_on_server=True)

    assert audit["id"] == "audit-a1"
    assert audit["subtype"] == [{"code": "transition", "display": "transition"}]
    assert audit["recorded"] == "2026-10-16T09:30:00+02:00"
    assert audit["agent"] == [{"who": {"display": "koordinator"}, "requestor": True}]
    assert audit["entity"] == [{"what": {"reference": "Patient/c1-patient"},
                                "description": "odeslano -> v_triage"}]


def _conclusion(handover: Handover, **update) -> MdtConclusion:
    conclusion = MdtConclusion(
        case_id=handover.case_id, diagnosis_name="Karcinom pankreatu", diagnosis_code="C25.0",
        conclusion="Indikována chemoterapie.", recommendations=["FOLFIRINOX", "Kontrola CT"],
        chair="MUDr. Předseda", confirmed=CONFIRMED,
    )
    return conclusion.model_copy(update=update)


def test_mdt_conclusion_is_a_document_bundle_composition_first(handover, case):
    bundle, reference = mdt_conclusion_resources(_conclusion(handover), handover, case,
                                                 patient_on_server=True)

    assert bundle["type"] == "document"
    assert bundle["timestamp"] == "2026-10-22T10:15:00+02:00"
    assert bundle["identifier"]["value"].startswith("urn:uuid:")
    resources = [e["resource"] for e in bundle["entry"]]
    assert [r["resourceType"] for r in resources] == ["Composition", "Patient", "Condition"]
    composition, patient, condition = resources
    assert composition["status"] == "final"
    # Only what the Composition references, resolved inside the Bundle.
    full_urls = {e["fullUrl"] for e in bundle["entry"]}
    referenced = {composition["subject"]["reference"]} | {
        ref["reference"] for sec in composition["section"] for ref in sec.get("entry", [])}
    assert referenced == full_urls - {bundle["entry"][0]["fullUrl"]}
    assert patient["identifier"][0]["system"] == RC_SYSTEM
    assert condition["verificationStatus"]["coding"][0]["code"] == "confirmed"  # Q-C9
    assert condition["code"]["coding"] == [{"system": ICD10_SYSTEM, "code": "C25.0"}]

    assert reference["resourceType"] == "DocumentReference"
    assert reference["content"][0]["attachment"]["url"] == f"Bundle/{bundle['id']}"
    assert reference["subject"] == {"reference": f"Patient/{patient['id']}"}


def test_uploaded_conclusion_attaches_its_pdf(handover, case):
    _, reference = mdt_conclusion_resources(_conclusion(handover, document_id="mdt-pdf"), handover,
                                            case, patient_on_server=True)
    assert [c["attachment"]["contentType"] for c in reference["content"]] == [
        "application/fhir+json", "application/pdf"]
    assert reference["content"][1]["attachment"]["url"] == "Binary/doc-mdt-pdf"


def test_a_corrected_conclusion_is_a_new_bundle(handover, case):
    first, _ = mdt_conclusion_resources(_conclusion(handover), handover, case,
                                        patient_on_server=True)
    again, _ = mdt_conclusion_resources(_conclusion(handover), handover, case,
                                        patient_on_server=True)
    corrected, _ = mdt_conclusion_resources(
        _conclusion(handover, confirmed=Stamp(by="koordinator", at=datetime(2026, 10, 23, 8))),
        handover, case, patient_on_server=True)

    assert again == first  # re-projecting the same confirmation never changes the Bundle
    assert corrected["id"] != first["id"]
    assert corrected["identifier"] != first["identifier"]


def test_unconfirmed_conclusion_is_not_a_document(handover, case):
    with pytest.raises(ValueError):
        mdt_conclusion_resources(_conclusion(handover, confirmed=None), handover, case,
                                 patient_on_server=True)


def test_validate_returns_the_operation_outcome():
    outcome = {"resourceType": "OperationOutcome",
               "issue": [{"severity": "error", "code": "invalid"}]}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/r4/Task/$validate"
        return httpx.Response(400, json=outcome)

    client = FhirClient("https://fhir.example/r4", transport=httpx.MockTransport(handler))
    assert client.validate({"resourceType": "Task", "id": "x"}) == outcome


def _errors(outcome: dict) -> list[str]:
    return [i.get("diagnostics", i.get("code", "")) for i in outcome.get("issue", [])
            if i.get("severity") in ("error", "fatal")]


def test_live_validate_every_projected_resource(handover, case):
    """$validate against the declared profiles (Q-I25): every resource the projection writes."""
    projector = _live_projector()
    test_case = case.model_copy(update={"id": "test-fhir-validate"})
    test_handover = handover.model_copy(update={"case_id": test_case.id})
    meta = DocumentMeta(id="test-validate-07", case_id=test_case.id, filename="07.docx",
                        received_at=NOW)
    resources = [
        *document_resources(meta, b"PK", "text"),
        *handover_resources(test_handover, test_case, snapshot=False),
        *handover_resources(test_handover, test_case, snapshot=True),
        task_resource(_task(case_id=test_case.id), requester="KOC 2", owner="KOC 1",
                      patient_on_server=True, patient_name=None),
        audit_resource(AuditEvent(id="test-validate", case_id=test_case.id, at=NOW,
                                  actor_id="koordinator", action="transition"),
                       patient_on_server=True),
        *mdt_conclusion_resources(_conclusion(test_handover), test_handover, test_case,
                                  patient_on_server=True),
    ]
    failures = {f"{r['resourceType']}/{r['id']}": errors for r in resources
                if (errors := _errors(projector.client.validate(r)))}
    assert failures == {}


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def test_referral_attachments_inline_and_binary_in_the_bundle():
    from onko_repository import ReferralAttachment, referral_attachments

    bundle = {"resourceType": "Bundle", "type": "collection", "entry": [
        {"resource": {"resourceType": "Patient", "id": "p"}},  # structured: not mapped (Q-I21)
        {"resource": {"resourceType": "DocumentReference", "status": "current", "content": [
            {"attachment": {"contentType": "application/pdf", "title": "zadost.pdf",
                            "data": _b64(b"%PDF-1")}}]}},
        {"resource": {"resourceType": "DiagnosticReport", "status": "final", "code": {},
                      "presentedForm": [{"url": "urn:uuid:bin-1", "title": "ct.docx"}]}},
        {"fullUrl": "urn:uuid:bin-1", "resource": {
            "resourceType": "Binary", "id": "b1", "contentType": "application/octet-stream",
            "data": _b64(b"PK\x03\x04")}},
    ]}

    assert referral_attachments(bundle) == [
        ReferralAttachment(filename="zadost.pdf", mime_type="application/pdf", data=b"%PDF-1"),
        ReferralAttachment(filename="ct.docx", mime_type="application/octet-stream",
                           data=b"PK\x03\x04"),
    ]


@pytest.mark.parametrize("bundle", [
    {"resourceType": "Patient"},
    [],
    {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "DocumentReference",
                                                       "content": [{"attachment": {
                                                           "url": "https://elsewhere/x.pdf"}}]}}]},
    {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "DocumentReference",
                                                       "content": [{"attachment": {
                                                           "data": "not base64!"}}]}}]},
])
def test_unusable_referral_bundles_are_rejected(bundle):
    from onko_repository import BundleError, referral_attachments

    with pytest.raises(BundleError):
        referral_attachments(bundle)
