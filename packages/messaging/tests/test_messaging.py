"""Sending through the in-app inbox (fixed NOW, TEST-3)."""

from __future__ import annotations

from datetime import datetime

import pytest
from onko_contracts import Channel, Message, MessageKind
from onko_messaging import InAppInbox, confirm, send

NOW = datetime(2026, 10, 5, 10, 0)


class Store:
    def __init__(self) -> None:
        self.saved: list[Message] = []

    def save_message(self, message: Message) -> None:
        self.saved.append(message)


def _message() -> Message:
    return Message(id="m1", case_id="c1", kind=MessageKind.CASE_RETURNED, sender_id="koord",
                   recipient_ids=["pl"], subject="Vráceno", body="Doplňte ECOG")


def test_in_app_send_stores_the_message_with_its_send_time():
    store = Store()
    sent = send(_message(), {Channel.IN_APP: InAppInbox(store)}, NOW)
    assert sent.sent_at == NOW
    assert store.saved == [sent]


def test_only_a_recipient_confirms_receipt():
    receipt = confirm(_message(), "pl", NOW)
    assert (receipt.recipient_id, receipt.confirmed_at) == ("pl", NOW)
    with pytest.raises(ValueError):
        confirm(_message(), "koord", NOW)
