"""Sending messages and confirming receipt."""

from __future__ import annotations

from datetime import datetime

from onko_contracts import Channel, Message, Receipt

from .ports import ChannelAdapter


def send(message: Message, adapters: dict[Channel, ChannelAdapter], now: datetime) -> Message:
    sent = message.model_copy(update={"sent_at": now})
    adapters[message.channel].deliver(sent)
    return sent


def confirm(message: Message, recipient_id: str, now: datetime) -> Receipt:
    """'Potvrzuji převzetí': the receipt that lets the case close."""
    if recipient_id not in message.recipient_ids:
        raise ValueError("Only a recipient can confirm receipt")
    return Receipt(message_id=message.id, recipient_id=recipient_id, confirmed_at=now)
