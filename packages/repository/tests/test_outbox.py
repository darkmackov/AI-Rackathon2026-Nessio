"""FHIR outbox (S9, D-14): writes are sent in order and a failed one is retried until it succeeds;
one the FHIR server rejects for good is parked so it can't block the rest.

The sending logic runs against a list-backed store; the IRIS variant (the `fhir_outbox` table in
the same transaction as the save) is opt-in with `ONKO_TEST_IRIS=1`, against a mocked FHIR server.
"""

from __future__ import annotations

import getpass
import os
import re
import threading
import uuid
from datetime import datetime

import httpx
import pytest
from onko_contracts import Case, Task
from onko_repository import IrisRepository, IrisSettings
from onko_repository.adapters.fhir import FhirClient, FhirProjector
from onko_repository.adapters.outbox import Outbox, OutboxEntry

NOW = datetime(2026, 10, 16, 9, 30)


class ListStore:
    def __init__(self, *bundles: dict) -> None:
        self.entries = [OutboxEntry(id=str(i), bundle=b, attempts=0) for i, b in enumerate(bundles)]
        self.errors: list[str] = []
        self.rejected: list[tuple[OutboxEntry, str]] = []

    def oldest_pending(self) -> OutboxEntry | None:
        return self.entries[0] if self.entries else None

    def mark_sent(self, entry_id: str) -> None:
        self.entries = [e for e in self.entries if e.id != entry_id]

    def mark_failed(self, entry_id: str, error: str) -> None:
        self.errors.append(error)
        self.entries = [OutboxEntry(e.id, e.bundle, e.attempts + 1) if e.id == entry_id else e
                        for e in self.entries]

    def mark_rejected(self, entry_id: str, error: str) -> None:
        self.rejected += [(e, error) for e in self.entries if e.id == entry_id]
        self.entries = [e for e in self.entries if e.id != entry_id]

    def count_pending(self) -> int:
        return len(self.entries)


class FlakyServer:
    """Fails the first `failures` sends, then accepts everything."""

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.received: list[dict] = []

    def __call__(self, bundle: dict) -> None:
        if self.failures:
            self.failures -= 1
            raise httpx.ConnectError("FHIR server unreachable")
        self.received.append(bundle)


def test_sends_pending_writes_oldest_first():
    store, server = ListStore({"n": 1}, {"n": 2}), FlakyServer(failures=0)
    assert Outbox(store, server).flush() == 2
    assert server.received == [{"n": 1}, {"n": 2}]
    assert store.count_pending() == 0


def test_a_failed_write_stays_pending_and_blocks_later_ones():
    store, server = ListStore({"n": 1}, {"n": 2}), FlakyServer(failures=1)
    outbox = Outbox(store, server)

    assert outbox.flush() == 0
    assert store.count_pending() == 2  # the newer write never overtakes the failed older one
    assert store.entries[0].attempts == 1
    assert "ConnectError" in store.errors[0]

    assert outbox.flush() == 2
    assert server.received == [{"n": 1}, {"n": 2}]


def _status_error(status: int, outcome: str = "") -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://fhir.example/r4")
    response = httpx.Response(status, text=outcome, request=request)
    return httpx.HTTPStatusError(f"{status}", request=request, response=response)


class RejectingServer:
    """Answers `status` for bundles marked `{"bad": True}`, accepts the rest."""

    def __init__(self, status: int) -> None:
        self.status = status
        self.received: list[dict] = []

    def __call__(self, bundle: dict) -> None:
        if bundle.get("bad"):
            raise _status_error(self.status, "<HSFHIRErr>EmptyValue Patient.name[0].text")
        self.received.append(bundle)


def test_a_rejected_write_is_parked_with_its_error_and_the_rest_still_go_out():
    store, server = ListStore({"bad": True}, {"n": 2}), RejectingServer(400)

    assert Outbox(store, server).flush() == 1

    assert server.received == [{"n": 2}]
    assert store.count_pending() == 0
    [(entry, error)] = store.rejected
    assert entry.bundle == {"bad": True}
    assert "400" in error and "EmptyValue" in error  # the server's OperationOutcome is kept


@pytest.mark.parametrize("status", [408, 409, 429, 500, 503])
def test_a_transient_http_error_keeps_the_write_pending_and_blocks_later_ones(status):
    store, server = ListStore({"bad": True}, {"n": 2}), RejectingServer(status)

    assert Outbox(store, server).flush() == 0

    assert store.count_pending() == 2
    assert store.rejected == []
    assert server.received == []


def test_the_retry_thread_resends_a_write_that_failed_once():
    store = ListStore({"n": 1})
    done = threading.Event()
    server = FlakyServer(failures=1)

    def send(bundle: dict) -> None:
        server(bundle)
        done.set()

    outbox = Outbox(store, send, retry_seconds=0.01)
    outbox.flush()
    assert store.count_pending() == 1
    outbox.start()
    try:
        assert done.wait(timeout=2)
    finally:
        outbox.stop()
    assert server.received == [{"n": 1}]
    assert store.count_pending() == 0


def test_iris_outbox_retries_a_failed_fhir_write():
    if os.environ.get("ONKO_TEST_IRIS") != "1":
        pytest.skip("set ONKO_TEST_IRIS=1 to run the outbox against IRIS")
    settings = IrisSettings()
    if not settings.iris_configured:
        pytest.skip("ONKO_IRIS_CONNECTION_STRING is not set")
    posted: list[dict] = []
    fail = {"status": 503}

    def handler(request: httpx.Request) -> httpx.Response:
        if fail["status"]:
            status, fail["status"] = fail["status"], 0
            return httpx.Response(status)
        posted.append(httpx.Response(200, content=request.content).json())
        return httpx.Response(200, json={"resourceType": "Bundle", "type": "transaction-response"})

    projector = FhirProjector(FhirClient("https://fhir.example/r4",
                                         transport=httpx.MockTransport(handler)))
    user = re.sub(r"[^a-z0-9]", "", getpass.getuser().lower()) or "dev"
    repo = IrisRepository(settings, schema=f"test_{user}_{uuid.uuid4().hex[:8]}",
                          projector=projector, retry_seconds=None)
    try:
        repo.save_case(Case(id="c1", patient_name="Jana Testová", koc_id="koc-a",
                            referring_doctor_id="pl-a", created_at=NOW))
        repo.save_task(Task(id="t1", case_id="c1", title="CT", kind="imaging", owner="koc-a"))

        assert repo.list_tasks("c1")[0].id == "t1"  # the app-state save is never lost
        assert repo.pending_fhir_writes() == 1
        assert repo.outbox is not None and repo.outbox.flush() == 1
        assert repo.pending_fhir_writes() == 0
        [bundle] = posted
        assert bundle["entry"][0]["resource"]["resourceType"] == "Task"

        fail["status"] = 400  # rejected for good: parked, and the next write still goes out
        repo.save_task(Task(id="t2", case_id="c1", title="EUS", kind="biopsy", owner="koc-a"))
        assert repo.pending_fhir_writes() == 0
        assert repo.rejected_fhir_writes() == 1
        repo.save_task(Task(id="t3", case_id="c1", title="Lab", kind="lab", owner="koc-a"))
        assert repo.pending_fhir_writes() == 0
        assert [b["entry"][0]["resource"]["id"] for b in posted[1:]] == ["task-t3"]

        repo.clear()  # the demo reset empties the whole outbox, parked writes too
        assert repo.rejected_fhir_writes() == 0
    finally:
        repo.drop_tables()
        repo.close()
