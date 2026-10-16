"""Quote verification and the deterministic merge."""

from __future__ import annotations

import datetime as dt

from ai_testkit import FakeGateway, claim, make_doc, out
from onko_ai import DocExtraction, Extraction, LlmExtractor, keep_manual, locate, merge
from onko_ai.models import Certainty, ExamClaim, FieldPath, LabClaim, LabValueClaim
from onko_contracts import DocumentType, FieldStatus, Origin, Sourced, Stamp

D1, D2, D3 = dt.date(2026, 5, 1), dt.date(2026, 8, 1), dt.date(2026, 9, 1)


def test_locate_ignores_whitespace_differences_only():
    text = "Hmotnost   65 kg.\nVýška 180 cm."
    assert locate("Hmotnost 65 kg.", text) == (0, 17)
    assert locate("Hmotnost 66 kg.", text) is None
    assert locate("hmotnost 65 kg.", text) is None


def test_newest_document_wins_for_values_that_change():
    a = make_doc("a", "Hmotnost 80 kg.", D1)
    b = make_doc("b", "Hmotnost 76 kg.", D2)
    h = merge(
        "c",
        D3,
        [
            Extraction(b, out(claim(FieldPath.WEIGHT_KG, "76", "Hmotnost 76 kg."))),
            Extraction(a, out(claim(FieldPath.WEIGHT_KG, "80", "Hmotnost 80 kg."))),
        ],
    )
    assert h.weight_kg.value == 76
    assert [e.document_id for e in h.weight_kg.evidence] == ["b"]
    assert h.weight_kg.evidence[0].start == 0


def test_disagreeing_allergies_become_a_conflict_without_value():
    a = make_doc("a", "AA: sulfonamidy (otok)", D1)
    b = make_doc("b", "AA: neguje", D2)
    h = merge(
        "c",
        D3,
        [
            Extraction(a, out(claim(FieldPath.ALLERGIES, "sulfonamidy", "AA: sulfonamidy (otok)"))),
            Extraction(b, out(claim(FieldPath.ALLERGIES, "neguje", "AA: neguje"))),
        ],
    )
    assert h.allergies.status is FieldStatus.CONFLICT
    assert h.allergies.value is None
    assert {e.document_id for e in h.allergies.evidence} == {"a", "b"}


def test_negated_allergies_written_differently_agree():
    a = make_doc("a", "AA: neguje", D1)
    b = make_doc("b", "Alergie: žádné", D2)
    h = merge(
        "c",
        D3,
        [
            Extraction(a, out(claim(FieldPath.ALLERGIES, "neguje", "AA: neguje"))),
            Extraction(b, out(claim(FieldPath.ALLERGIES, "žádné", "Alergie: žádné"))),
        ],
    )
    assert h.allergies.status is FieldStatus.FOUND


def test_identity_majority_wins_over_a_misprint():
    docs = [
        make_doc(i, f"Nar. {d}", D1 if i == "a" else D2)
        for i, d in [("a", "2. 4. 1971"), ("b", "2. 4. 1970"), ("c", "2. 4. 1970")]
    ]
    h = merge(
        "c", D3, [Extraction(d, out(claim(FieldPath.BIRTH_DATE, d.text[5:], d.text))) for d in docs]
    )
    assert h.patient.birth_date.value == dt.date(1970, 4, 2)


def test_a_value_whose_quote_is_not_verbatim_is_dropped():
    doc = make_doc("a", "Pacient soběstačný.", D1)
    h = merge(
        "c", D3, [Extraction(doc, out(claim(FieldPath.PERFORMANCE_STATUS, "ECOG 0", "ECOG 0")))]
    )
    assert h.performance_status.status is FieldStatus.MISSING
    assert h.performance_status.value is None


def test_sex_is_derived_from_the_birth_number_when_not_stated():
    doc = make_doc("a", "RČ: 705402/1234", D1)
    h = merge(
        "c",
        D3,
        [Extraction(doc, out(claim(FieldPath.BIRTH_NUMBER, "705402/1234", "RČ: 705402/1234")))],
    )
    assert h.patient.sex.value == "žena"
    assert h.patient.sex.note


def test_examination_full_text_is_a_verbatim_slice_and_labs_keep_printed_values():
    text = "Hlavička\n\nPOPIS\nJátra bez ložisek.\n\nZÁVĚR\nNormální nález.\n\nMUDr. X\n\n| Hemoglobin | 131 | g/l |"
    doc = make_doc("a", text, D2, DocumentType.LAB, title="CT")
    exam = ExamClaim(
        date="2026-08-01",
        place="RDG",
        type="CT",
        start_quote="POPIS",
        end_quote="Normální nález.",
        key_quote="Játra bez ložisek.",
    )
    labs = LabClaim(
        date="2026-08-01",
        place="Lab",
        date_quote="Hemoglobin",
        values=[
            LabValueClaim(
                name="Hemoglobin", value="131", unit="g/l", reference_range=None, flag=None
            ),
            LabValueClaim(name="Ferritin", value="9", unit="µg/l", reference_range=None, flag="L"),
        ],
    )
    h = merge("c", D3, [Extraction(doc, out(examinations=[exam], labs=[labs]))])
    assert (
        h.examinations[0].result_full_text == "POPIS\nJátra bez ložisek.\n\nZÁVĚR\nNormální nález."
    )
    assert [v.name for v in h.labs[0].values] == ["Hemoglobin"]


def test_manual_values_survive_a_new_extraction():
    doc = make_doc("a", "Hmotnost 80 kg.", D1)
    new = merge(
        "c", D3, [Extraction(doc, out(claim(FieldPath.WEIGHT_KG, "80", "Hmotnost 80 kg.")))]
    )
    stamp = Stamp(by="koordinator", at=dt.datetime(2026, 9, 1))
    old = new.model_copy(
        update={
            "performance_status": Sourced[str](
                value="ECOG 1", status=FieldStatus.FOUND, origin=Origin.MANUAL, entered=stamp
            )
        }
    )
    kept = keep_manual(old, new)
    assert kept.performance_status.value == "ECOG 1"
    assert kept.weight_kg.value == 80


def test_extractor_calls_the_model_once_per_document():
    docs = [make_doc("a", "AA: neguje", D1), make_doc("b", "AA: neguje", D2)]
    gw = FakeGateway({DocExtraction: out(claim(FieldPath.ALLERGIES, "neguje", "AA: neguje"))})
    h = LlmExtractor(gw).extract("c", docs, D3)
    assert len(gw.seen) == 2
    assert h.allergies.value == "neguje"


def test_one_examination_and_one_lab_panel_per_document():
    text = "EKG: sinus.\nECHO: EF 60 %.\n| Hemoglobin | 131 |\n| CRP | 4 |"
    doc = make_doc("a", text, D2, DocumentType.LAB)
    exams = [
        ExamClaim(
            date="2026-08-01",
            place="K",
            type="EKG",
            start_quote="EKG",
            end_quote="sinus.",
            key_quote="EKG: sinus.",
        ),
        ExamClaim(
            date="2026-08-01",
            place="K",
            type="EKG + ECHO",
            start_quote="EKG",
            end_quote="EF 60 %.",
            key_quote="EF 60 %.",
        ),
    ]
    labs = [
        LabClaim(
            date="2026-08-01",
            place="L",
            date_quote="Hemoglobin",
            values=[
                LabValueClaim(
                    name="Hemoglobin", value="131", unit=None, reference_range=None, flag=None
                )
            ],
        ),
        LabClaim(
            date="2026-08-01",
            place="L",
            date_quote="CRP",
            values=[
                LabValueClaim(name="CRP", value="4", unit=None, reference_range=None, flag=None)
            ],
        ),
    ]
    h = merge("c", D3, [Extraction(doc, out(examinations=exams, labs=labs))])
    assert [e.type for e in h.examinations] == ["EKG + ECHO"]
    assert [[v.name for v in p.values] for p in h.labs] == [["Hemoglobin", "CRP"]]


def test_a_drug_mentioned_in_passing_does_not_replace_the_medication_list():
    full = make_doc(
        "a", "FA: metformin 1000 mg 1-0-1, ramipril 5 mg 1-0-0, atorvastatin 20 mg 0-0-1", D1
    )
    later = make_doc("b", "Metformin vysadit 48 h před výkonem.", D2)
    meds = ["metformin 1000 mg 1-0-1", "ramipril 5 mg 1-0-0", "atorvastatin 20 mg 0-0-1"]
    h = merge(
        "c",
        D3,
        [
            Extraction(full, out(claim(FieldPath.MEDICATIONS, None, *meds, items=meds))),
            Extraction(
                later,
                out(
                    claim(
                        FieldPath.MEDICATIONS,
                        None,
                        "Metformin vysadit",
                        items=["metformin vysazen"],
                    )
                ),
            ),
        ],
    )
    assert h.medications.value == meds


def test_lab_values_quoted_outside_a_lab_report_are_not_a_panel():
    doc = make_doc("a", "Hemoglobin 131 g/l", D2, DocumentType.OUTPATIENT_REPORT)
    lab = LabClaim(
        date="2026-08-01",
        place="L",
        date_quote="Hemoglobin",
        values=[
            LabValueClaim(
                name="Hemoglobin", value="131", unit=None, reference_range=None, flag=None
            )
        ],
    )
    assert merge("c", D3, [Extraction(doc, out(labs=[lab]))]).labs == []


def test_the_pathology_report_settles_the_diagnosis_over_newer_documents():
    hist = make_doc("h", "Závěr: adenokarcinom G2", D1, DocumentType.HISTOLOGY)
    mri = make_doc("m", "Závěr: karcinom rekta mrT3", D2, DocumentType.IMAGING)
    h = merge(
        "c",
        D3,
        [
            Extraction(
                hist,
                out(
                    claim(
                        FieldPath.DIAGNOSIS,
                        "adenokarcinom G2",
                        "adenokarcinom G2",
                        certainty=Certainty.CONFIRMED,
                    )
                ),
            ),
            Extraction(
                mri, out(claim(FieldPath.DIAGNOSIS, "karcinom rekta", "karcinom rekta mrT3"))
            ),
        ],
    )
    assert h.diagnosis.value == "adenokarcinom G2"
