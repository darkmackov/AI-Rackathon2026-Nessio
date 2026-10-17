"""Normalized values next to the verbatim evidence (Q-C13), by deterministic code only.

The quote stays the evidence; what changes is the value: identifiers in one canonical form, weight
and height in kg / cm, lab values with a number, comparator and UCUM unit, performance status as
scale + score. A function returns None when it can't normalize a value: the caller keeps the raw
form and the `Normalization` check raises a finding. Nothing is guessed.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

from onko_contracts import (
    Comparator,
    FieldStatus,
    Handover,
    LabValue,
    PerformanceScale,
    PerformanceScore,
)

# --- identifiers ------------------------------------------------------------------------------


def birth_number(raw: str) -> str | None:
    """Rodné číslo as `YYMMDD/XXXX` (`YYMMDD/XXX` before 1954), else None."""
    if not re.fullmatch(r"\s*\d{6}\s*/?\s*\d{3,4}\s*", raw):
        return None
    digits = re.sub(r"\D", "", raw)
    return f"{digits[:6]}/{digits[6:]}"


def birth_number_valid(canonical: str) -> bool:
    """The check digit of a 10-digit RČ: the number is divisible by 11, or the first nine digits
    leave 10 and the last digit is 0. A 9-digit RČ (before 1954) has none."""
    digits = canonical.replace("/", "")
    if len(digits) == 9:
        return True
    rest = int(digits[:9]) % 11
    return int(digits) % 11 == 0 or (rest == 10 and digits[9] == "0")


def phone(raw: str) -> str | None:
    """E.164, `+420…` for a Czech number written without a country code, else None."""
    compact = re.sub(r"[\s\-./()]", "", raw)
    if compact.startswith("00"):
        compact = "+" + compact[2:]
    if re.fullmatch(r"[2-9]\d{8}", compact):
        return "+420" + compact
    if re.fullmatch(r"\+[1-9]\d{7,14}", compact):
        return compact
    return None


def email(raw: str) -> str | None:
    value = raw.strip().casefold()
    return value if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value) else None


def insurer_code(raw: str) -> str | None:
    """The 3-digit code of a Czech health insurer (111 = VZP), else None."""
    value = raw.strip()
    return value if re.fullmatch(r"\d{3}", value) else None


IDENTIFIERS = {
    "patient.birth_number": birth_number,
    "patient.insurance_code": insurer_code,
    "contacts.patient_phone": phone,
    "contacts.contact_person_phone": phone,
    "contacts.patient_email": email,
}


# --- weight and height ------------------------------------------------------------------------

_NUMBER = r"(\d+(?:[.,]\d+)?)"
_LENGTH = {"m": 100.0, "cm": 1.0, "mm": 0.1}
_MASS = {"kg": 1.0, "g": 0.001}


def _number(text: str) -> float | None:
    m = re.search(_NUMBER, text)
    return float(m.group(1).replace(",", ".")) if m else None


def _unit(value: str, quotes: Iterable[str], units: dict[str, float]) -> str | None:
    """The unit printed right after the value's number, in the value or else in a quote."""
    number = re.search(_NUMBER, value)
    if number is None:
        return None
    pattern = re.escape(number.group(1)) + r"\s*(" + "|".join(sorted(units, key=len, reverse=True)) + r")\b"
    for text in (value, *quotes):
        if m := re.search(pattern, text, re.IGNORECASE):
            return m.group(1).lower()
    return None


def height_cm(value: str, quotes: Iterable[str] = ()) -> float | None:
    """`1,65 m` -> 165. A bare number under 3 can only be metres."""
    n = _number(value)
    if n is None:
        return None
    unit = _unit(value, quotes, _LENGTH)
    if unit is None and n < 3:
        unit = "m"
    return round(n * _LENGTH[unit or "cm"], 1)


def weight_kg(value: str, quotes: Iterable[str] = ()) -> float | None:
    n = _number(value)
    if n is None:
        return None
    return round(n * _MASS[_unit(value, quotes, _MASS) or "kg"], 3)


# --- lab values -------------------------------------------------------------------------------

_COMPARATORS = {"<": Comparator.LT, "<=": Comparator.LE, "≤": Comparator.LE,
                ">": Comparator.GT, ">=": Comparator.GE, "≥": Comparator.GE}
_LAB_NUMBER = re.compile(r"\s*(<=|>=|≤|≥|<|>)?\s*([+-]?\d{1,3}(?:[  ]\d{3})+|[+-]?\d+)([.,]\d+)?\s*")
_SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")

# Units as Czech labs print them (casefolded, µ as u, no spaces) -> UCUM
_UCUM = {
    "mol/l": "mol/L", "mmol/l": "mmol/L", "umol/l": "umol/L", "nmol/l": "nmol/L",
    "pmol/l": "pmol/L", "mmol/mol": "mmol/mol",
    "g/l": "g/L", "mg/l": "mg/L", "ug/l": "ug/L", "ng/l": "ng/L",
    "g/dl": "g/dL", "mg/dl": "mg/dL", "ng/ml": "ng/mL", "ug/ml": "ug/mL", "pg/ml": "pg/mL",
    "u/l": "U/L", "ku/l": "kU/L", "mu/l": "mU/L", "u/ml": "U/mL", "ku/ml": "kU/mL",
    "iu/l": "[IU]/L", "kiu/l": "k[IU]/L", "miu/l": "m[IU]/L", "iu/ml": "[IU]/mL",
    "ukat/l": "ukat/L", "nkat/l": "nkat/L",
    "10^9/l": "10*9/L", "10^12/l": "10*12/L", "10^6/l": "10*6/L",
    "%": "%", "fl": "fL", "pg": "pg", "s": "s", "min": "min", "mm/h": "mm/h", "1": "1",
    "ml/s": "mL/s", "ml/min": "mL/min", "mosm/kg": "mosm/kg",
    "ml/s/1,73m2": "mL/s/{1.73_m2}", "ml/s/1.73m2": "mL/s/{1.73_m2}",
    "ml/min/1,73m2": "mL/min/{1.73_m2}", "ml/min/1.73m2": "mL/min/{1.73_m2}",
}
# Giga / tera per litre, the Czech way of writing cell counts; case matters (g/l is grams)
_CELL_COUNTS = {"G/l": "10*9/L", "G/L": "10*9/L", "T/l": "10*12/L", "T/L": "10*12/L"}


def lab_number(value: str) -> tuple[float, Comparator | None] | None:
    """`< 0,5` -> (0.5, <), `1 250` -> 1250; None for anything but a (compared) number."""
    m = _LAB_NUMBER.fullmatch(value)
    if m is None:
        return None
    whole = re.sub(r"[  ]", "", m.group(2))
    number = float(whole + (m.group(3) or "").replace(",", "."))
    return number, _COMPARATORS.get(m.group(1) or "")


def ucum(unit: str) -> str | None:
    if (cells := _CELL_COUNTS.get(unit.strip())) is not None:
        return cells
    # 10⁹/l -> 10^9/l before NFKC turns the superscript into a plain digit (m² -> m2 is fine)
    key = re.sub(r"10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)", lambda m: "10^" + m.group(1).translate(_SUPERSCRIPTS), unit)
    key = unicodedata.normalize("NFKC", key)
    key = re.sub(r"\s+", "", key).replace("µ", "u").replace("μ", "u").casefold()
    key = re.sub(r"^(?:x|×|\*)?10(?:\^|\*|e)(\d+)/", r"10^\1/", key)
    return _UCUM.get(key)


def lab_value(value: LabValue) -> LabValue:
    """`value` with `number`, `comparator` and `ucum` filled in where they can be."""
    parsed = lab_number(value.value)
    return value.model_copy(update={
        "number": parsed[0] if parsed else None,
        "comparator": parsed[1] if parsed else None,
        "ucum": ucum(value.unit) if value.unit else None,
    })


def lab_unnormalized(value: LabValue) -> bool:
    """A number the code couldn't read, or a printed unit it doesn't know. A qualitative result
    without a unit (`pozitivní`) is fine as text."""
    looks_numeric = bool(re.match(r"\s*(<=|>=|≤|≥|<|>)?\s*[+-]?\d", value.value))
    return (looks_numeric and value.number is None) or (bool(value.unit) and value.ucum is None)


# --- performance status -----------------------------------------------------------------------

_ECOG = re.compile(r"\b(?:ECOG|WHO|Zubrod|PS)\b(?:\s*(?:PS|stupe[nň]|grade))?\s*[:=]?\s*([0-5])\b(?!\s*[-–]\s*\d)",
                   re.IGNORECASE)
_KARNOFSKY = re.compile(r"\b(?:Karnofsk[yý]|KPS|KI)\b(?:\s*(?:index|skóre))?\s*[:=]?\s*(\d{1,3})\s*%?",
                        re.IGNORECASE)


def performance(value: str) -> PerformanceScore | None:
    """`ECOG 1`, `PS 2`, `WHO 0`, `Karnofsky 80 %` -> scale + score. A range (`ECOG 1-2`) or two
    different scores is not one score: None."""
    ecog = {int(m.group(1)) for m in _ECOG.finditer(value)}
    karnofsky = {int(m.group(1)) for m in _KARNOFSKY.finditer(value)}
    karnofsky = {k for k in karnofsky if k <= 100 and k % 10 == 0}
    if len(ecog) == 1 and not karnofsky:
        return PerformanceScore(scale=PerformanceScale.ECOG, score=ecog.pop())
    if len(karnofsky) == 1 and not ecog:
        return PerformanceScore(scale=PerformanceScale.KARNOFSKY, score=karnofsky.pop())
    return None


# --- the whole handover -----------------------------------------------------------------------


def normalize_handover(handover: Handover) -> Handover:
    """The values computed next to the printed ones: lab numbers and units, the performance
    score. Runs on every extraction, after people's manual values were kept."""
    ps = handover.performance_status
    score = performance(ps.value) if ps.status is FieldStatus.FOUND and ps.value else None
    labs = [panel.model_copy(update={"values": [lab_value(v) for v in panel.values]})
            for panel in handover.labs]
    return handover.model_copy(update={"performance_score": score, "labs": labs})
