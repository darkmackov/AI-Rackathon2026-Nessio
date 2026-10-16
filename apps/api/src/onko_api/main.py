"""FastAPI app. Thin layer over the modules; all models come from onko_contracts.

Run:  uv run uvicorn onko_api.main:app --reload
Data: in-memory fake seeded with the reference case until IrisRepository lands
      (IRIS itself runs in Azure; connection string in .env).
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from onko_contracts import Case, DocumentMeta, Finding, Handover, Task
from onko_repository import CaseRepository, InMemoryRepository, IrisSettings

from .seed import seed_reference_case

repo: CaseRepository = InMemoryRepository()


def _iris_configured() -> bool:
    return IrisSettings().iris_connection_string is not None


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("ONKO_SEED_REFERENCE", "1") == "1":
        seed_reference_case(repo)
    yield


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


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True, "iris_configured": _iris_configured()}


@app.get("/cases")
def list_cases() -> list[Case]:
    return repo.list_cases()


@app.get("/cases/{case_id}")
def get_case(case_id: str) -> Case:
    try:
        return repo.get_case(case_id)
    except KeyError:
        raise HTTPException(404, "case not found") from None


@app.get("/cases/{case_id}/handover")
def get_handover(case_id: str, snapshot: bool = False) -> Handover:
    handover = repo.get_handover(case_id, snapshot=snapshot)
    if handover is None:
        raise HTTPException(404, "no handover yet")
    return handover


@app.get("/cases/{case_id}/findings")
def list_findings(case_id: str) -> list[Finding]:
    return repo.list_findings(case_id)


@app.get("/cases/{case_id}/tasks")
def list_tasks(case_id: str) -> list[Task]:
    return repo.list_tasks(case_id)


@app.get("/cases/{case_id}/documents")
def list_documents(case_id: str) -> list[DocumentMeta]:
    return repo.list_documents(case_id)


@app.get("/documents/{document_id}/text")
def document_text(document_id: str) -> dict[str, str]:
    try:
        return {"id": document_id, "text": repo.document_text(document_id)}
    except KeyError:
        raise HTTPException(404, "document not found") from None
