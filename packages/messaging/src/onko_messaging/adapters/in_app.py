"""In-app inbox channel."""

from __future__ import annotations

from onko_contracts import Channel, Message


class InAppInbox:
    """Messages land in the recipient's in-app inbox (MVP: the GP receiving the MDT result).
    Storage via repository. TODO stream C."""

    channel = Channel.IN_APP

    def deliver(self, message: Message) -> None:
        raise NotImplementedError
