"""Module-local types of the repository: what a referral FHIR Bundle hands over (S9)."""

from __future__ import annotations

from dataclasses import dataclass


class BundleError(ValueError):
    """The upload is not a FHIR Bundle we can take a referral from."""


class FhirExportUnavailableError(RuntimeError):
    """This repository has no configured FHIR exchange server."""


class FhirExportError(RuntimeError):
    """The FHIR server could not supply a complete export."""


@dataclass(frozen=True)
class ReferralAttachment:
    """One document carried by a referral Bundle, with its original bytes. Structured resources
    are not mapped until Q-I21 decides how they enter the handover; documents go through the
    normal extraction (S2)."""

    filename: str
    mime_type: str | None
    data: bytes
