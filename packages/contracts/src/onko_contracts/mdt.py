"""MDT board, MDT record (MDT_zapis) and MDT conclusion (MDT_zaver)."""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import Field

from .common import Model, Stamp


class MdtMember(Model):
    name: str
    specialty: str
    actor_id: str | None = None


class MdtBoard(Model):
    """A roster per MDT board, edited by the coordinator, pre-filled per session (Q-F13)."""

    id: str
    name: str
    organization_id: str
    members: list[MdtMember] = Field(default_factory=list)


class MdtResultRow(Model):
    date: dt.date
    examination: str
    result: str


class MdtRecord(Model):
    """Zápis k jednání MDT, sections 1–5 of MDT_zapis, built from the frozen handover snapshot.
    Values missing in the snapshot stay None (rendered as 'neuvedeno')."""

    case_id: str
    mdt_date: dt.date
    board_id: str
    members: list[MdtMember]
    # 1 Základní údaje
    patient_name: str | None = None
    insurance_code: str | None = None
    patient_phone: str | None = None
    patient_email: str | None = None
    patient_address: str | None = None
    weight_kg: float | None = None
    height_cm: float | None = None
    referring_doctor_name: str | None = None
    referring_doctor_phone: str | None = None
    referring_doctor_email: str | None = None
    # 3 Diagnóza, 4 Komorbidity, 5 Výsledky
    diagnosis_name: str | None = None
    diagnosis_code: str | None = None
    comorbidities: list[str] = Field(default_factory=list)
    results: list[MdtResultRow] = Field(default_factory=list)
    mdt_question: str | None = None
    created: Stamp


class ConclusionSource(StrEnum):
    WRITTEN = "written"  # written in the app (optionally from an AI draft)
    UPLOADED = "uploaded"  # the MDT's own report uploaded as a document


class ConclusionPrefill(Model):
    """The `mdt_conclusion` draft (S5, Q-F37): not AI, only the `MDT_zaver` parts that restate the
    MDT record. The MDT's decision (assessment, conclusion, recommendations) is never prefilled."""

    diagnosis_name: str | None = None
    diagnosis_code: str | None = None
    date: dt.date | None = Field(default=None, description="The MDT date")
    place: str | None = Field(default=None, description="The KOC's town")
    copy_to: list[str] = Field(default_factory=list, description="The referring doctor")


class MdtConclusion(Model):
    """Závěr MDT (MDT_zaver layout), recorded by the coordinator (Q-F12, Q-F21)."""

    case_id: str
    source: ConclusionSource = ConclusionSource.WRITTEN
    document_id: str | None = Field(default=None, description="Uploaded report (source=uploaded)")
    presented_by: str | None = Field(default=None, description="Případ prezentoval")
    diagnosis_name: str | None = None
    diagnosis_code: str | None = Field(default=None, description="Definitive MKN-10 (resolves F05-type findings)")
    clinical_assessment: str | None = None
    conclusion: str | None = None
    recommendations: list[str] = Field(default_factory=list)
    place: str | None = None
    date: dt.date | None = None
    chair: str | None = Field(default=None, description="Předsedající MDT")
    copy_to: list[str] = Field(default_factory=list)
    ai_draft_used: bool = False
    confirmed: Stamp | None = Field(default=None, description="Coordinator confirmed; required to send")
