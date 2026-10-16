"""In-app inbox channel."""

from __future__ import annotations

from onko_contracts import Channel, Message


class InAppInbox:
    """Messages land in the recipient's inbox in the app. Storage via repository. TODO stream C."""

    channel = Channel.IN_APP

    def deliver(self, message: Message) -> None:
        raise NotImplementedError
