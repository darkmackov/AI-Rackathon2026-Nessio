"""Background AI jobs (Q-A1): the route saves a queued `Job` and returns, the worker runs it.
Three kinds: document ingest (S2), drafts for the coordinator (S5) and 'ask the case' (S8).

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

from onko_ai import (
    analyse_case,
    apply_metadata,
    ask_case,
    draft,
    draft_results,
    extract_metadata,
    index_document,
    index_missing,
)
from onko_cases import conclusion_prefill, result_rows, sync_case_from_handover
from onko_contracts import CaseAnswer, Job, JobKind, JobStatus, ParsedDocument
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository

from .clock import AppClock

log = logging.getLogger(__name__)

NO_MODEL = "Není nastaven žádný jazykový model (ONKO_MODELS / ONKO_ACTIVE_MODEL)."
NO_EMBED_MODEL = "Není nastaven embedding model (ONKO_EMBED_MODEL)."

# Drafts that need the MDT snapshot and record; the conclusion prefill is not AI (Q-F37).
RECORD_DRAFTS = frozenset({"mdt_results", "mdt_conclusion"})


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


def queue_ask(repo: CaseRepository, now: dt.datetime, case_id: str, question: str) -> Job:
    """'Ask the case' (S8): the answer lands in `job.answer`."""
    job = Job(
        id=new_id("job"),
        kind=JobKind.ASK_CASE,
        case_id=case_id,
        params={"question": question},
        created_at=now,
    )
    repo.save_job(job)
    return job


def run_ingest(job_id: str, repo: CaseRepository, clock: AppClock, gateway: Gateway | None) -> None:
    _run(job_id, repo, clock, gateway, lambda job, gw: {"result": _ingest(job, repo, clock, gw)})


def run_ask(job_id: str, repo: CaseRepository, clock: AppClock, gateway: Gateway | None) -> None:
    _run(job_id, repo, clock, gateway, lambda job, gw: {"answer": _ask(job, repo, clock, gw)})


def queue_draft(repo: CaseRepository, now: dt.datetime, case_id: str, kind: str) -> Job:
    """A draft for the coordinator (S5); `params.kind` is the `DraftKind`."""
    job = Job(id=new_id("job"), kind=JobKind.DRAFT, case_id=case_id, params={"kind": kind},
              created_at=now)
    repo.save_job(job)
    return job


def run_draft(job_id: str, repo: CaseRepository, clock: AppClock, gateway: Gateway | None) -> None:
    # The conclusion prefill needs no model; _draft asks for one where it does.
    _run(job_id, repo, clock, gateway, lambda job, gw: {"result": _draft(job, repo, gw)},
         needs_model=False)


def _require_model(gateway: Gateway | None) -> Gateway:
    if gateway is None:
        raise RuntimeError(NO_MODEL)
    return gateway


def _run(
    job_id: str,
    repo: CaseRepository,
    clock: AppClock,
    gateway: Gateway | None,
    work: Callable[[Job, Any], dict[str, Any]],
    *,
    needs_model: bool = True,
) -> None:
    """Mark the job running, do the work, store what it returns (`result` / `answer`) or the
    error."""
    job = repo.get_job(job_id)
    if job is None:
        return
    job = job.model_copy(update={"status": JobStatus.RUNNING, "started_at": clock.now()})
    repo.save_job(job)
    try:
        if needs_model:
            _require_model(gateway)
        update = work(job, gateway)
        job = job.model_copy(
            update={"status": JobStatus.DONE, "finished_at": clock.now(), **update}
        )
    except Exception as e:
        log.exception("job %s failed", job.id)
        job = job.model_copy(
            update={"status": JobStatus.FAILED, "finished_at": clock.now(), "error": str(e)[:500]}
        )
    repo.save_job(job)


def _draft(job: Job, repo: CaseRepository, gateway: Gateway | None) -> dict[str, Any]:
    """`{text}` for the epikríza summary and the MDT question (from the live handover),
    `{rows}` for the MDT record's result one-liners (from the frozen snapshot), `{fields}` for the
    conclusion prefill (from the MDT record, no model)."""
    kind = job.params["kind"]
    case = repo.get_case(job.case_id)
    if kind == "mdt_conclusion":
        record = repo.get_mdt_record(case.id)
        if record is None:
            raise LookupError("MDT záznam zatím neexistuje.")
        organizations = {o.id: o for o in repo.list_organizations()}
        actors = {a.id: a for a in repo.list_actors()}
        referrer = actors.get(case.referring_doctor_id)
        practice = organizations.get(referrer.organization_id or "") if referrer else None
        return {"fields": conclusion_prefill(record, organizations.get(case.koc_id), referrer,
                                             practice)}
    model = _require_model(gateway)
    if kind == "mdt_results":
        snapshot = repo.get_handover(case.id, snapshot=True)
        if snapshot is None:
            raise LookupError("Podklad pro MDT zatím neexistuje.")
        rows = draft_results(result_rows(snapshot), gateway=model)
        return {"rows": [r.model_dump(mode="json") for r in rows]}
    handover = repo.get_handover(case.id)
    if handover is None:
        raise LookupError("Případ nemá handover.")
    return {"text": draft(kind, handover, repo.list_findings(case.id), gateway=model)}


def _snapshot(repo: CaseRepository, case_id: str, now: dt.datetime) -> list[ParsedDocument]:
    """The case's documents received by `now` (demo backdating)."""
    return [
        ParsedDocument(meta=m, text=repo.document_text(m.id))
        for m in repo.list_documents(case_id)
        if m.received_at is None or m.received_at <= now
    ]


def _index(documents: list[ParsedDocument], document_id: str | None, repo: CaseRepository,
           gateway: Gateway) -> bool:
    """Chunk and embed for vector search (S8): the uploaded document again (its text may be new),
    and any not indexed yet. Without an embedding model (or vector tables), or when it fails,
    extraction still runs; unverified quotes then come without the nearest chunk. True if the
    documents are indexed."""
    if not gateway.can_embed:
        return False
    try:
        for doc in documents:
            if doc.meta.id == document_id:
                index_document(doc, repo, gateway)
        index_missing(documents, repo, gateway)
    except Exception:
        log.exception("indexing documents for vector search failed")
        return False
    return True


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
    documents = _snapshot(repo, case_id, now)
    indexed = _index(documents, job.document_id, repo, gateway)
    handover, findings, _ = analyse_case(
        case_id,
        documents,
        gateway=gateway,
        as_of=now.date(),
        now=now,
        previous_handover=repo.get_handover(case_id),
        previous_findings=repo.list_findings(case_id),
        repo=repo if indexed else None,
    )
    repo.save_handover(handover)
    repo.save_case(sync_case_from_handover(repo.get_case(case_id), handover))
    repo.save_findings(case_id, findings)
    return {"documents": len(documents), "open_findings": sum(not f.resolved for f in findings)}


def _ask(job: Job, repo: CaseRepository, clock: AppClock, gateway: Gateway) -> CaseAnswer:
    assert job.case_id is not None
    return answer(repo, job.case_id, str(job.params["question"]), clock.now(), gateway)


def answer(
    repo: CaseRepository, case_id: str, question: str, now: dt.datetime, gateway: Gateway | None
) -> CaseAnswer:
    """'Ask the case' over the documents received by `now`, run here and now (the job and the MCP
    tool). RuntimeError with a Czech reason without a model or an embedding model."""
    if gateway is None:
        raise RuntimeError(NO_MODEL)
    if not gateway.can_embed:
        raise RuntimeError(NO_EMBED_MODEL)
    return ask_case(case_id, question, _snapshot(repo, case_id, now), repo, gateway)
