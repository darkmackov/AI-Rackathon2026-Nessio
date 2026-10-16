"""Module-local types of `bench`."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from onko_contracts import DocumentMeta, Finding, Handover


@dataclass(frozen=True)
class ReferenceCase:
    """A reference folder: `reports/*.md` plus `reference/{manifest,expected_handover,expected_findings}.json`."""

    name: str
    # expected metadata + text, only those received by as_of
    documents: list[tuple[DocumentMeta, str]]
    expected_handover: Handover
    expected_findings: list[Finding]

    @property
    def as_of(self) -> dt.date:
        return self.expected_handover.as_of


@dataclass
class Score:
    """Hits out of total, per metric. A rate is None when nothing was scored."""

    hits: float = 0
    total: int = 0
    misses: list[str] = field(default_factory=list)

    def add(self, ok: bool, label: str) -> None:
        self.total += 1
        if ok:
            self.hits += 1
        else:
            self.misses.append(label)

    @property
    def rate(self) -> float | None:
        return self.hits / self.total if self.total else None


@dataclass
class RunResult:
    model: str
    case: str
    metadata: Score
    fields: Score
    examinations: Score
    labs: Score
    evidence: Score
    findings: Score
    false_positives: list[str]
    extra_findings: list[str]
    seconds: float
    prompt_tokens: int
    completion_tokens: int
    error: str | None = None
