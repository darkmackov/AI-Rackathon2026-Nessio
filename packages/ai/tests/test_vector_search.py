"""Vector search in the AI pipeline (S8, Q-I19): chunks along sections, 'ask the case' answers only
with verbatim quotes, MKN-10 candidates, and unverified quotes flagged with the nearest chunk."""

from __future__ import annotations

import datetime as dt

import pytest
from ai_testkit import NOW, FakeGateway, claim, make_doc, out
from onko_ai import (
    DocExtraction,
    analyse_case,
    ask_case,
    chunk_document,
    code_candidates,
    index_document,
    index_missing,
    load_codes,
)
from onko_ai.models import AnswerDraft, ClinicalReview, FieldPath, QuoteRef
from onko_ai.service import search
from onko_ai.service.search import MAX_CHUNK
from onko_contracts import (
    Case,
    CodeCandidate,
    DocumentMeta,
    FindingKind,
    ParsedDocument,
    Severity,
)
from onko_repository import InMemoryRepository

D1 = dt.date(2026, 10, 1)

REPORT = """Ambulantní zpráva

Anamnéza:
Pacient udává bolesti břicha dva měsíce.
Úbytek hmotnosti 5 kg.

ZÁVĚR:
Nález ložiska v hlavě pankreatu, doporučena EUS s biopsií.

Výkonnostní stav ECOG 1."""


def _doc(doc_id: str, text: str, case_id: str = "c1", **meta) -> ParsedDocument:
    doc = make_doc(doc_id, text, D1)
    return doc.model_copy(update={"meta": doc.meta.model_copy(update={"case_id": case_id, **meta})})


def _repo(*docs: ParsedDocument) -> InMemoryRepository:
    repo = InMemoryRepository()
    for case_id in {d.meta.case_id for d in docs} | {"c1"}:
        repo.save_case(Case(id=case_id, patient_name="Test", koc_id="koc", referring_doctor_id="gp",
                            created_at=NOW))
    for d in docs:
        repo.save_document(d.meta, b"", d.text)
    return repo


def test_chunks_follow_sections_and_are_verbatim_slices():
    doc = _doc("d1", REPORT)

    chunks = chunk_document(doc)

    assert [c.text.split("\n", 1)[0] for c in chunks] == ["Ambulantní zpráva", "Anamnéza:", "ZÁVĚR:"]
    assert chunks[-1].text.endswith("ECOG 1.")  # a plain paragraph joins the section before it
    assert all(REPORT[c.start:c.end] == c.text for c in chunks)
    assert [c.id for c in chunks] == ["d1-0", "d1-1", "d1-2"] and chunks[0].case_id == "c1"


def test_a_paragraph_longer_than_a_chunk_is_split_at_line_breaks():
    line = "Laboratorní hodnota v referenčním rozmezí bez patologie. " * 3
    text = "\n".join([line] * 40)

    chunks = chunk_document(_doc("d1", text))

    assert len(chunks) > 1
    assert all(len(c.text) <= MAX_CHUNK and text[c.start:c.end] == c.text for c in chunks)
    assert chunks[0].text.endswith("patologie. ")  # cut at a line break, not inside a line


def test_index_missing_embeds_only_documents_without_chunks():
    d1, d2 = _doc("d1", REPORT), _doc("d2", "ZÁVĚR:\nBez nálezu.")
    repo = _repo(d1, d2)
    gw = FakeGateway({})
    index_document(d1, repo, gw)

    assert index_missing([d1, d2], repo, gw) == 1
    assert {c.document_id for c in repo.list_chunks("c1")} == {"d1", "d2"}


def test_ask_the_case_answers_with_verified_quotes_only():
    d1 = _doc("d1", REPORT)
    repo = _repo(d1)
    seen_excerpts: list[str] = []

    def answer(messages):
        seen_excerpts.append(messages[1]["content"])
        return AnswerDraft(quotes=[
            QuoteRef(document_id="d1", quote="Výkonnostní  stav ECOG 1."),  # whitespace may differ
            QuoteRef(document_id="d1", quote="ECOG 2"),  # not in the text: dropped
            QuoteRef(document_id="d9", quote="ECOG 1"),  # not a case document: dropped
        ])

    result = ask_case("c1", "Jaký je výkonnostní stav ECOG?", [d1], repo,
                      FakeGateway({AnswerDraft: answer}))

    assert result.found
    assert [(q.document_id, q.quote) for q in result.quotes] == [("d1", "Výkonnostní stav ECOG 1.")]
    assert REPORT[result.quotes[0].start:result.quotes[0].end] == result.quotes[0].quote
    assert "[document d1]" in seen_excerpts[0] and "ECOG 1" in seen_excerpts[0]


def test_ask_the_case_is_not_found_when_no_quote_passes():
    d1 = _doc("d1", REPORT)
    gw = FakeGateway({AnswerDraft: AnswerDraft(quotes=[QuoteRef(document_id="d1", quote="ECOG 3")])})

    result = ask_case("c1", "Jaké je ECOG?", [d1], _repo(d1), gw)

    assert not result.found and result.quotes == []


def test_ask_the_case_only_sees_the_documents_it_is_given():
    inside, later = _doc("d1", "ZÁVĚR:\nBez nálezu."), _doc("d2", REPORT)
    repo = _repo(inside, later)
    index_document(later, repo, FakeGateway({}))
    seen: list[str] = []
    gw = FakeGateway({AnswerDraft: lambda m: seen.append(m[1]["content"]) or AnswerDraft(quotes=[])})

    result = ask_case("c1", "Jaké je ECOG?", [inside], repo, gw)

    assert not result.found
    assert "d2" not in seen[0]


def test_ask_the_case_widens_the_nearest_chunks_to_their_documents_within_the_budget(monkeypatch):
    sections = "\n\n".join(f"ODDÍL {i}:\nPoložka slovo{i}." for i in range(30))
    short, long = _doc("d1", REPORT), _doc("d2", sections)
    repo = _repo(short, long)
    seen: list[str] = []
    gw = FakeGateway({AnswerDraft: lambda m: seen.append(m[1]["content"]) or AnswerDraft(quotes=[])})
    monkeypatch.setattr(search, "ASK_CHARS", len(REPORT) + 40)

    ask_case("c1", "Úbytek hmotnosti a slovo7?", [short, long], repo, gw, limit=2)

    excerpts = seen[0].split("Excerpts:", 1)[1]
    assert "Výkonnostní stav ECOG 1." in excerpts  # the whole short report goes along
    assert "slovo7." in excerpts and "slovo8." not in excerpts  # the long one: its best chunk only


def test_code_candidates_rank_the_code_list_by_the_diagnosis():
    repo = _repo()
    gw = FakeGateway({})
    codes = [
        CodeCandidate(code="X01.0", title_cs="Zhoubný novotvar hlavy pankreatu"),
        CodeCandidate(code="X02.1", title_cs="Zhoubný novotvar horního laloku plic"),
        CodeCandidate(code="X03.9", title_cs="Zlomenina stehenní kosti"),
    ]
    assert load_codes(codes, repo, gw) == 3

    found = code_candidates("adenokarcinom hlavy pankreatu", repo, gw, limit=2)

    assert found[0].code == "X01.0" and len(found) == 2


def test_a_dropped_value_is_flagged_with_the_nearest_chunk_of_its_document():
    d1 = _doc("d1", REPORT)
    repo = _repo(d1)
    gw = FakeGateway({
        DocExtraction: out(claim(FieldPath.PERFORMANCE_STATUS, "ECOG 1", "výkonnostní stav ECOG I")),
        ClinicalReview: ClinicalReview(notes=[]),
    })
    index_document(d1, repo, gw)

    handover, findings, _ = analyse_case("c1", [d1], gateway=gw, as_of=D1, now=NOW, repo=repo)

    assert handover.performance_status.value is None  # never accepted (D-2)
    [flag] = [f for f in findings if f.kind is FindingKind.UNVERIFIED_QUOTE]
    assert flag.id == "unverified:performance_status:d1" and flag.severity is Severity.INFO
    assert flag.fields == ["performance_status"]
    assert flag.evidence[0].quote.endswith("ECOG 1.")
    assert REPORT[flag.evidence[0].start:flag.evidence[0].end] == flag.evidence[0].quote


def test_a_verified_value_is_not_flagged_and_an_unindexed_document_has_no_nearest_chunk():
    d1 = _doc("d1", REPORT)
    gw = FakeGateway({
        DocExtraction: out(
            claim(FieldPath.PERFORMANCE_STATUS, "ECOG 1", "ECOG 1"),
            claim(FieldPath.WEIGHT_KG, "70", "hmotnost 70 kg"),
        ),
        ClinicalReview: ClinicalReview(notes=[]),
    })

    _, findings, _ = analyse_case("c1", [d1], gateway=gw, as_of=D1, now=NOW, repo=_repo(d1))

    [flag] = [f for f in findings if f.kind is FindingKind.UNVERIFIED_QUOTE]
    assert flag.fields == ["weight_kg"] and flag.evidence == []


def test_chunking_needs_the_documents_case():
    doc = ParsedDocument(meta=DocumentMeta(id="d1", filename="d1.docx"), text="text")
    with pytest.raises(ValueError):
        chunk_document(doc)
