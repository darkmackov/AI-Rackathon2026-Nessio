"""DTOs: the only shapes that cross the API boundary to the web app.

Rules (docs/conventions/data.md › API DTOs):
- One `XxxDto` per domain model it mirrors; same field names, snake_case.
- Response DTO fields have no defaults, so every field is required in the generated TS types.
- Domain enums are reused; nothing else from the domain is imported here.
- Mapping domain -> DTO lives in apps/api (`onko_api.mappers`), never here.
"""

from .cases import CaseDto, MilestonesDto, OnHoldDto, TaskDto
from .common import Dto, EvidenceDto, HealthDto, SourcedDto, StampDto
from .documents import DocumentMetaDto, DocumentTextDto
from .findings import FindingDto
from .handover import (
    ContactsDto,
    ExaminationDto,
    HandoverDto,
    LabPanelDto,
    LabValueDto,
    PatientDetailsDto,
)

__all__ = [
    "CaseDto",
    "ContactsDto",
    "DocumentMetaDto",
    "DocumentTextDto",
    "Dto",
    "EvidenceDto",
    "ExaminationDto",
    "FindingDto",
    "HandoverDto",
    "HealthDto",
    "LabPanelDto",
    "LabValueDto",
    "MilestonesDto",
    "OnHoldDto",
    "PatientDetailsDto",
    "SourcedDto",
    "StampDto",
    "TaskDto",
]
