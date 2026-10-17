"""Normalization next to the verbatim evidence (Q-C13): identifiers, kg / cm, lab values,
performance status, and the check that flags what could not be normalized."""

from __future__ import annotations

import datetime as dt

from ai_testkit import NOW, claim, make_doc, out
from onko_ai import CheckContext, Extraction, build_checks, check, locate, merge, normalize_handover
from onko_ai.models import FieldPath
from onko_ai.service import normalize
from onko_contracts import (
    Comparator,
    DocumentType,
    FieldStatus,
    FindingKind,
    Handover,
    LabPanel,
    LabValue,
    Origin,
    PerformanceScale,
    PerformanceScore,
    Sourced,
    Stamp,
)

D1 = dt.date(2026, 9, 1)


def _merged(text: str, *claims, doc_type: DocumentType = DocumentType.OUTPATIENT_REPORT) -> Handover:
    doc = make_doc("a", text, D1, doc_type)
    return merge("case", D1, [Extraction(doc, out(*claims))])


def test_identifiers_are_stored_in_canonical_form_with_the_verbatim_quote():
    h = _merged(
        "RČ: 7054021238, tel. 603 123 456, e-mail: Jana.Novakova@Example.cz, ZP 111",
        claim(FieldPath.BIRTH_NUMBER, "7054021238", "RČ: 7054021238"),
        claim(FieldPath.PATIENT_PHONE, "603 123 456", "tel. 603 123 456"),
        claim(FieldPath.PATIENT_EMAIL, "Jana.Novakova@Example.cz", "Jana.Novakova@Example.cz"),
        claim(FieldPath.INSURANCE_CODE, "111", "ZP 111"),
    )
    assert h.patient.birth_number.value == "705402/1238"
    assert h.patient.birth_number.evidence[0].quote == "RČ: 7054021238"
    assert h.contacts.patient_phone.value == "+420603123456"
    assert h.contacts.patient_email.value == "jana.novakova@example.cz"
    assert h.patient.insurance_code.value == "111"


def test_an_identifier_that_cannot_be_read_stays_as_printed():
    h = _merged("tel. viz výše", claim(FieldPath.PATIENT_PHONE, "viz výše", "tel. viz výše"))
    assert h.contacts.patient_phone.value == "viz výše"


def test_height_in_metres_and_weight_in_kilograms():
    h = _merged(
        "Výška 1,65 m, hmotnost 65 kg.",
        claim(FieldPath.HEIGHT_CM, "1,65", "Výška 1,65 m"),
        claim(FieldPath.WEIGHT_KG, "65", "hmotnost 65 kg"),
    )
    assert h.height_cm.value == 165.0
    assert h.weight_kg.value == 65.0
    assert normalize.height_cm("170 cm") == 170.0
    assert normalize.weight_kg("800 g") == 0.8


def test_birth_number_check_digit():
    assert normalize.birth_number_valid("705402/1238")
    assert not normalize.birth_number_valid("705402/1234")
    assert normalize.birth_number_valid("536010/123")  # 9 digits, before 1954: no check digit
    assert normalize.birth_number("7054021238") == "705402/1238"
    assert normalize.birth_number("RČ neuvedeno") is None


def test_phone_numbers_as_e164():
    assert normalize.phone("+420 777 000 541") == "+420777000541"
    assert normalize.phone("00420 777-000-541") == "+420777000541"
    assert normalize.phone("777 000 541") == "+420777000541"
    assert normalize.phone("+49 30 1234567") == "+49301234567"
    assert normalize.phone("linka 12") is None


def test_lab_values_get_a_number_comparator_and_ucum_unit():
    def lab(value: str, unit: str | None) -> LabValue:
        return normalize.lab_value(LabValue(name="x", value=value, unit=unit))

    assert lab("12,8", "mmol/l").model_dump(include={"number", "comparator", "ucum"}) == {
        "number": 12.8, "comparator": None, "ucum": "mmol/L"}
    assert lab("< 0,5", "µg/l").comparator is Comparator.LT
    assert lab("< 0,5", "µg/l").ucum == "ug/L"
    assert lab("1 250", "kU/l").number == 1250
    assert lab("7,4", "10⁹/l").ucum == "10*9/L"
    assert lab("4,5", "G/l").ucum == "10*9/L"  # giga per litre, not grams
    assert lab("38", "g/l").ucum == "g/L"
    assert lab("1,2", "ml/s/1,73 m²").ucum == "mL/s/{1.73_m2}"
    pos = lab("pozitivní", None)
    assert pos.number is None and pos.ucum is None and pos.value == "pozitivní"
    assert not normalize.lab_unnormalized(pos)  # qualitative text is fine
    assert normalize.lab_unnormalized(lab("5,1", "jedn."))  # unknown unit
    assert normalize.lab_unnormalized(lab("5,1 - 6", "mmol/l"))  # a number the code can't read


def test_performance_status_as_scale_and_score():
    assert normalize.performance("ECOG 1") == PerformanceScore(scale=PerformanceScale.ECOG, score=1)
    assert normalize.performance("PS dle WHO 2") == PerformanceScore(scale=PerformanceScale.ECOG, score=2)
    assert normalize.performance("Karnofsky 80 %") == PerformanceScore(
        scale=PerformanceScale.KARNOFSKY, score=80)
    assert normalize.performance("ECOG 1-2") is None  # a range is not one score
    assert normalize.performance("ECOG 1, KPS 70") is None  # two scales
    assert normalize.performance("dobrý celkový stav") is None


def _found(value: str, quote: str) -> Sourced[str]:
    return Sourced[str].model_validate({"value": value, "status": "found", "evidence": [
        {"document_id": "a", "quote": quote}]})


def test_normalize_handover_fills_the_score_and_lab_numbers():
    h = Handover(
        case_id="case",
        as_of=D1,
        performance_status=_found("ECOG 1", "ECOG 1"),
        labs=[LabPanel(date=D1, place="lab", values=[LabValue(name="CRP", value="12", unit="mg/l")],
                       evidence=[{"document_id": "a", "quote": "CRP"}])],
    )
    n = normalize_handover(h)
    assert n.performance_score == PerformanceScore(scale=PerformanceScale.ECOG, score=1)
    assert n.labs[0].values[0].number == 12 and n.labs[0].values[0].ucum == "mg/L"
    assert n.labs[0].values[0].value == "12" and n.labs[0].values[0].unit == "mg/l"  # as printed
    missing = normalize_handover(h.model_copy(update={"performance_status": Sourced[str]()}))
    assert missing.performance_score is None


def _findings(h: Handover):
    return check(CheckContext(h, [], [], D1), build_checks(None))


def test_values_that_could_not_be_normalized_are_flagged_for_review():
    h = normalize_handover(Handover(
        case_id="case",
        as_of=D1,
        contacts={"patient_phone": _found("viz výše", "tel. viz výše")},
        performance_status=_found("ECOG 1-2", "ECOG 1-2"),
        labs=[LabPanel(date=D1, place="lab", values=[LabValue(name="Na", value="140", unit="jedn.")],
                       evidence=[{"document_id": "a", "quote": "Na"}])],
    ))
    flagged = {f.id: f for f in _findings(h) if f.kind is FindingKind.UNNORMALIZED}
    assert set(flagged) == {"unnormalized:contacts.patient_phone", "unnormalized:performance_status",
                            "unnormalized:labs"}
    assert all(not f.advisory and f.severity.value == "info" for f in flagged.values())
    assert "Na 140 jedn." in flagged["unnormalized:labs"].message_cs


def test_a_birth_number_failing_its_check_digit_is_an_identity_finding():
    h = Handover(case_id="case", as_of=D1, patient={"birth_number": _found("705402/1234", "705402/1234")})
    ids = [f.id for f in _findings(h) if f.kind is FindingKind.IDENTITY]
    assert ids == ["identity:birth_number:check_digit"]


def test_manual_values_are_not_flagged():
    manual = Sourced[str](value="viz výše", status=FieldStatus.FOUND, origin=Origin.MANUAL,
                          entered=Stamp(by="koordinator", at=NOW))
    h = Handover(case_id="case", as_of=D1, contacts={"patient_phone": manual})
    assert not [f for f in _findings(h) if f.kind is FindingKind.UNNORMALIZED]


def test_quotes_match_across_typography_and_line_break_hyphens():
    text = "Závěr: „suspektní“ tumor pan-\ncreatu – nutná EUS."
    span = locate('"suspektní" tumor pancreatu - nutná', text)
    assert span is not None
    assert text[span[0]:span[1]] == "„suspektní“ tumor pan-\ncreatu – nutná"
