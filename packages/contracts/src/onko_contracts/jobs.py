"""Background jobs for slow AI work. The API returns a Job; the UI polls GET /jobs/{id}."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from .common import Model
from .search import CaseAnswer


class JobKind(StrEnum):
    INGEST_DOCUMENT = "ingest_document"  # AI metadata (Q-8) + handover extraction + checks
    DRAFT = "draft"  # epicrisis_summary | mdt_question | mdt_conclusion
    SUGGEST_TASKS = "suggest_tasks"  # bonus (Q-F3)
    ASK_CASE = "ask_case"  # 'ask the case' over the case's document chunks (S8, Q-I19)


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
    result: dict[str, Any] | None = Field(default=None, description="e.g. {'text': ...} for drafts")
    answer: CaseAnswer | None = Field(
        default=None, description="Kind ask_case, once done; the question is in `params`"
    )
