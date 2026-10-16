from pathlib import Path

from onko_documents import DOCX, parse

SRC = Path(__file__).resolve().parents[3] / "data" / "cesta-pacienta-data" / "Pacient"


def test_docx_lab_table_becomes_markdown():
    text = parse((SRC / "10_Laborator_KOC2_2026-10-15.docx").read_bytes(), DOCX)
    assert "| CA 19-9 | 312 H | kU/l | < 37 |" in text
    assert "Alena Procházková" in text
