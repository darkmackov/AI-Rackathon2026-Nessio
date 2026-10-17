"""Drafts for the coordinator (S5): offline, with a fake gateway."""

from __future__ import annotations

from datetime import date

import pytest
from ai_testkit import FakeGateway
from onko_ai import ResultLine, ResultLines, draft, draft_results, handover_digest
from onko_contracts import (
    Evidence,
    Examination,
    FieldStatus,
    Finding,
    FindingKind,
    Handover,
    LabPanel,
    LabValue,
    MdtResultRow,
    Severity,
    Sourced,
)


def _found(value) -> Sourced:
    return Sourced(value=value, status=FieldStatus.FOUND,
                   evidence=[Evidence(document_id="d1", quote=str(value))])


HANDOVER = Handover(
    case_id="c1", as_of=date(2026, 10, 20),
    diagnosis=_found("Karcinom žaludku"), comorbidities=_found(["hypertenze", "diabetes"]),
    epicrisis_source=_found("Pacient s dyspepsií od srpna."),
    examinations=[
        Examination(date=date(2026, 10, 8), place="KOC 1", type="CT", result_full_text="Ložisko 2 cm."),
        Examination(date=date(2026, 9, 1), place="PL", type="Vyšetření PL", result_full_text="Bolesti."),
    ],
    labs=[LabPanel(date=date(2026, 9, 1), place="Lab", values=[LabValue(name="Hb", value="98",
                                                                        unit="g/l", flag="L")])],
)
FINDINGS = [
    Finding(id="F01", kind=FindingKind.MISSING, severity=Severity.BLOCKER, message_cs="Chybí ECOG."),
    Finding(id="F02", kind=FindingKind.MISSING, severity=Severity.WARNING, message_cs="Vyřešeno.",
            resolved=True),
]


def test_digest_lists_known_values_and_examinations_in_date_order():
    digest = handover_digest(HANDOVER)
    assert "Diagnóza: Karcinom žaludku" in digest
    assert "Komorbidity (OA): hypertenze; diabetes" in digest
    assert "Epikríza referujícího lékaře:\nPacient s dyspepsií od srpna." in digest
    assert digest.index("2026-09-01, PL") < digest.index("2026-10-08, KOC 1")
    assert "Hb 98 g/l L" in digest
    assert "Histologie" not in digest  # missing values are left out, never filled in


@pytest.mark.parametrize("kind", ["epicrisis_summary", "mdt_question"])
def test_text_draft_sends_the_case_and_open_problems(kind):
    gateway = FakeGateway({None: "  Návrh textu.\n"})

    assert draft(kind, HANDOVER, FINDINGS, gateway=gateway) == "Návrh textu."

    schema, messages = gateway.seen[0]
    assert schema is None
    assert "Never add a fact" in messages[0]["content"]
    user = messages[1]["content"]
    assert "Karcinom žaludku" in user
    assert "Chybí ECOG." in user
    assert "Vyřešeno." not in user  # resolved problems are not open


def test_unknown_draft_kind_is_rejected():
    with pytest.raises(ValueError):
        draft("mdt_conclusion", HANDOVER, [], gateway=FakeGateway({}))


def test_result_rows_get_one_line_each_and_keep_date_and_examination():
    rows = [
        MdtResultRow(date=date(2026, 10, 8), examination="CT", result="Dlouhý text CT."),
        MdtResultRow(date=date(2026, 10, 12), examination="EUS", result="Dlouhý text EUS."),
    ]
    gateway = FakeGateway({ResultLines: ResultLines(lines=[ResultLine(index=0, result="Ložisko 2 cm")])})

    drafted = draft_results(rows, gateway=gateway)

    assert drafted[0] == rows[0].model_copy(update={"result": "Ložisko 2 cm"})
    assert drafted[1] == rows[1]  # left out by the model: keeps its full text
    assert "[1] 2026-10-12 | EUS" in gateway.seen[0][1][1]["content"]


def test_no_rows_no_model_call():
    gateway = FakeGateway({})
    assert draft_results([], gateway=gateway) == []
    assert gateway.seen == []
