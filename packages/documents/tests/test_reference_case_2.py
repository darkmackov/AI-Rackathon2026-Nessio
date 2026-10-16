"""The generated .docx originals of reference case 2 parse back to their Markdown reports."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import pytest
from onko_documents import DOCX, parse

CASE = Path(__file__).resolve().parents[3] / "data" / "reference-2"
REPORTS = sorted((CASE / "reports").glob("*.md"))


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def test_every_report_has_an_original():
    originals = sorted(p.stem for p in (CASE / "originals").glob("*.docx"))
    assert originals == [p.stem for p in REPORTS]


@pytest.mark.parametrize("report", REPORTS, ids=lambda p: p.stem)
def test_original_parses_to_its_report(report: Path):
    header, body = report.read_text(encoding="utf-8").split("\n", 1)
    assert header == f"<!-- source: {report.stem}.docx -->"
    text = parse((CASE / "originals" / f"{report.stem}.docx").read_bytes(), DOCX)
    assert _norm(text) == _norm(body)


def test_lab_tables_are_word_tables():
    source = CASE / "originals" / "08_Laborator_KOC_2026-10-14.docx"
    with zipfile.ZipFile(source) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    assert xml.count("<w:tbl>") == 3
    assert "| CEA | 14,6 H | µg/l | < 5,0 |" in parse(source.read_bytes(), DOCX)
