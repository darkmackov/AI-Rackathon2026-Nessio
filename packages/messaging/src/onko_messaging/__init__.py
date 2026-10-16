"""Messaging module: MDT result delivery to the GP, receipts, in-app notifications, patient notices.

Owner: stream C. MVP scope:
- MDT result → the GP's in-app inbox → receipt ('Potvrzuji převzetí') closes the case.
- In-app deadline notifications (Q-F17).
- Patient notices are recorded with `simulated=True` and never delivered (Q-F16).
Not in the MVP: request/reply flows for additional documents (Q-F23; in the MVP a request is a
`Task` in onko_cases), the reviewing-doctor feed (Q-F10), email/SMS adapters.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from onko_contracts import Channel, Message, Receipt


class ChannelAdapter(Protocol):
    channel: Channel

    def deliver(self, message: Message) -> None: ...


class InAppInbox:
    """Messages land in the recipient's in-app inbox (MVP: the GP receiving the MDT result).
    Storage via repository. TODO stream C."""

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
