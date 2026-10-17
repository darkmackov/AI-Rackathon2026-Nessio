"""Repository module: the only code that talks to IRIS.

Owner: stream D. `CaseRepository` is the port; `InMemoryRepository` is the fake that every other
module tests against; `IrisRepository` maps contracts <-> FHIR R4 (EU/CZ profiles, see
docs/data-model.md) and keeps document chunks and the MKN-10 code list in IRIS `VECTOR` columns
(S8). IRIS runs in Azure; each dev supplies their own connection string (`.env`, see
`.env.example`).
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .adapters.fhir import referral_attachments
from .adapters.iris import IrisRepository
from .adapters.memory import InMemoryRepository
from .models import BundleError, FhirExportError, FhirExportUnavailableError, ReferralAttachment
from .ports import CaseRepository
from .settings import IrisConnection, IrisSettings, parse_connection_string

__all__ = [
    "BundleError",
    "CaseRepository",
    "FhirExportError",
    "FhirExportUnavailableError",
    "InMemoryRepository",
    "IrisConnection",
    "IrisRepository",
    "IrisSettings",
    "ReferralAttachment",
    "parse_connection_string",
    "referral_attachments",
]
