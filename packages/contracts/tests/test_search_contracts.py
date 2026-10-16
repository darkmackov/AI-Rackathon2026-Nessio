"""S8 search contracts: a chunk is its document's text between its offsets, an answer is only
quotes, and an ask_case job carries its answer typed."""

from __future__ import annotations

from datetime import datetime

import pytest
from onko_contracts import CaseAnswer, DocChunk, Evidence, Job, JobKind, JobStatus
from pydantic import ValidationError

TEXT = "ZÁVĚR: adenokarcinom pankreatu."


def test_chunk_is_the_text_between_its_offsets():
    chunk = DocChunk(id="d1-0", document_id="d1", case_id="c1", ord=0, start=0, end=len(TEXT),
                     text=TEXT)
    assert TEXT[chunk.start:chunk.end] == chunk.text


@pytest.mark.parametrize(("start", "end", "text"), [(0, 5, TEXT), (3, 3, ""), (-1, 4, "ZÁVĚ")])
def test_chunk_rejects_a_span_that_does_not_fit_its_text(start, end, text):
    with pytest.raises(ValidationError):
        DocChunk(id="d1-0", document_id="d1", case_id="c1", ord=0, start=start, end=end, text=text)


def test_answer_is_found_exactly_when_it_has_quotes():
    quote = Evidence(document_id="d1", quote="adenokarcinom pankreatu", start=7, end=30)
    assert CaseAnswer(question="Jaká je diagnóza?", found=True, quotes=[quote]).found
    assert not CaseAnswer(question="Jaké je ECOG?", found=False).quotes
    with pytest.raises(ValidationError):
        CaseAnswer(question="Jaké je ECOG?", found=True)
    with pytest.raises(ValidationError):
        CaseAnswer(question="Jaká je diagnóza?", found=False, quotes=[quote])


def test_ask_case_job_round_trips_with_its_answer():
    job = Job(id="job-1", kind=JobKind.ASK_CASE, case_id="c1", params={"question": "Jaké je ECOG?"},
              status=JobStatus.DONE, created_at=datetime(2026, 10, 21, 9, 0),
              answer=CaseAnswer(question="Jaké je ECOG?", found=False))
    assert Job.model_validate_json(job.model_dump_json()) == job
