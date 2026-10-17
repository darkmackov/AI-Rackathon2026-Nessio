"""Sending messages, building the MDT result and the patient notice, and confirming receipt."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime

from onko_contracts import Channel, MdtConclusion, Message, MessageKind, Receipt

from .models import AlreadyConfirmedError, NotConfirmableError, NotRecipientError
from .ports import ChannelAdapter

ATTACHED_REPORT = "Závěr MDT v příloze"


def send(message: Message, adapters: dict[Channel, ChannelAdapter], now: datetime) -> Message:
    sent = message.model_copy(update={"sent_at": now})
    adapters[message.channel].deliver(sent)
    return sent


def _czech_date(day: date) -> str:
    return f"{day.day}. {day.month}. {day.year}"


def mdt_result_message(
    *,
    message_id: str,
    case_id: str,
    sender_id: str,
    recipient_id: str,
    conclusion: MdtConclusion,
    mdt_date: date | None,
    attachment_document_ids: list[str],
    note: str | None = None,
) -> Message:
    """The MDT result for the referring doctor (not sent yet). Subject: 'Závěr MDT ze dne …' (the
    conclusion's date, else the MDT date). Body: the coordinator's note, then the conclusion text;
    an uploaded report without text says it is attached."""
    held = conclusion.date or mdt_date
    subject = f"Závěr MDT ze dne {_czech_date(held)}" if held else "Závěr MDT"
    text = (conclusion.conclusion or "").strip() or ATTACHED_REPORT
    parts = [p for p in ((note or "").strip(), text) if p]
    return Message(
        id=message_id,
        case_id=case_id,
        kind=MessageKind.MDT_RESULT,
        sender_id=sender_id,
        recipient_ids=[recipient_id],
        subject=subject,
        body="\n\n".join(parts),
        attachment_document_ids=attachment_document_ids,
    )


def patient_notice(
    *, message_id: str, case_id: str, sender_id: str, subject: str, body: str, now: datetime
) -> Message:
    """'Informovat pacienta' (Q-F16): recorded as sent at `now`, `simulated=True`, with no
    recipients, so it lands in no inbox. It never goes through a channel adapter."""
    return Message(
        id=message_id,
        case_id=case_id,
        kind=MessageKind.PATIENT_NOTICE,
        sender_id=sender_id,
        recipient_ids=[],
        subject=subject,
        body=body,
        sent_at=now,
        simulated=True,
    )


def confirm(
    message: Message, recipient_id: str, now: datetime, *, receipts: Iterable[Receipt] = ()
) -> Receipt:
    """'Potvrzuji převzetí': the receipt that lets the case close. Only for an MDT result, only by
    a recipient, once per recipient (`receipts` = those already stored for the case)."""
    if recipient_id not in message.recipient_ids:
        raise NotRecipientError("Only a recipient can confirm receipt")
    if message.kind is not MessageKind.MDT_RESULT:
        raise NotConfirmableError(f"receipt is confirmed for {MessageKind.MDT_RESULT}, not {message.kind}")
    if any(r.message_id == message.id and r.recipient_id == recipient_id for r in receipts):
        raise AlreadyConfirmedError("receipt already confirmed")
    return Receipt(message_id=message.id, recipient_id=recipient_id, confirmed_at=now)
