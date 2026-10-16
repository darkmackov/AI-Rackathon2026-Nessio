"""Organisations in the directory: KOCs for the referral picker, facilities, GP practices, insurers."""

from __future__ import annotations

from enum import StrEnum

from pydantic import Field

from .common import Model


class OrganizationKind(StrEnum):
    KOC = "koc"
    CLINIC = "clinic"
    LABORATORY = "laboratory"
    RADIOLOGY = "radiology"
    GP_PRACTICE = "gp_practice"
    INSURER = "insurer"


class Organization(Model):
    id: str
    name: str
    kind: OrganizationKind
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    identifiers: dict[str, str] = Field(
        default_factory=dict, description="e.g. {'icp': '72045318'} or {'kp': '211'} (CZ Core slices)"
    )
