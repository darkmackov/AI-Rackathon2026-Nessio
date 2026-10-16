"""FHIR R4 projection of the app state (Q-A7, PER-4 … PER-8): the showcase resources from slices.md
S7, mapped as docs/data-model.md says, pushed to the IRIS FHIR server as transaction bundles.

The mapping functions are pure (domain model -> FHIR JSON); `FhirClient` does the HTTP.
Resource ids are derived from the app-state ids, so re-projecting updates in place (PUT).
"""

from __future__ import annotations

import base64
import html
import re
from collections.abc import Iterable
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from onko_contracts import Case, DocumentMeta, FieldStatus, Handover, Origin, Sourced, Stamp

from ..settings import IrisSettings

Resource = dict[str, Any]

# Identifier and code systems (data-model.md; PER-6).
RC_SYSTEM = "https://ncez.mzcr.cz/fhir/sid/rcis"
ICD10_SYSTEM = "http://hl7.org/fhir/sid/icd-10"
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
V2_0074 = "http://terminology.hl7.org/CodeSystem/v2-0074"
OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category"
CONDITION_CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical"
CONDITION_VERIFICATION = "http://terminology.hl7.org/CodeSystem/condition-ver-status"
CONDITION_CATEGORY = "http://terminology.hl7.org/CodeSystem/condition-category"
INTERPRETATION = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation"
PARTICIPANT_TYPE = "http://terminology.hl7.org/CodeSystem/provenance-participant-type"

# meta.profile per resource (data-model.md › FHIR R4 mapping; canonicals from the packages).
CZ_CORE = "https://hl7.cz/fhir/core/StructureDefinition/"
CZ_LAB = "https://hl7.cz/fhir/lab/StructureDefinition/"
PROFILE_PATIENT = CZ_CORE + "cz-patient-core"
PROFILE_CONDITION = CZ_CORE + "condition-cz-core"
PROFILE_COMPOSITION = CZ_CORE + "composition-cz-core"
PROFILE_PROVENANCE = CZ_CORE + "cz-provenance"
PROFILE_REPORT = CZ_CORE + "diagnosticReport-cz-core"
PROFILE_RESULT = CZ_CORE + "medicalTestResult-cz-core"
PROFILE_LAB_REPORT = CZ_LAB + "diagnosticReport-cz-lab"
PROFILE_LAB_RESULT = CZ_LAB + "observation-resultlab-cz-lab"
PROFILE_BODY_WEIGHT = "http://hl7.org/fhir/StructureDefinition/bodyweight"
PROFILE_BODY_HEIGHT = "http://hl7.org/fhir/StructureDefinition/bodyheight"

# Contracts use naive datetimes (Q-K8 open); FHIR instants need a zone. Demo time is Czech local
# time (D-13).
LOCAL_TZ = ZoneInfo("Europe/Prague")

AI_AGENT = "Onko-koordinace AI"
_GENDER = {"žena": "female", "zena": "female", "muž": "male", "muz": "male"}
_INTERPRETATIONS = {"H", "L", "HH", "LL", "A", "AA", "N"}


# --- small helpers ---------------------------------------------------------------------------


def fhir_id(*parts: str) -> str:
    """A valid FHIR id ([A-Za-z0-9-.]{1,64}) derived from app-state ids."""
    raw = "-".join(parts)
    return re.sub(r"[^A-Za-z0-9.-]", "-", raw)[:64]


def instant(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=LOCAL_TZ)
    return value.isoformat(timespec="seconds")


def _start_of(day: date) -> datetime:
    return datetime.combine(day, time())


def _found(sourced: Sourced[Any]) -> bool:
    return sourced.status is FieldStatus.FOUND and sourced.value is not None


def _ref(resource: Resource) -> dict[str, str]:
    return {"reference": f"{resource['resourceType']}/{resource['id']}"}


def _coding(system: str, code: str, display: str | None = None) -> dict[str, Any]:
    coding = {"system": system, "code": code}
    if display:
        coding["display"] = display
    return {"coding": [coding]}


def _narrative(text: str) -> dict[str, str]:
    body = html.escape(text).replace("\n", "<br/>")
    return {"status": "generated", "div": f'<div xmlns="http://www.w3.org/1999/xhtml">{body}</div>'}


def _evidence_date(sourced: Sourced[Any], fallback: date) -> date:
    dates = [e.document_date for e in sourced.evidence if e.document_date]
    return max(dates) if dates else fallback


def _number(value: str) -> float | None:
    try:
        return float(value.replace(",", ".").replace(" ", ""))
    except ValueError:
        return None


def _put(resource: Resource) -> dict[str, Any]:
    return {
        "resource": resource,
        "request": {"method": "PUT", "url": f"{resource['resourceType']}/{resource['id']}"},
    }


def transaction(resources: Iterable[Resource]) -> Resource:
    return {"resourceType": "Bundle", "type": "transaction", "entry": [_put(r) for r in resources]}


def document_reference_id(document_id: str) -> str:
    return fhir_id("doc", document_id)


def patient_id(case_id: str) -> str:
    return fhir_id(case_id, "patient")


# --- documents (Q-I10) -----------------------------------------------------------------------


def document_resources(meta: DocumentMeta, data: bytes, text: str) -> list[Resource]:
    """`DocumentReference` + `Binary` (base R4). Without the original bytes (e.g. the seed), the
    parsed text is attached instead."""
    doc_id = document_reference_id(meta.id)
    if data:
        binary: Resource = {
            "resourceType": "Binary",
            "id": doc_id,
            "contentType": meta.mime_type,
            "data": base64.b64encode(data).decode("ascii"),
        }
        attachment = {"contentType": meta.mime_type, "url": f"Binary/{doc_id}", "title": meta.filename}
    else:
        binary = {
            "resourceType": "Binary",
            "id": doc_id,
            "contentType": "text/markdown",
            "data": base64.b64encode(text.encode("utf-8")).decode("ascii"),
        }
        attachment = {"contentType": "text/markdown", "url": f"Binary/{doc_id}", "title": meta.filename}
    reference: Resource = {
        "resourceType": "DocumentReference",
        "id": doc_id,
        "status": "current",
        "type": {"text": meta.doc_type.value},
        "content": [{"attachment": attachment}],
    }
    if meta.title:
        reference["description"] = meta.title
    if meta.received_at:
        reference["date"] = instant(meta.received_at)
    if meta.author:
        reference["author"] = [{"display": meta.author}]
    if meta.facility:
        reference["custodian"] = {"display": meta.facility}
    if meta.document_date:
        reference["context"] = {"period": {"start": meta.document_date.isoformat()}}
    return [binary, reference]


# --- handover --------------------------------------------------------------------------------


class _HandoverMapper:
    """Builds the resources for one handover. `snapshot=True` gives the frozen MDT copy its own
    resource ids, so live updates never touch it (PER-9)."""

    def __init__(self, handover: Handover, case: Case | None, *, snapshot: bool) -> None:
        self.h = handover
        self.case = case
        self.snapshot = snapshot
        self.prefix = fhir_id(handover.case_id, "mdt") if snapshot else fhir_id(handover.case_id)
        self.as_of = _start_of(handover.as_of)
        self.patient: Resource = {}
        self.resources: list[Resource] = []
        self.provenance: list[Resource] = []

    def _id(self, *parts: str) -> str:
        return fhir_id(self.prefix, *parts)

    def _subject(self) -> dict[str, str]:
        return _ref(self.patient)

    def _add(self, resource: Resource, *sources: Sourced[Any]) -> Resource:
        self.resources.append(resource)
        self._provenance_for(resource, sources)
        return resource

    # Provenance (PER-8): AI values with their verbatim evidence; manual entries with who/when.
    def _provenance_for(self, target: Resource, sources: Iterable[Sourced[Any]]) -> None:
        entities: dict[tuple[str, str], dict[str, Any]] = {}
        manual: list[Stamp] = []
        for s in sources:
            if s.origin is Origin.AI:
                for e in s.evidence:
                    entities.setdefault((e.document_id, e.quote), {
                        "role": "source",
                        "what": {
                            "reference": f"DocumentReference/{document_reference_id(e.document_id)}",
                            "display": e.quote,
                        },
                    })
            elif s.entered is not None:
                manual.append(s.entered)
        if entities:
            self.provenance.append(self._provenance(
                fhir_id(target["id"], "ai"), target, "assembler", AI_AGENT, self.as_of,
                list(entities.values()),
            ))
        for stamp in {(m.by, m.at): m for m in manual}.values():
            self.provenance.append(self._provenance(
                fhir_id(target["id"], "manual", stamp.at.strftime("%Y%m%d%H%M%S")),
                target, "author", stamp.by, stamp.at, [],
            ))

    def _provenance(
        self, pid: str, target: Resource, role: str, who: str, at: datetime, entities: list[Any]
    ) -> Resource:
        resource: Resource = {
            "resourceType": "Provenance",
            "id": pid,
            "meta": {"profile": [PROFILE_PROVENANCE]},
            "target": [_ref(target)],
            "recorded": instant(at),
            "agent": [{
                "type": _coding(PARTICIPANT_TYPE, role),
                "who": {"display": who},
            }],
        }
        if entities:
            resource["entity"] = entities
        return resource

    # Resources --------------------------------------------------------------------------------

    def build(self) -> list[Resource]:
        self._patient()
        self._conditions()
        self._vitals()
        self._labs()
        self._histology()
        composition = self._composition()
        return [self.patient, *self.resources, composition, *self.provenance]

    def _patient(self) -> None:
        p = self.h.patient
        c = self.h.contacts
        # The live and the snapshot handover describe the same person: one Patient per case.
        resource: Resource = {
            "resourceType": "Patient",
            "id": patient_id(self.h.case_id),
            "meta": {"profile": [PROFILE_PATIENT]},
        }
        if _found(p.birth_number):
            resource["identifier"] = [{"system": RC_SYSTEM, "value": p.birth_number.value}]
        name: dict[str, Any] = {}
        if _found(p.last_name):
            name["family"] = p.last_name.value
        if _found(p.first_name):
            name["given"] = [p.first_name.value]
        if not name and self.case is not None:
            name["text"] = self.case.patient_name
        if name:
            resource["name"] = [name]
        if _found(p.sex):
            resource["gender"] = _GENDER.get(str(p.sex.value).strip().lower(), "unknown")
        if _found(p.birth_date):
            resource["birthDate"] = p.birth_date.value.isoformat()
        if _found(p.address):
            resource["address"] = [{"text": p.address.value}]
        telecom = []
        if _found(c.patient_phone):
            telecom.append({"system": "phone", "value": c.patient_phone.value})
        if _found(c.patient_email):
            telecom.append({"system": "email", "value": c.patient_email.value})
        if telecom:
            resource["telecom"] = telecom
        self.patient = resource
        self._provenance_for(resource, [
            p.first_name, p.last_name, p.birth_number, p.birth_date, p.sex, p.address,
            c.patient_phone, c.patient_email,
        ])

    def _conditions(self) -> None:
        h = self.h
        if _found(h.diagnosis) or _found(h.diagnosis_code):
            code: dict[str, Any] = {}
            if _found(h.diagnosis_code):
                code["coding"] = [{"system": ICD10_SYSTEM, "code": h.diagnosis_code.value}]
            if _found(h.diagnosis):
                code["text"] = h.diagnosis.value
            self._add({
                "resourceType": "Condition",
                "id": self._id("dx"),
                "meta": {"profile": [PROFILE_CONDITION]},
                "clinicalStatus": _coding(CONDITION_CLINICAL, "active"),
                # Provisional until the MDT conclusion records the definitive code (Q-C9).
                "verificationStatus": _coding(CONDITION_VERIFICATION, "provisional"),
                "category": [_coding(CONDITION_CATEGORY, "problem-list-item")],
                "code": code,
                "subject": self._subject(),
            }, h.diagnosis, h.diagnosis_code)
        if _found(h.comorbidities):
            for i, text in enumerate(h.comorbidities.value):
                self._add({
                    "resourceType": "Condition",
                    "id": self._id("oa", str(i + 1)),
                    "meta": {"profile": [PROFILE_CONDITION]},
                    "clinicalStatus": _coding(CONDITION_CLINICAL, "active"),
                    "category": [_coding(CONDITION_CATEGORY, "problem-list-item")],
                    "code": {"text": text},
                    "subject": self._subject(),
                }, h.comorbidities)

    def _vitals(self) -> None:
        for key, sourced, loinc, display, unit, profile in (
            ("weight", self.h.weight_kg, "29463-7", "Body weight", "kg", PROFILE_BODY_WEIGHT),
            ("height", self.h.height_cm, "8302-2", "Body height", "cm", PROFILE_BODY_HEIGHT),
        ):
            if not _found(sourced):
                continue  # a missing value is a Finding, never a placeholder (PER-7)
            self._add({
                "resourceType": "Observation",
                "id": self._id(key),
                "meta": {"profile": [profile]},
                "status": "final",
                "category": [_coding(OBS_CATEGORY, "vital-signs", "Vital Signs")],
                "code": _coding(LOINC, loinc, display),
                "subject": self._subject(),
                "effectiveDateTime": _evidence_date(sourced, self.h.as_of).isoformat(),
                "valueQuantity": {"value": sourced.value, "unit": unit, "system": UCUM, "code": unit},
            }, sourced)
        ps = self.h.performance_status
        if _found(ps):
            self._add({
                "resourceType": "Observation",
                "id": self._id("performance-status"),
                "status": "final",
                "code": {"text": "Výkonnostní stav (ECOG / Karnofsky)"},
                "subject": self._subject(),
                "effectiveDateTime": _evidence_date(ps, self.h.as_of).isoformat(),
                "valueString": ps.value,
            }, ps)

    def _labs(self) -> None:
        for i, panel in enumerate(self.h.labs, start=1):
            results = []
            for j, lab in enumerate(panel.values, start=1):
                obs: Resource = {
                    "resourceType": "Observation",
                    "id": self._id("lab", str(i), str(j)),
                    "meta": {"profile": [PROFILE_LAB_RESULT]},
                    "status": "final",
                    "category": [_coding(OBS_CATEGORY, "laboratory", "Laboratory")],
                    "code": {"text": lab.name},
                    "subject": self._subject(),
                    "effectiveDateTime": panel.date.isoformat(),
                }
                number = _number(lab.value)
                if number is not None:
                    obs["valueQuantity"] = {"value": number, **({"unit": lab.unit} if lab.unit else {})}
                else:
                    obs["valueString"] = f"{lab.value} {lab.unit}".strip() if lab.unit else lab.value
                if lab.reference_range:
                    obs["referenceRange"] = [{"text": lab.reference_range}]
                if lab.flag:
                    flag = lab.flag.strip().upper()
                    obs["interpretation"] = [
                        _coding(INTERPRETATION, flag) if flag in _INTERPRETATIONS else {"text": lab.flag}
                    ]
                self.resources.append(obs)
                results.append(_ref(obs))
            report: Resource = {
                "resourceType": "DiagnosticReport",
                "id": self._id("lab", str(i)),
                "meta": {"profile": [PROFILE_LAB_REPORT]},
                "status": "final",
                "category": [_coding(V2_0074, "LAB", "Laboratory")],
                "code": {"text": "Laboratorní vyšetření"},
                "subject": self._subject(),
                "effectiveDateTime": panel.date.isoformat(),
                "performer": [{"display": panel.place}],
                "result": results,
            }
            self.resources.append(report)
            self._provenance_for(report, [_panel_source(panel.origin, panel.evidence, panel.entered)])

    def _histology(self) -> None:
        histo = self.h.histology
        if not _found(histo):
            return
        effective = _evidence_date(histo, self.h.as_of).isoformat()
        obs = self._add({
            "resourceType": "Observation",
            "id": self._id("histology", "result"),
            "meta": {"profile": [PROFILE_RESULT]},
            "status": "final",
            "code": {"text": "Histologie"},
            "subject": self._subject(),
            "effectiveDateTime": effective,
            "valueString": histo.value,
        }, histo)
        self._add({
            "resourceType": "DiagnosticReport",
            "id": self._id("histology"),
            "meta": {"profile": [PROFILE_REPORT]},
            "status": "final",
            "category": [_coding(V2_0074, "PAT", "Pathology")],
            "code": {"text": "Histologie"},
            "subject": self._subject(),
            "effectiveDateTime": effective,
            "conclusion": histo.value,
            "result": [_ref(obs)],
        }, histo)

    def _composition(self) -> Resource:
        h = self.h
        stamp = h.confirmed_by_coordinator if self.snapshot else h.validated_by_referrer
        refs = {r["id"]: _ref(r) for r in self.resources}

        def entries(*ids: str) -> list[dict[str, str]]:
            return [refs[i] for i in ids if i in refs]

        sections: list[dict[str, Any]] = []

        def section(title: str, text: str | None, entry: list[dict[str, str]] | None = None) -> None:
            if not text and not entry:
                return
            item: dict[str, Any] = {"title": title, "text": _narrative(text or title)}
            if entry:
                item["entry"] = entry
            sections.append(item)

        def value(s: Sourced[Any]) -> str | None:
            if not _found(s):
                return None
            return "\n".join(s.value) if isinstance(s.value, list) else str(s.value)

        oa_ids = [r["id"] for r in self.resources if r["id"].startswith(self._id("oa"))]
        lab_ids = [r["id"] for r in self.resources if r["resourceType"] == "DiagnosticReport"
                   and r["id"].startswith(self._id("lab"))]
        exams = "\n\n".join(f"{e.date.isoformat()} – {e.type} ({e.place})\n{e.result_full_text}"
                            for e in h.examinations)

        section("Diagnóza", value(h.diagnosis), entries(self._id("dx")))
        section("Epikríza", value(h.epicrisis) or value(h.epicrisis_source))
        section("Požadavek / otázka na MDT", value(h.mdt_question))
        section("Komorbidity (OA)", value(h.comorbidities), entries(*oa_ids))
        section("Farmakologická anamnéza (FA)", value(h.medications))
        section("Alergie (AA)", value(h.allergies))
        section("Výkonnostní stav", value(h.performance_status), entries(self._id("performance-status")))
        section("Hmotnost a výška", None, entries(self._id("weight"), self._id("height")))
        section("Symptomy", value(h.symptoms))
        section("Provedená vyšetření", exams or None)
        section("Laboratoř", None, entries(*lab_ids))
        section("Histologie", value(h.histology), entries(self._id("histology")))
        section("Jiná sdělení", value(h.other))

        author = self.case.referring_doctor_id if self.case else AI_AGENT
        composition: Resource = {
            "resourceType": "Composition",
            "id": self._id("handover"),
            "meta": {"profile": [PROFILE_COMPOSITION]},
            "status": "final" if stamp else "preliminary",
            "type": {"text": "Podklad pro MDT" if self.snapshot else "Předávací dokumentace"},
            "subject": self._subject(),
            "date": instant(stamp.at if stamp else self.as_of),
            "author": [{"display": author}],
            "title": ("Podklad pro MDT" if self.snapshot else "Předávací dokumentace")
            + f" k {h.as_of.isoformat()}",
            "section": sections,
        }
        self._provenance_for(composition, [
            h.epicrisis_source, h.epicrisis, h.mdt_question, h.medications, h.allergies, h.symptoms,
            h.other, *(_panel_source(e.origin, e.evidence, e.entered) for e in h.examinations),
        ])
        for key, signed, role in (
            ("validated", h.validated_by_referrer, "verifier"),
            ("confirmed", h.confirmed_by_coordinator, "verifier"),
        ):
            if signed is not None:  # a human sign-off is its own Provenance (PER-8)
                self.provenance.append(self._provenance(
                    fhir_id(composition["id"], key), composition, role, signed.by, signed.at, []
                ))
        return composition


def _panel_source(origin: Origin, evidence: list[Any], entered: Stamp | None) -> Sourced[Any]:
    """Examinations and lab panels carry provenance directly; view it as a `Sourced` for reuse."""
    return Sourced[Any].model_construct(
        value=None, status=FieldStatus.FOUND, origin=origin, evidence=evidence, entered=entered
    )


def handover_resources(handover: Handover, case: Case | None, *, snapshot: bool) -> list[Resource]:
    """Patient (RČ), Condition, Observation, DiagnosticReport, Composition and Provenance."""
    return _HandoverMapper(handover, case, snapshot=snapshot).build()


# --- client ----------------------------------------------------------------------------------


class FhirClient:
    """Minimal FHIR REST client for the IRIS FHIR server (basic auth, Q-I4/Q-I5)."""

    def __init__(
        self,
        base_url: str,
        username: str | None = None,
        password: str | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        auth = (username, password or "") if username else None
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            auth=auth,
            timeout=30.0,
            headers={"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"},
            transport=transport,
        )

    def transaction(self, bundle: Resource) -> Resource:
        response = self._http.post("", json=bundle)
        response.raise_for_status()
        return response.json()

    def read(self, resource_type: str, resource_id: str) -> Resource | None:
        response = self._http.get(f"/{resource_type}/{resource_id}")
        if response.status_code in (404, 410):
            return None
        response.raise_for_status()
        return response.json()

    def close(self) -> None:
        self._http.close()


class FhirProjector:
    """Pushes the FHIR projection of what the repository saves."""

    def __init__(self, client: FhirClient) -> None:
        self.client = client

    @classmethod
    def from_settings(cls, settings: IrisSettings) -> FhirProjector:
        if settings.fhir_base_url is None:
            raise RuntimeError("Set ONKO_FHIR_BASE_URL in .env")
        password = settings.fhir_password.get_secret_value() if settings.fhir_password else None
        return cls(FhirClient(settings.fhir_base_url, settings.fhir_username, password))

    def project_document(self, meta: DocumentMeta, data: bytes, text: str) -> None:
        self.client.transaction(transaction(document_resources(meta, data, text)))

    def project_handover(self, handover: Handover, case: Case | None, *, snapshot: bool) -> None:
        self.client.transaction(transaction(handover_resources(handover, case, snapshot=snapshot)))
