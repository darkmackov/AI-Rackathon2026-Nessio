"""Czech text for `AuditEvent.detail` (api.md › Audit: "detail is Czech text"). The labels are the
ones the web shows for the same fields and values (its translations and the MSW mock's
`auditDetail`), so the audit tab reads the same in mock and real mode (Q-W15)."""

from __future__ import annotations

import datetime as dt
import enum
from collections.abc import Iterable, Mapping

STATES = {
    "koncept": "Koncept", "odeslano": "Odesláno", "v_triage": "V triage",
    "ceka_na_podklady": "Čeká na podklady", "kompletni": "Kompletní",
    "pripraveno_k_mdt": "Připraveno k MDT", "zaver_mdt": "Závěr KOC / MDT",
    "zpetna_vazba_odeslana": "Zpětná vazba odeslána", "uzavreno": "Uzavřeno",
    "vraceno_lekari": "Vráceno lékaři",
}
RESOLUTIONS = {"resolved": "Doplněno / vyřešeno", "overridden": "Překonáno s poznámkou", "dismissed": "Zamítnuto"}
CONCLUSION_SOURCES = {"written": "Zapsáno v aplikaci", "uploaded": "Nahraný závěr"}

# Case, milestone and task fields.
LABELS = {
    "priority": "Priorita", "coordinator_id": "Koordinátor", "mdt_board_id": "MDT tým",
    "mdt_date": "Plánované MDT", "symptom_onset": "Začátek obtíží", "treatment_start": "Zahájení léčby",
    "title": "Název", "status": "Stav", "owner": "Odpovědnost", "location": "Místo", "due": "Termín",
    "depends_on": "Předchozí úkoly", "external": "Mimo KOC", "result_document_id": "Výsledný dokument",
}
DOCUMENT_LABELS = {
    "title": "Název dokumentu", "doc_type": "Typ dokumentu", "document_date": "Datum dokumentu",
    "facility": "Pracoviště", "department": "Oddělení", "author": "Autor",
    "ordered_by": "Indikující / odesílající lékař",
}
MDT_RECORD_LABELS = {
    "members": "Členové MDT", "results": "Výsledky stávajících vyšetření", "mdt_question": "Otázka na MDT",
    "diagnosis_name": "Název diagnózy", "diagnosis_code": "Kód diagnózy (MKN-10)", "comorbidities": "Komorbidity",
}
HANDOVER_LABELS = {
    "patient.first_name": "Jméno", "patient.last_name": "Příjmení", "patient.birth_number": "Rodné číslo",
    "patient.birth_date": "Datum narození", "patient.age": "Věk", "patient.sex": "Pohlaví",
    "patient.insurance_code": "Zdravotní pojišťovna", "patient.address": "Adresa",
    "contacts.patient_phone": "Telefon pacienta", "contacts.patient_email": "E-mail pacienta",
    "contacts.contact_person": "Kontaktní osoba", "contacts.contact_person_phone": "Telefon kontaktní osoby",
    "diagnosis": "Diagnóza", "diagnosis_code": "MKN-10", "epicrisis_source": "Epikríza odesílajícího lékaře",
    "epicrisis": "Souhrn epikrízy", "mdt_question": "Otázka na MDT", "comorbidities": "Komorbidity (OA)",
    "medications": "Léková anamnéza (FA)", "allergies": "Alergie (AA)", "performance_status": "Stav výkonnosti",
    "weight_kg": "Hmotnost (kg)", "height_cm": "Výška (cm)", "symptoms": "Příznaky a jejich počátek",
    "histology": "Histologie", "other": "Další sdělení",
}
VALUES: dict[str, dict[str, str]] = {
    "priority": {"normal": "Běžná", "high": "Vysoká", "urgent": "Urgentní"},
    "status": {"planned": "Plánováno", "booked": "Objednáno", "done": "Dokončeno", "cancelled": "Zrušeno"},
    "doc_type": {
        "referral": "Žádanka", "epicrisis": "Epikríza", "outpatient_report": "Ambulantní zpráva",
        "lab": "Laboratorní výsledek", "imaging": "Zobrazovací vyšetření", "procedure": "Výkon",
        "histology": "Histologie", "mdt_record": "Zápis MDT", "mdt_conclusion": "Závěr MDT", "other": "Jiný dokument",
    },
}
# Fields holding directory, task or document ids, shown by name.
ID_FIELDS = {"coordinator_id", "mdt_board_id", "owner", "depends_on", "result_document_id"}
UNCHANGED = "beze změny"


def date(value: dt.date) -> str:
    """`22. 10. 2026`, or `24. 10. 2026 10:00` for a datetime."""
    text = f"{value.day}. {value.month}. {value.year}"
    return f"{text} {value.hour}:{value.minute:02d}" if isinstance(value, dt.datetime) else text


def transition(before: str | None, after: str | None) -> str:
    """`Kompletní → Připraveno k MDT`."""
    return f"{_state(before)} → {_state(after)}"


def with_note(text: str, note: str | None) -> str:
    return f"{text}: {note}" if note else text


def changed(changes: Mapping[str, object], names: Mapping[str, str] | None = None,
            labels: Mapping[str, str] = LABELS) -> str:
    """`Priorita: Vysoká, Plánované MDT: 22. 10. 2026`; ids in `names` are shown by name."""
    return ", ".join(f"{labels.get(k, k)}: {_value(k, v, names or {})}" for k, v in changes.items()) or UNCHANGED


def fields(keys: Iterable[str], labels: Mapping[str, str]) -> str:
    """The changed fields' labels: `Členové MDT, Komorbidity`."""
    return ", ".join(labels.get(k, k) for k in keys) or UNCHANGED


def quoted(text: str) -> str:
    return f"„{text}“"


def _state(value: str | None) -> str:
    value = getattr(value, "value", value)
    return STATES.get(value, value) if value else "neuvedeno"


def _value(key: str, value: object, names: Mapping[str, str]) -> str:
    if value is None:
        return "neuvedeno"
    if isinstance(value, bool):
        return "Ano" if value else "Ne"
    if isinstance(value, list | tuple):
        return ", ".join(_value(key, v, names) for v in value) or "žádné"
    if isinstance(value, dt.date):
        return date(value)
    if isinstance(value, enum.Enum):
        value = value.value
    text = str(value)
    if key in ID_FIELDS:
        return names.get(text, text)
    return VALUES.get(key, {}).get(text, text)
