"""Messaging module: requests for missing information, MDT result delivery, receipts.

Owner: stream C. The MVP channel is the in-app inbox; email/SMS are adapters behind `ChannelAdapter`.
The reviewing doctor (revizní lékař of the patient's insurer) gets every MDT result automatically (MessageKind.REVIEW_FEED).
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from onko_contracts import Channel, Message, Receipt


class ChannelAdapter(Protocol):
    channel: Channel

    def deliver(self, message: Message) -> None: ...


class InAppInbox:
    """Messages land in the recipient's inbox in the app. Storage via repository. TODO stream C."""

    channel = Channel.IN_APP

    def deliver(self, message: Message) -> None:
        raise NotImplementedError


def send(message: Message, adapters: dict[Channel, ChannelAdapter], now: datetime) -> Message:
    sent = message.model_copy(update={"sent_at": now})
    adapters[message.channel].deliver(sent)
    return sent


def confirm(message: Message, recipient_id: str, now: datetime) -> Receipt:
    """'Potvrzuji převzetí': the receipt that lets the case close."""
    if recipient_id not in message.recipient_ids:
        raise ValueError("Only a recipient can confirm receipt")
    return Receipt(message_id=message.id, recipient_id=recipient_id, confirmed_at=now)


__all__ = ["ChannelAdapter", "InAppInbox", "confirm", "send"]
