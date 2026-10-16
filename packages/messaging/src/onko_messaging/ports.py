"""Interfaces of the messaging module: one adapter per delivery channel."""

from __future__ import annotations

from typing import Protocol

from onko_contracts import Channel, Message


class ChannelAdapter(Protocol):
    channel: Channel

    def deliver(self, message: Message) -> None: ...


class MessageStore(Protocol):
    """Where in-app messages are kept; the `CaseRepository` is one."""

    def save_message(self, message: Message) -> None: ...
