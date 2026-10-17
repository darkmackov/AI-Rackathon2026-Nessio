"""Jobs left queued/running by a previous process fail on startup, so they don't block the MDT."""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient
from onko_api import main
from onko_api.jobs import INTERRUPTED, fail_interrupted
from onko_api.seed import seed_reference_case
from onko_cases import pending_ingest
from onko_contracts import Job, JobKind, JobStatus
from onko_repository import InMemoryRepository

CASE = "vzp-prochazkova"
NOW = dt.datetime(2026, 10, 20, 9, 0)
EARLIER = dt.datetime(2026, 10, 20, 8, 0)


def _job(job_id: str, status: JobStatus) -> Job:
    return Job(id=job_id, kind=JobKind.INGEST_DOCUMENT, case_id=CASE, status=status,
               created_at=EARLIER)


@pytest.fixture
def repo() -> InMemoryRepository:
    repo = InMemoryRepository()
    seed_reference_case(repo)
    for job_id, status in [("job-q", JobStatus.QUEUED), ("job-r", JobStatus.RUNNING),
                           ("job-d", JobStatus.DONE)]:
        repo.save_job(_job(job_id, status))
    return repo


def test_queued_and_running_jobs_fail_with_a_reason(repo):
    assert sorted(fail_interrupted(repo, NOW)) == ["job-q", "job-r"]
    for job_id in ("job-q", "job-r"):
        job = repo.get_job(job_id)
        assert (job.status, job.error, job.finished_at) == (JobStatus.FAILED, INTERRUPTED, NOW)
    assert repo.get_job("job-d").status is JobStatus.DONE
    assert pending_ingest(repo.list_jobs(CASE)) == []


def test_api_startup_fails_interrupted_jobs(repo, monkeypatch):
    monkeypatch.setattr(main, "make_repository", lambda: repo)
    with TestClient(main.app) as client:
        assert client.get("/jobs/job-r").json()["status"] == "failed"
