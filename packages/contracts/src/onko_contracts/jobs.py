"""Background jobs for slow AI work. The API returns a Job; the UI polls GET /jobs/{id}."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import Field, model_validator

from .common import Model
from .mdt import ConclusionPrefill, MdtResultRow
from .search import CaseAnswer


class JobKind(StrEnum):
    INGEST_DOCUMENT = "ingest_document"  # AI metadata (Q-8) + handover extraction + checks
    DRAFT = "draft"  # a DraftKind in params.kind; the result in Job.draft (S5)
    SUGGEST_TASKS = "suggest_tasks"  # bonus (Q-F3)
    ASK_CASE = "ask_case"  # 'ask the case' over the case's document chunks (S8, Q-I19)


class DraftKind(StrEnum):
    EPICRISIS_SUMMARY = "epicrisis_summary"  # Q-F15, AI
    MDT_QUESTION = "mdt_question"  # Q-F14, AI
    MDT_RESULTS = "mdt_results"  # one-line result rows for the MDT record, AI
    MDT_CONCLUSION = "mdt_conclusion"  # Q-F37: no AI, the MDT_zaver parts that restate the record


TEXT_DRAFTS = frozenset({DraftKind.EPICRISIS_SUMMARY, DraftKind.MDT_QUESTION})


class DraftResult(Model):
    """A draft for the coordinator to edit (S5, Q-F37). Nothing on the case changes until a person
    applies it. Exactly the part of its kind is set."""

    kind: DraftKind
    text: str | None = Field(
        default=None, description="epicrisis_summary, mdt_question: AI text; apply with updateHandoverField"
    )
    rows: list[MdtResultRow] = Field(
        default_factory=list,
        description="mdt_results: AI one-liners, date and examination as in the record; apply with updateMdtRecord",
    )
    fields: ConclusionPrefill | None = Field(
        default=None, description="mdt_conclusion: not AI; apply with upsertMdtConclusion"
    )

    @model_validator(mode="after")
    def _one_part_per_kind(self) -> DraftResult:
        has_text = self.text is not None
        if has_text != (self.kind in TEXT_DRAFTS):
            raise ValueError(f"text is set exactly for {', '.join(sorted(TEXT_DRAFTS))}")
        if self.rows and self.kind is not DraftKind.MDT_RESULTS:
            raise ValueError("rows belong to mdt_results")
        if (self.fields is not None) != (self.kind is DraftKind.MDT_CONCLUSION):
            raise ValueError("fields are set exactly for mdt_conclusion")
        return self


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Job(Model):
    id: str
    kind: JobKind
    case_id: str
    document_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    status: JobStatus = JobStatus.QUEUED
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    result: dict[str, Any] | None = Field(
        default=None, description="Kind ingest_document: counts of the run"
    )
    answer: CaseAnswer | None = Field(
        default=None, description="Kind ask_case, once done; the question is in `params`"
    )
    draft: DraftResult | None = Field(
        default=None, description="Kind draft, once done; the kind is also in `params.kind` (S5)"
    )
