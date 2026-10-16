"""FastAPI app. Thin layer over the modules; all models come from onko_contracts.

Run:  uv run uvicorn onko_api.main:app --reload
Data: IrisRepository when ONKO_IRIS_CONNECTION_STRING is set in .env (the shared IRIS in Azure),
      otherwise the in-memory fake. Either way an empty store is seeded with the reference case.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from onko_contracts import Case, CaseState, DocumentMeta, Finding, Handover, QueueColumn, Task
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository, InMemoryRepository, IrisRepository, IrisSettings

from .clock import AppClock
from .deps import Repo
from .routes import router
from .seed import load_directory, seed_reference_case


def _iris_configured() -> bool:
    return IrisSettings().iris_configured


def make_gateway() -> Gateway | None:
    """The active model from .env (Q-M1); None when no model is configured (AI jobs then fail)."""
    try:
        return Gateway.from_env()
    except (KeyError, ValueError):
        return None


def make_repository() -> CaseRepository:
    """IRIS when it is configured in .env, otherwise the in-memory fake (S7)."""
    settings = IrisSettings()
    return IrisRepository(settings) if settings.iris_configured else InMemoryRepository()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global repo
    repo = make_repository()
    # Seed only an empty store: IRIS keeps the demo state (and roster edits) across restarts.
    if not repo.list_organizations():
        load_directory(repo)
    if os.environ.get("ONKO_SEED_REFERENCE", "1") == "1" and not repo.list_cases():
        seed_reference_case(repo)
    app.state.repo = repo
    app.state.clock = AppClock()  # wall clock until /demo/clock or /demo/reset moves it
    app.state.gateway = make_gateway()
    app.state.jobs = ThreadPoolExecutor(max_workers=1, thread_name_prefix="onko-job")
    yield
    app.state.jobs.shutdown(wait=False, cancel_futures=True)
    if isinstance(repo, IrisRepository):
        repo.close()


app = FastAPI(
    title="Onko-koordinace API",
    version="0.1.0",
    lifespan=lifespan,
    generate_unique_id_function=lambda route: route.name,  # clean names in the generated web client
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ONKO_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health", tags=["system"])
def health() -> dict[str, bool]:
    return {"ok": True, "iris_configured": _iris_configured()}


@app.get("/cases", tags=["cases"])
def list_cases(
    repo: Repo,
    referring_doctor_id: str | None = None,
    koc_id: str | None = None,
    state: CaseState | None = None,
    queue: QueueColumn | None = None,
) -> list[Case]:
    """Coordinator dashboard (filter by koc_id) or the GP's own referrals (referring_doctor_id).
    Drafts (koncept) only appear when filtering by their referring doctor."""
    cases = repo.list_cases()
    if referring_doctor_id is None:
        cases = [c for c in cases if c.state is not CaseState.DRAFT]
    return [
        c
        for c in cases
        if (referring_doctor_id is None or c.referring_doctor_id == referring_doctor_id)
        and (koc_id is None or c.koc_id == koc_id)
        and (state is None or c.state is state)
        and (queue is None or c.queue is queue)
    ]


@app.get("/cases/{case_id}", tags=["cases"])
def get_case(case_id: str, repo: Repo) -> Case:
    try:
        return repo.get_case(case_id)
    except KeyError:
        raise HTTPException(404, "case not found") from None


@app.get("/cases/{case_id}/handover", tags=["handover"])
def get_handover(case_id: str, repo: Repo, snapshot: bool = False) -> Handover:
    handover = repo.get_handover(case_id, snapshot=snapshot)
    if handover is None:
        raise HTTPException(404, "no handover yet")
    return handover


@app.get("/cases/{case_id}/findings", tags=["findings"])
def list_findings(case_id: str, repo: Repo) -> list[Finding]:
    return repo.list_findings(case_id)


@app.get("/cases/{case_id}/tasks", tags=["tasks"])
def list_tasks(case_id: str, repo: Repo) -> list[Task]:
    return repo.list_tasks(case_id)


@app.get("/cases/{case_id}/documents", tags=["documents"])
def list_documents(case_id: str, repo: Repo) -> list[DocumentMeta]:
    return repo.list_documents(case_id)


@app.get("/documents/{document_id}/text", tags=["documents"])
def document_text(document_id: str, repo: Repo) -> dict[str, str]:
    try:
        return {"id": document_id, "text": repo.document_text(document_id)}
    except KeyError:
        raise HTTPException(404, "document not found") from None
