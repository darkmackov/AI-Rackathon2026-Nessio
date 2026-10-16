"""Mirror DTOs must carry exactly what their domain model holds (checked on the reference case)."""

from onko_api.mappers import (
    case_to_dto,
    document_meta_to_dto,
    finding_to_dto,
    handover_to_dto,
    task_to_dto,
)
from onko_api.seed import CASE_ID, seed_reference_case
from onko_repository import InMemoryRepository


def _same(domain, dto) -> None:
    assert dto.model_dump(mode="json") == domain.model_dump(mode="json")


def test_mirror_dtos_match_domain():
    repo = InMemoryRepository()
    seed_reference_case(repo)

    _same(repo.get_case(CASE_ID), case_to_dto(repo.get_case(CASE_ID)))
    handover = repo.get_handover(CASE_ID)
    _same(handover, handover_to_dto(handover))
    for task in repo.list_tasks(CASE_ID):
        _same(task, task_to_dto(task))
    for meta in repo.list_documents(CASE_ID):
        _same(meta, document_meta_to_dto(meta))
    for finding in repo.list_findings(CASE_ID):
        _same(finding, finding_to_dto(finding))
