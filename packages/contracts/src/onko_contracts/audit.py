"""Audit trail kept on every case (state 'Uzavřeno' keeps it, slide 10)."""

from __future__ import annotations

from datetime import datetime

from .common import Model


class AuditEvent(Model):
    id: str
    case_id: str
    at: datetime
    actor_id: str
    action: str
    detail: str | None = None
