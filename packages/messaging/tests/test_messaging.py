"""Sending through the in-app inbox, building the MDT result and the patient notice, confirming
receipt (fixed NOW, TEST-3)."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from onko_contracts import Channel, ConclusionSource, MdtConclusion, Message, MessageKind, Receipt
from onko_messaging import (
    AlreadyConfirmedError,
    InAppInbox,
    NotConfirmableError,
    NotRecipientError,
    confirm,
    mdt_result_message,
    patient_notice,
    send,
)

NOW = datetime(2026, 10, 5, 10, 0)


class Store:
    def __init__(self) -> None:
        self.saved: list[Message] = []

    def save_message(self, message: Message) -> None:
        self.saved.append(message)


def _message(kind: MessageKind = MessageKind.CASE_RETURNED) -> Message:
    return Message(id="m1", case_id="c1", kind=kind, sender_id="koord",
                   recipient_ids=["pl"], subject="Vráceno", body="Doplňte ECOG")


def _result(**update) -> Message:
    conclusion = MdtConclusion(case_id="c1", conclusion="Resekabilní, k operaci.",
                               date=date(2026, 10, 21)).model_copy(update=update)
    return mdt_result_message(message_id="m2", case_id="c1", sender_id="koord", recipient_id="pl",
                              conclusion=conclusion, mdt_date=date(2026, 10, 20),
                              attachment_document_ids=["d1"], note="Prosím o kontrolu.")


def test_in_app_send_stores_the_message_with_its_send_time():
    store = Store()
    sent = send(_message(), {Channel.IN_APP: InAppInbox(store)}, NOW)
    assert sent.sent_at == NOW
    assert store.saved == [sent]


def test_mdt_result_has_the_dated_subject_the_note_then_the_conclusion():
    message = _result()
    assert message.kind is MessageKind.MDT_RESULT
    assert message.recipient_ids == ["pl"]
    assert message.subject == "Závěr MDT ze dne 21. 10. 2026"
    assert message.body == "Prosím o kontrolu.\n\nResekabilní, k operaci."
    assert message.attachment_document_ids == ["d1"]
    assert message.sent_at is None


def test_mdt_result_falls_back_to_the_mdt_date_and_an_attached_report():
    message = _result(date=None, conclusion=None, source=ConclusionSource.UPLOADED, document_id="d1")
    assert message.subject == "Závěr MDT ze dne 20. 10. 2026"
    assert message.body == "Prosím o kontrolu.\n\nZávěr MDT v příloze"


def test_mdt_result_without_a_note_is_just_the_conclusion():
    conclusion = MdtConclusion(case_id="c1", conclusion="Resekabilní.")
    message = mdt_result_message(message_id="m2", case_id="c1", sender_id="k", recipient_id="pl",
                                 conclusion=conclusion, mdt_date=None, attachment_document_ids=[])
    assert (message.subject, message.body) == ("Závěr MDT", "Resekabilní.")


def test_patient_notice_is_simulated_with_no_recipients():
    notice = patient_notice(message_id="m3", case_id="c1", sender_id="koord",
                            subject="Termín MDT", body="MDT 21. 10.", now=NOW)
    assert notice.kind is MessageKind.PATIENT_NOTICE
    assert (notice.simulated, notice.recipient_ids, notice.sent_at) == (True, [], NOW)


def test_only_a_recipient_confirms_receipt():
    receipt = confirm(_result(), "pl", NOW)
    assert (receipt.message_id, receipt.recipient_id, receipt.confirmed_at) == ("m2", "pl", NOW)
    with pytest.raises(NotRecipientError):
        confirm(_result(), "koord", NOW)


def test_only_an_mdt_result_is_confirmed():
    with pytest.raises(NotConfirmableError):
        confirm(_message(), "pl", NOW)


def test_a_recipient_confirms_once():
    earlier = Receipt(message_id="m2", recipient_id="pl", confirmed_at=NOW)
    with pytest.raises(AlreadyConfirmedError):
        confirm(_result(), "pl", NOW, receipts=[earlier])
    other = Receipt(message_id="m-other", recipient_id="pl", confirmed_at=NOW)
    assert confirm(_result(), "pl", NOW, receipts=[other]).message_id == "m2"
