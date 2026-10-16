"""In-app inbox channel."""

from __future__ import annotations

from onko_contracts import Channel, Message

from ..ports import MessageStore


class InAppInbox:
    """Messages land in the recipient's in-app inbox: delivering one stores it (the GP reads it
    from `listInbox`)."""

    channel = Channel.IN_APP

    def __init__(self, store: MessageStore) -> None:
        self.store = store

    def deliver(self, message: Message) -> None:
        self.store.save_message(message)
