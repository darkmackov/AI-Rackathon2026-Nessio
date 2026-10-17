"""FastAPI app. Thin layer over the modules; all models come from onko_contracts.

Run:  uv run uvicorn onko_api.main:app --reload
Data: IrisRepository when ONKO_IRIS_CONNECTION_STRING is set in .env (the shared IRIS in Azure),
      otherwise the in-memory fake. Either way an empty store is seeded with the reference case.
MCP:  the read-only MCP server for agents at `/mcp` (S10, mcp.py).
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
from .jobs import fail_interrupted
from .mcp import build_mcp
from .queries import search_cases
from .routes import _case_or_404, router
from .seed import load_directory, seed_reference_case, seed_task_sets


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
    seed_task_sets(repo)  # stores that predate S4 get the starter set too
    if os.environ.get("ONKO_SEED_REFERENCE", "1") == "1" and not repo.list_cases():
        seed_reference_case(repo)
    app.state.repo = repo
    app.state.clock = AppClock()  # wall clock until /demo/clock or /demo/reset moves it
    fail_interrupted(repo, app.state.clock.now())  # the previous process's worker is gone
    app.state.gateway = make_gateway()
    app.state.jobs = ThreadPoolExecutor(max_workers=1, thread_name_prefix="onko-job")
    async with mcp_app.lifespan(mcp_app):  # the MCP session manager
        yield
    app.state.jobs.shutdown(wait=False, cancel_futures=True)
    if isinstance(repo, IrisRepository):
        repo.close()


mcp_app = build_mcp(
    lambda: app.state.repo, lambda: app.state.clock, lambda: app.state.gateway
).http_app(path="/mcp", stateless_http=True, json_response=True)

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
def health(repo: Repo) -> dict[str, bool | int]:
    """`fhir_pending`: FHIR writes still waiting in the outbox (D-14), never silent."""
    # fhir_rejected: writes the FHIR server refused for good, parked in the outbox with their error
    return {"ok": True, "iris_configured": _iris_configured(),
            "fhir_pending": repo.pending_fhir_writes(),
            "fhir_rejected": repo.rejected_fhir_writes()}


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
    return search_cases(
        repo, referring_doctor_id=referring_doctor_id, koc_id=koc_id, state=state, queue=queue
    )


@app.get("/cases/{case_id}", tags=["cases"])
def get_case(case_id: str, repo: Repo) -> Case:
    return _case_or_404(repo, case_id)


@app.get("/cases/{case_id}/handover", tags=["handover"])
def get_handover(case_id: str, repo: Repo, snapshot: bool = False) -> Handover:
    _case_or_404(repo, case_id)
    handover = repo.get_handover(case_id, snapshot=snapshot)
    if handover is None:
        raise HTTPException(404, "no handover yet")
    return handover


@app.get("/cases/{case_id}/findings", tags=["findings"])
def list_findings(case_id: str, repo: Repo) -> list[Finding]:
    _case_or_404(repo, case_id)
    return repo.list_findings(case_id)


@app.get("/cases/{case_id}/tasks", tags=["tasks"])
def list_tasks(case_id: str, repo: Repo) -> list[Task]:
    _case_or_404(repo, case_id)
    return repo.list_tasks(case_id)


@app.get("/cases/{case_id}/documents", tags=["documents"])
def list_documents(case_id: str, repo: Repo) -> list[DocumentMeta]:
    _case_or_404(repo, case_id)
    return repo.list_documents(case_id)


@app.get("/documents/{document_id}/text", tags=["documents"])
def document_text(document_id: str, repo: Repo) -> dict[str, str]:
    try:
        return {"id": document_id, "text": repo.document_text(document_id)}
    except KeyError:
        raise HTTPException(404, "document not found") from None


# Last, so it never shadows a route: the MCP endpoint is the mounted app's own `/mcp` route.
app.mount("/", mcp_app)
