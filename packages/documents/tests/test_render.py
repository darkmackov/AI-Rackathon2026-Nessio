"""PDF rendering of the MDT record and conclusion (S5): valid PDFs whose Czech text reads back."""

from __future__ import annotations

import io
from datetime import date, datetime

import pytest
from onko_contracts import MdtConclusion, MdtMember, MdtRecord, MdtResultRow, Stamp
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


def _text(pdf: bytes) -> str:
    assert pdf.startswith(b"%PDF")
    return " ".join(" ".join(page.extract_text().split()) for page in PdfReader(io.BytesIO(pdf)).pages)


def test_mdt_record_follows_the_mdt_zapis_layout():
    text = _text(render_mdt_record(_record()))

    for heading in ("1 Základní údaje", "2 Členové MDT", "3 Diagnóza", "4 Komorbidity",
                    "5 Výsledky stávajících vyšetření", "6 Závěr MDT", "7 Doporučení MDT"):
        assert heading in text
    assert "Jana Nováková" in text
    assert "MUDr. Tomáš Řezníček" in text
    assert "65 kg, 165 cm" in text
    assert "21. 10. 2026" in text
    assert "Doplní se po jednání MDT." in text


def test_missing_values_say_neuvedeno():
    text = _text(render_mdt_record(_record(diagnosis_code=None, comorbidities=[], mdt_question=None)))
    assert "Kód diagnózy (MKN-10) neuvedeno" in text
    assert "4 Komorbidity neuvedeno" in text
    assert "Požadavek / otázka na MDT neuvedeno" in text


def test_record_shows_only_a_confirmed_conclusion():
    unconfirmed = MdtConclusion(case_id="c1", conclusion="Neoadjuvantní chemoterapie.")
    assert "Neoadjuvantní" not in _text(render_mdt_record(_record(), unconfirmed))
    confirmed = unconfirmed.model_copy(update={"confirmed": Stamp(by="koordinator", at=NOW),
                                               "recommendations": ["Onkologické konzilium"]})
    text = _text(render_mdt_record(_record(), confirmed))
    assert "Neoadjuvantní chemoterapie." in text
    assert "Onkologické konzilium" in text


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
    for heading in ("Základní údaje", "Členové MDT", "Diagnóza", "Výsledky stávajících vyšetření",
                    "Závěr MDT", "Doporučení MDT"):
        assert heading in text
    assert "C25.0 – Duktální adenokarcinom" in text
    assert "Praha 4, 21. 10. 2026" in text
    assert "předsedající MDT" in text
    assert "Kopie: MUDr. Tomáš Řezníček" in text


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
