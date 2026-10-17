"""PDF rendering of the MDT record and conclusion (S5): valid PDFs whose Czech text reads back."""

from __future__ import annotations

import io
from datetime import date, datetime

import pytest
from onko_contracts import (
    Contacts,
    FieldStatus,
    Handover,
    MdtConclusion,
    MdtMember,
    MdtRecord,
    MdtResultRow,
    Origin,
    PatientDetails,
    Sourced,
    Stamp,
)
from onko_documents import (
    parse,
    render_mdt_conclusion,
    render_mdt_record,
    render_pdf,
)
from pypdf import PdfReader

NOW = datetime(2026, 10, 21, 9, 0)


def _record(**update) -> MdtRecord:
    record = MdtRecord(
        case_id="c1", mdt_date=date(2026, 10, 21), board_id="mdt-git",
        members=[MdtMember(name="doc. MUDr. Pavel Hrubý, Ph.D.", specialty="chirurgie")],
        patient_name="Jana Nováková", insurance_code="211", patient_phone="+420 600 000 000",
        weight_kg=65.0, height_cm=165.0, referring_doctor_name="MUDr. Tomáš Řezníček",
        diagnosis_name="Duktální adenokarcinom hlavy pankreatu", diagnosis_code="C25.0",
        comorbidities=["Arteriální hypertenze"],
        results=[MdtResultRow(date=date(2026, 10, 8), examination="CT břicha",
                              result="Tumor hlavy pankreatu 35 × 31 mm.\nBez metastáz.")],
        created=Stamp(by="koordinator", at=NOW),
    )
    return record.model_copy(update=update)


def _manual(value) -> Sourced:
    return Sourced(value=value, status=FieldStatus.FOUND, origin=Origin.MANUAL,
                   entered=Stamp(by="koordinator", at=NOW))


def _snapshot(**update) -> Handover:
    snapshot = Handover(
        case_id="c1", as_of=date(2026, 10, 21),
        patient=PatientDetails(age=_manual(63), sex=_manual("žena")),
        contacts=Contacts(contact_person=_manual("Petra Horká (dcera)"),
                          contact_person_phone=_manual("+420 777 000 000")),
        epicrisis=_manual("Bolesti epigastria, úbytek hmotnosti."),
        histology=_manual("Duktální adenokarcinom, G2–G3."),
        performance_status=_manual("soběstačná"),
        symptoms=_manual("Bolesti epigastria od srpna 2026."),
        medications=_manual(["Apixaban 5 mg 1-0-1"]),
        allergies=_manual("Neudává"),
        other=_manual("Přeje si informovat dceru."),
    )
    return snapshot.model_copy(update=update)


def _text(pdf: bytes) -> str:
    assert pdf.startswith(b"%PDF")
    return " ".join(" ".join(page.extract_text().split()) for page in PdfReader(io.BytesIO(pdf)).pages)


def test_mdt_record_follows_the_mdt_zapis_layout():
    text = _text(render_mdt_record(_record()))

    for heading in ("1 Základní údaje", "2 Členové MDT", "3 Diagnóza", "4 Komorbidity",
                    "5 Výsledky stávajících vyšetření"):
        assert heading in text
    assert "Jana Nováková" in text
    assert "MUDr. Tomáš Řezníček" in text
    assert "65 kg, 165 cm" in text
    assert "21. 10. 2026" in text


def test_missing_values_say_neuvedeno():
    text = _text(render_mdt_record(_record(diagnosis_code=None, comorbidities=[], mdt_question=None)))
    assert "Kód diagnózy (MKN-10) neuvedeno" in text
    assert "4 Komorbidity neuvedeno" in text
    assert "Požadavek / otázka na MDT neuvedeno" in text


def test_record_is_the_brief_before_the_meeting_never_the_outcome():
    text = _text(render_mdt_record(_record(), _snapshot()))
    for heading in ("Závěr MDT", "Doporučení MDT", "Doplní se po jednání MDT."):
        assert heading not in text


def test_record_carries_the_rest_of_the_snapshot_in_its_sections():
    text = _text(render_mdt_record(_record(), _snapshot()))

    basics, rest = text.split("2 Členové MDT")
    assert "věk 63, žena" in basics
    assert "Kontaktní osoba Petra Horká (dcera) +420 777 000 000" in basics
    diagnosis, rest = rest.split("3 Diagnóza")[1].split("4 Komorbidity")
    assert "Epikríza Bolesti epigastria, úbytek hmotnosti." in diagnosis
    assert "Histologie Duktální adenokarcinom, G2–G3." in diagnosis
    assert "Stav výkonnosti (PS) soběstačná" in diagnosis
    assert "Symptomy a jejich počátek Bolesti epigastria od srpna 2026." in diagnosis
    comorbidities, rest = rest.split("5 Výsledky stávajících vyšetření")
    assert "Léková anamnéza (FA) • Apixaban 5 mg 1-0-1" in comorbidities
    assert "Alergie (AA) Neudává" in comorbidities
    assert "neuvedeno Jiná sdělení Přeje si informovat dceru. Nessio" in rest


def test_missing_snapshot_values_say_neuvedeno():
    empty = Handover(case_id="c1", as_of=date(2026, 10, 21))
    text = _text(render_mdt_record(_record(), empty))
    for label in ("Kontaktní osoba", "Epikríza", "Histologie", "Stav výkonnosti (PS)",
                  "Symptomy a jejich počátek", "Léková anamnéza (FA)", "Alergie (AA)",
                  "Jiná sdělení"):
        assert f"{label} neuvedeno" in text
    assert "věk" not in text


def test_record_without_a_snapshot_shows_only_its_own_fields():
    text = _text(render_mdt_record(_record()))
    for label in ("Kontaktní osoba", "Epikríza", "Léková anamnéza", "Jiná sdělení"):
        assert label not in text


def test_mdt_conclusion_follows_the_mdt_zaver_layout():
    conclusion = MdtConclusion(
        case_id="c1", diagnosis_code="C25.0", diagnosis_name="Duktální adenokarcinom",
        clinical_assessment="Hraničně resekabilní nález.", conclusion="Neoadjuvantní chemoterapie.",
        recommendations=["Onkologické konzilium", "Kontrolní CT"], place="Praha 4",
        chair="doc. MUDr. Pavel Hrubý, Ph.D.", copy_to=["MUDr. Tomáš Řezníček"],
    )
    text = _text(render_mdt_conclusion(conclusion, _record(),
                                       header=["Komplexní onkologické centrum Nemocnice Lipová"]))

    assert "Nemocnice Lipová" in text
    for heading in ("Základní údaje", "Členové MDT", "Diagnóza", "Závěr MDT", "Doporučení MDT"):
        assert heading in text
    assert "C25.0 – Duktální adenokarcinom" in text
    assert "Praha 4, 21. 10. 2026" in text
    assert "předsedající MDT" in text
    assert "Kopie: MUDr. Tomáš Řezníček" in text
    assert "Výsledky stávajících vyšetření" not in text
    assert "Tumor hlavy pankreatu" not in text
    assert "Komorbidity: Arteriální hypertenze" in text


def test_conclusion_without_a_record_still_renders():
    assert "Závěr MDT" in _text(render_mdt_conclusion(MdtConclusion(case_id="c1")))


def test_rendered_pdf_parses_like_an_upload():
    assert "Jana Nováková" in parse(render_mdt_record(_record()), "application/pdf")


def test_unknown_layout_is_rejected():
    with pytest.raises(ValueError):
        render_pdf("invoice", {})


def test_user_text_is_never_read_as_typst_markup():
    text = _text(render_mdt_record(_record(
        patient_name="*Jana* #Nováková", mdt_question='Je = $1 [x] <a> @b \\ "q" // c?')))
    assert "*Jana* #Nováková" in text
    assert 'Je = $1 [x] <a> @b \\ "q" // c?' in text


def test_multiline_values_keep_their_lines():
    pdf = render_mdt_record(_record(mdt_question="První řádek\nDruhý řádek"))
    page = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
    assert "První řádek\nDruhý řádek" in page


def test_every_page_carries_the_nessio_header_and_a_page_footer():
    long = [MdtResultRow(date=date(2026, 10, 8), examination="CT", result="Nález. " * 400),
            MdtResultRow(date=date(2026, 10, 9), examination="PET/CT", result="Bez ložisek.")]
    pdf = render_mdt_record(_record(results=long))
    pages = [" ".join(p.extract_text().split()) for p in PdfReader(io.BytesIO(pdf)).pages]

    assert len(pages) > 1
    for number, page in enumerate(pages, start=1):
        assert page.startswith("Nessio")
        assert f"Strana {number} / {len(pages)}" in page
    assert "Nález." in pages[0] and "Nález." in pages[1]  # the long result breaks across pages
    assert "PET/CT 9. 10. 2026 Bez ložisek." in " ".join(pages)
