"""Repository module: the only code that talks to IRIS.

Owner: stream D. `CaseRepository` is the port; `InMemoryRepository` is the fake that every other
module tests against; `IrisRepository` maps contracts <-> FHIR R4 (EU/CZ profiles, see
docs/data-model.md) and uses IRIS SQL for vector chunks. IRIS runs in Azure; each dev supplies
their own connection string (`.env`, see `.env.example`).
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .adapters.iris import IrisRepository
from .adapters.memory import InMemoryRepository
from .ports import CaseRepository
from .settings import IrisConnection, IrisSettings, parse_connection_string

__all__ = [
    "CaseRepository",
    "InMemoryRepository",
    "IrisConnection",
    "IrisRepository",
    "IrisSettings",
    "parse_connection_string",
]
