"""DTOs for the handover. Mirror `onko_contracts.handover`."""

from __future__ import annotations

import datetime as dt

from pydantic import Field

from .common import Dto, EvidenceDto, SourcedDto, StampDto


class PatientDetailsDto(Dto):
    first_name: SourcedDto[str]
    last_name: SourcedDto[str]
    birth_number: SourcedDto[str] = Field(description="Rodné číslo")
    birth_date: SourcedDto[dt.date]
    age: SourcedDto[int]
    sex: SourcedDto[str]
    insurance_code: SourcedDto[str]
    address: SourcedDto[str]


class ContactsDto(Dto):
    patient_phone: SourcedDto[str]
    patient_email: SourcedDto[str]
    contact_person: SourcedDto[str]
    contact_person_phone: SourcedDto[str]


class ExaminationDto(Dto):
    date: dt.date
    place: str
    type: str
    result_full_text: str
    evidence: list[EvidenceDto]


class LabValueDto(Dto):
    name: str
    value: str
    unit: str | None
    reference_range: str | None
    flag: str | None


class LabPanelDto(Dto):
    date: dt.date
    place: str
    values: list[LabValueDto]
    evidence: list[EvidenceDto]


class HandoverDto(Dto):
    schema_version: str
    case_id: str
    as_of: dt.date

    patient: PatientDetailsDto
    contacts: ContactsDto
    diagnosis: SourcedDto[str]
    diagnosis_code: SourcedDto[str] = Field(description="MKN-10 / ICD-10")
    epicrisis_source: SourcedDto[str] = Field(description="Referring doctor's epikríza, verbatim")
    epicrisis: SourcedDto[str] = Field(description="Final epikríza confirmed by the coordinator")
    mdt_question: SourcedDto[str]
    comorbidities: SourcedDto[list[str]]
    medications: SourcedDto[list[str]]
    allergies: SourcedDto[str]
    performance_status: SourcedDto[str] = Field(description="ECOG / Karnofsky")
    weight_kg: SourcedDto[float]
    height_cm: SourcedDto[float]
    symptoms: SourcedDto[str]
    examinations: list[ExaminationDto]
    labs: list[LabPanelDto]
    histology: SourcedDto[str]
    other: SourcedDto[str]

    validated_by_referrer: StampDto | None
    confirmed_by_coordinator: StampDto | None
