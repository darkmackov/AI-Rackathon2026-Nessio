"""Structured MDT handover, following the challenge's Handover_obsah.

The structure is fixed product schema (versioned here), not user config.
Every leaf value is `Sourced`, so the UI can show its source, status and a "Doplnit / Vyžádat" action.
"""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import Field

from .common import Evidence, Model, Origin, Sourced, Stamp

HANDOVER_SCHEMA_VERSION = "2"  # 2: normalized lab values and performance score (Q-C13)


class Comparator(StrEnum):
    """A comparator printed before a lab number, e.g. `< 0,5`."""

    LT = "<"
    LE = "<="
    GT = ">"
    GE = ">="


class PerformanceScale(StrEnum):
    ECOG = "ecog"  # also printed as WHO / Zubrod performance status, 0-5
    KARNOFSKY = "karnofsky"  # 0-100 %


class PerformanceScore(Model):
    """`performance_status` as scale + score (Q-C13)."""

    scale: PerformanceScale
    score: int


class PatientDetails(Model):
    """Nacionále pacienta."""

    first_name: Sourced[str] = Field(default_factory=Sourced)
    last_name: Sourced[str] = Field(default_factory=Sourced)
    birth_number: Sourced[str] = Field(default_factory=Sourced, description="Rodné číslo")
    birth_date: Sourced[dt.date] = Field(default_factory=Sourced)
    age: Sourced[int] = Field(default_factory=Sourced)
    sex: Sourced[str] = Field(default_factory=Sourced)
    insurance_code: Sourced[str] = Field(default_factory=Sourced, description="Kód zdravotní pojišťovny, e.g. 111 = VZP, 211 = ZPMV")
    address: Sourced[str] = Field(default_factory=Sourced)


class Contacts(Model):
    patient_phone: Sourced[str] = Field(default_factory=Sourced)
    patient_email: Sourced[str] = Field(default_factory=Sourced)
    contact_person: Sourced[str] = Field(default_factory=Sourced, description="Name + relation")
    contact_person_phone: Sourced[str] = Field(default_factory=Sourced)


class Examination(Model):
    """Provedené vyšetření: date, place, type, full result text.

    `result_full_text` = all clinical sections verbatim (findings, ZÁVĚR, DOPORUČENÍ), without the
    administrative header and signature (Q-C8). GP examinations are included too (Q-C7).
    """

    date: dt.date
    place: str
    type: str
    result_full_text: str
    origin: Origin = Origin.AI
    evidence: list[Evidence] = Field(default_factory=list)
    entered: Stamp | None = None


class LabValue(Model):
    """`value` and `unit` stay as printed; `number`, `comparator` and `ucum` are computed next to
    them by deterministic code (Q-C13), None when they can't be (a qualitative or unparsed value)."""

    name: str
    value: str
    unit: str | None = None
    reference_range: str | None = None
    flag: str | None = Field(default=None, description="H / L as printed by the lab")
    number: float | None = Field(default=None, description="`value` as a number (decimal comma read)")
    comparator: Comparator | None = Field(default=None, description="Printed before the number")
    ucum: str | None = Field(default=None, description="`unit` as a UCUM code, e.g. 'mmol/L'")


class LabPanel(Model):
    date: dt.date
    place: str
    values: list[LabValue]
    origin: Origin = Origin.AI
    evidence: list[Evidence] = Field(default_factory=list)
    entered: Stamp | None = None


class Handover(Model):
    schema_version: str = HANDOVER_SCHEMA_VERSION
    case_id: str
    as_of: dt.date = Field(description="Snapshot date; only documents received by then are used")

    patient: PatientDetails = Field(default_factory=PatientDetails)
    contacts: Contacts = Field(default_factory=Contacts)
    diagnosis: Sourced[str] = Field(default_factory=Sourced)
    diagnosis_code: Sourced[str] = Field(default_factory=Sourced, description="MKN-10 / ICD-10")
    epicrisis_source: Sourced[str] = Field(
        default_factory=Sourced, description="Referring doctor's epikríza, verbatim (Q-F15)"
    )
    epicrisis: Sourced[str] = Field(
        default_factory=Sourced,
        description="Final epikríza: AI summary proposal shown side by side, written/confirmed by the coordinator",
    )
    mdt_question: Sourced[str] = Field(
        default_factory=Sourced,
        description="Požadavek / otázka na MDT; written by the coordinator, optional AI prefill (Q-F14)",
    )
    comorbidities: Sourced[list[str]] = Field(default_factory=Sourced, description="OA")
    medications: Sourced[list[str]] = Field(default_factory=Sourced, description="FA")
    allergies: Sourced[str] = Field(default_factory=Sourced, description="AA")
    performance_status: Sourced[str] = Field(default_factory=Sourced, description="ECOG / Karnofsky")
    performance_score: PerformanceScore | None = Field(
        default=None,
        description="`performance_status` read as scale + score by deterministic code (Q-C13); "
        "None while it is missing or can't be read",
    )
    weight_kg: Sourced[float] = Field(default_factory=Sourced)
    height_cm: Sourced[float] = Field(default_factory=Sourced)
    symptoms: Sourced[str] = Field(default_factory=Sourced, description="Symptoms and their onset")
    examinations: list[Examination] = Field(default_factory=list)
    labs: list[LabPanel] = Field(default_factory=list, description="Including tumour markers")
    histology: Sourced[str] = Field(default_factory=Sourced)
    other: Sourced[str] = Field(default_factory=Sourced, description="Jiná sdělení incl. patient wishes")

    validated_by_referrer: Stamp | None = Field(
        default=None, description="Referring doctor validated the AI proposal before sending (Q-F5)"
    )
    confirmed_by_coordinator: Stamp | None = Field(
        default=None, description="Coordinator confirmed the MDT snapshot (Q-F5, Q-F21)"
    )
