"""Requests, deliveries and receipts (maps to FHIR Communication)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field

from .common import Model


class Channel(StrEnum):
    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"


class MessageKind(StrEnum):
    DOCUMENT_REQUEST = "document_request"  # Phase 2 (Q-F23); in the MVP a request is a Task
    INFO_REQUEST = "info_request"  # Phase 2 (Q-F23)
    MDT_RESULT = "mdt_result"  # závěr MDT pro referujícího lékaře
    REVIEW_FEED = "review_feed"  # reviewing doctor of the patient's insurer (not in MVP, Q-F10)
    PATIENT_NOTICE = "patient_notice"  # button + logic, never actually sent in the demo (Q-F16)
    NOTIFICATION = "notification"  # in-app deadline notifications (Q-F17)


class Message(Model):
    id: str
    case_id: str
    kind: MessageKind
    channel: Channel = Channel.IN_APP
    sender_id: str
    recipient_ids: list[str]
    subject: str
    body: str
    attachment_document_ids: list[str] = Field(default_factory=list)
    finding_id: str | None = Field(default=None, description="The gap this message relates to")
    sent_at: datetime | None = None
    simulated: bool = Field(default=False, description="Recorded as sent but not delivered externally")


class DueNotice(Model):
    """In-app deadline notification derived from tasks (Q-F17)."""

    task_id: str
    case_id: str
    title: str
    due: datetime
    overdue: bool


class Receipt(Model):
    """Confirmed delivery: 'Potvrzuji převzetí'."""

    message_id: str
    recipient_id: str
    confirmed_at: datetime
