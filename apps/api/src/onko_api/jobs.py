"""Background AI jobs (Q-A1): the route saves a queued `Job` and returns, the worker runs it.

One worker thread (`max_workers=1`), so per-case extraction runs one at a time and two uploads to
the same case never merge over each other. Tests swap in `ImmediateExecutor`.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections.abc import Callable
from concurrent.futures import Executor, Future
from typing import Any

from onko_ai import analyse_case, apply_metadata, extract_metadata
from onko_contracts import Job, JobKind, JobStatus, ParsedDocument
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository

from .clock import AppClock

log = logging.getLogger(__name__)


class ImmediateExecutor(Executor):
    """Runs a job inside `submit` (tests: no threads, deterministic order)."""

    def submit(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        future: Future = Future()
        future.set_result(fn(*args, **kwargs))
        return future


def new_id(prefix: str) -> str:
    """`doc-1a2b3c4d` / `job-…` (Q-K9: short random ids for new documents and jobs)."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def queue_ingest(
    repo: CaseRepository, now: dt.datetime, case_id: str, document_id: str | None
) -> Job:
    """`document_id` set: AI metadata for that document, then the whole case. None: re-extract."""
    job = Job(
        id=new_id("job"),
        kind=JobKind.INGEST_DOCUMENT,
        case_id=case_id,
        document_id=document_id,
        created_at=now,
    )
    repo.save_job(job)
    return job


def run_ingest(job_id: str, repo: CaseRepository, clock: AppClock, gateway: Gateway | None) -> None:
    job = repo.get_job(job_id)
    if job is None:
        return
    job = job.model_copy(update={"status": JobStatus.RUNNING, "started_at": clock.now()})
    repo.save_job(job)
    try:
        if gateway is None:
            raise RuntimeError(
                "Není nastaven žádný jazykový model (ONKO_MODELS / ONKO_ACTIVE_MODEL)."
            )
        result = _ingest(job, repo, clock, gateway)
        job = job.model_copy(
            update={"status": JobStatus.DONE, "finished_at": clock.now(), "result": result}
        )
    except Exception as e:
        log.exception("job %s failed", job.id)
        job = job.model_copy(
            update={"status": JobStatus.FAILED, "finished_at": clock.now(), "error": str(e)[:500]}
        )
    repo.save_job(job)


def _ingest(job: Job, repo: CaseRepository, clock: AppClock, gateway: Gateway) -> dict[str, Any]:
    case_id = job.case_id
    assert case_id is not None
    if job.document_id is not None:
        meta = repo.get_document(job.document_id)
        if meta is None:
            raise KeyError(f"document {job.document_id} not found")
        draft = extract_metadata(repo.document_text(meta.id), gateway, document_id=meta.id)
        repo.update_document(apply_metadata(meta, draft))

    now = clock.now()
    documents = [
        ParsedDocument(meta=m, text=repo.document_text(m.id))
        for m in repo.list_documents(case_id)
        if m.received_at is None or m.received_at <= now
    ]
    handover, findings, _ = analyse_case(
        case_id,
        documents,
        gateway=gateway,
        as_of=now.date(),
        now=now,
        previous_handover=repo.get_handover(case_id),
        previous_findings=repo.list_findings(case_id),
    )
    repo.save_handover(handover)
    repo.save_findings(case_id, findings)
    return {"documents": len(documents), "open_findings": sum(not f.resolved for f in findings)}
