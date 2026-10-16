"""Vector search over case documents and the MKN-10 code list (S8, Q-I19, Q-C11)."""

from __future__ import annotations

from pydantic import Field, model_validator

from .common import Evidence, Model


class DocChunk(Model):
    """A piece of a parsed document, cut along its sections, embedded for vector search (Q-I19).
    `text` is the document text from `start` to `end`, verbatim."""

    id: str = Field(description="`{document_id}-{ord}`")
    document_id: str
    case_id: str
    ord: int = Field(description="Position of the chunk in its document, from 0")
    start: int = Field(description="Char offset of the chunk in the document text")
    end: int = Field(description="Char offset after the chunk")
    text: str

    @model_validator(mode="after")
    def _span(self) -> DocChunk:
        if not 0 <= self.start < self.end or len(self.text) != self.end - self.start:
            raise ValueError("a chunk is the non-empty text between start and end")
        return self


class CaseAnswer(Model):
    """'Ask the case' (Q-I19): the answer is only verbatim quotes from the case's documents, each
    checked like extracted evidence. No quote passed: `found` is false ('nenalezeno')."""

    question: str
    found: bool
    quotes: list[Evidence] = Field(default_factory=list)

    @model_validator(mode="after")
    def _found_has_quotes(self) -> CaseAnswer:
        if self.found != bool(self.quotes):
            raise ValueError("an answer is found exactly when it has quotes")
        return self


class CodeCandidate(Model):
    """An MKN-10 code proposed by vector search for a diagnosis without a code (Q-C11). Only a
    proposal: a person picks one. Candidates are listed best first; similarity scores are not shown,
    they are not calibrated (Q-I19)."""

    code: str = Field(description="MKN-10 code, e.g. 'C25.0'")
    title_cs: str = Field(description="Name of the code in the MKN-10 list")
