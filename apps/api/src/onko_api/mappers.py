"""Domain -> DTO mapping. The only place where domain models become DTOs.

Mirror DTOs are built with `XxxDto.model_validate(domain)` (DTOs have `from_attributes`).
Anything renamed, derived or hidden is written out field by field in its mapper.
"""

from __future__ import annotations

from onko_contracts import Case, DocumentMeta, Finding, Handover, Task
from onko_contracts.dto import CaseDto, DocumentMetaDto, FindingDto, HandoverDto, TaskDto


def case_to_dto(case: Case) -> CaseDto:
    return CaseDto.model_validate(case)


def task_to_dto(task: Task) -> TaskDto:
    return TaskDto.model_validate(task)


def document_meta_to_dto(meta: DocumentMeta) -> DocumentMetaDto:
    return DocumentMetaDto.model_validate(meta)


def handover_to_dto(handover: Handover) -> HandoverDto:
    return HandoverDto.model_validate(handover)


def finding_to_dto(finding: Finding) -> FindingDto:
    return FindingDto.model_validate(finding)
