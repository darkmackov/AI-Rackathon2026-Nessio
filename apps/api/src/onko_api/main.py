"""FastAPI app. Thin layer over the modules.

Routes take and return DTOs from `onko_contracts.dto` only; domain models are mapped in `mappers`.

Run:  uv run uvicorn onko_api.main:app --reload
Data: in-memory fake seeded with the reference case until IrisRepository lands
      (IRIS itself runs in Azure; connection string in .env).
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from onko_contracts.dto import (
    CaseDto,
    DocumentMetaDto,
    DocumentTextDto,
    FindingDto,
    HandoverDto,
    HealthDto,
    TaskDto,
)
from onko_repository import CaseRepository, InMemoryRepository, IrisSettings

from .mappers import case_to_dto, document_meta_to_dto, finding_to_dto, handover_to_dto, task_to_dto
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
def health() -> HealthDto:
    return HealthDto(ok=True, iris_configured=_iris_configured())


@app.get("/cases")
def list_cases() -> list[CaseDto]:
    return [case_to_dto(c) for c in repo.list_cases()]


@app.get("/cases/{case_id}")
def get_case(case_id: str) -> CaseDto:
    try:
        return case_to_dto(repo.get_case(case_id))
    except KeyError:
        raise HTTPException(404, "case not found") from None


@app.get("/cases/{case_id}/handover")
def get_handover(case_id: str, snapshot: bool = False) -> HandoverDto:
    handover = repo.get_handover(case_id, snapshot=snapshot)
    if handover is None:
        raise HTTPException(404, "no handover yet")
    return handover_to_dto(handover)


@app.get("/cases/{case_id}/findings")
def list_findings(case_id: str) -> list[FindingDto]:
    return [finding_to_dto(f) for f in repo.list_findings(case_id)]


@app.get("/cases/{case_id}/tasks")
def list_tasks(case_id: str) -> list[TaskDto]:
    return [task_to_dto(t) for t in repo.list_tasks(case_id)]


@app.get("/cases/{case_id}/documents")
def list_documents(case_id: str) -> list[DocumentMetaDto]:
    return [document_meta_to_dto(m) for m in repo.list_documents(case_id)]


@app.get("/documents/{document_id}/text")
def document_text(document_id: str) -> DocumentTextDto:
    try:
        return DocumentTextDto(id=document_id, text=repo.document_text(document_id))
    except KeyError:
        raise HTTPException(404, "document not found") from None
