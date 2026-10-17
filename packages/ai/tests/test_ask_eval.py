"""Offline evaluation of 'ask the case' retrieval (S8, Q-I19) on the reference case: fixed Czech
questions, the real embedding model's vectors cached in `data/ask_eval_vectors.json` (regenerate
with `scripts/ask_eval_vectors.py`), and a check that the passage answering each question reaches
the model."""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from pathlib import Path

import pytest
from ai_testkit import NOW
from onko_ai import ask_case
from onko_ai.models import AnswerDraft, QuoteRef
from onko_ai.service.search import ASK_CHUNKS
from onko_contracts import Case, DocumentMeta, ParsedDocument
from onko_repository import InMemoryRepository

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data" / "vzp-structured"
VECTORS = json.loads((Path(__file__).parent / "data" / "ask_eval_vectors.json").read_text())["vectors"]
CASE = "vzp-prochazkova"

# question → a passage of the answer, verbatim in the report that holds it
EXPECTED = {
    # broad questions: the report's header matches best, the answer is in a later section
    "Jaký byl nález na CT?": ("08", "Tumor hlavy pankreatu 35 mm s venózním postižením VMS"),
    "Jaký je závěr bioptického nálezu?": ("11", "Duktální adenokarcinom pankreatu"),
    # narrower ones, which worked before
    "Jaký typ nádoru byl prokázán histologicky?": ("11", "Duktální adenokarcinom pankreatu"),
    "Jaké léky pacientka užívá?": ("01", "apixaban 5 mg 1-0-1"),
    "Jaké jsou hodnoty nádorových markerů?": ("10", "CA 19-9"),
    "Jaký byl nález na RTG plic?": ("03", "Bez známek zánětlivých změn plic."),
}


class CachedEmbeddings:
    """The gateway with the cached vectors as `embed`; `complete` returns the expected quote and
    keeps the excerpts it was shown."""

    can_embed = True

    def __init__(self, quote: QuoteRef):
        self.quote = quote
        self.excerpts = ""

    def embed(self, texts):
        out = []
        for t in texts:
            k = hashlib.sha256(t.encode()).hexdigest()[:16]
            if k not in VECTORS:
                pytest.fail(f"no cached vector for {t[:40]!r}: run scripts/ask_eval_vectors.py")
            raw = base64.b64decode(VECTORS[k])
            out.append(list(struct.unpack(f"<{len(raw) // 2}e", raw)))
        return out

    def complete(self, messages, schema=None, *, slot=None):
        self.excerpts = messages[1]["content"]
        return AnswerDraft(quotes=[self.quote] if self.quote.quote in self.excerpts else [])


def _reference_case() -> tuple[InMemoryRepository, list[ParsedDocument]]:
    """The reference case's reports as the deployed app holds them at the MDT (21. 10.)."""
    repo = InMemoryRepository()
    repo.save_case(Case(id=CASE, patient_name="Test", koc_id="koc", referring_doctor_id="gp",
                        created_at=NOW))
    docs = []
    for raw in json.loads((DATA / "reference" / "manifest.json").read_text(encoding="utf-8")):
        meta = DocumentMeta.model_validate(raw).model_copy(update={"case_id": CASE})
        if meta.received_at and meta.received_at.date().isoformat() > "2026-10-21":
            continue
        text = (DATA / "reports" / (Path(meta.filename).stem + ".md")).read_text(encoding="utf-8")
        repo.save_document(meta, b"", text)
        docs.append(ParsedDocument(meta=meta, text=text))
    return repo, docs


@pytest.mark.parametrize("question", list(EXPECTED))
def test_the_answering_passage_reaches_the_model_and_is_verified(question):
    doc_id, passage = EXPECTED[question]
    repo, docs = _reference_case()
    gw = CachedEmbeddings(QuoteRef(document_id=doc_id, quote=passage))

    answer = ask_case(CASE, question, docs, repo, gw)

    assert answer.found, f"{passage!r} not among the excerpts"
    assert [(q.document_id, q.quote) for q in answer.quotes] == [(doc_id, passage)]


@pytest.mark.parametrize("question", ["Jaký byl nález na CT?", "Jaký je závěr bioptického nálezu?"])
def test_broad_questions_rank_the_answer_below_the_nearest_chunks(question):
    """Why the nearest chunks are widened: by similarity alone the answer is out of reach."""
    doc_id, passage = EXPECTED[question]
    repo, docs = _reference_case()
    gw = CachedEmbeddings(QuoteRef(document_id=doc_id, quote=passage))
    ask_case(CASE, question, docs, repo, gw)  # indexes the case

    [vector] = gw.embed([question])
    nearest = repo.nearest_chunks(CASE, vector, ASK_CHUNKS)

    assert not any(passage in c.text for c in nearest)
    assert any(c.document_id == doc_id for c in nearest)  # its document's header is near
