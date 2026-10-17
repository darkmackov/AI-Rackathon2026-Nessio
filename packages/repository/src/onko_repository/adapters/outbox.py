"""FHIR outbox (D-14): every FHIR write is queued in the same transaction as the app-state save,
then sent and retried until the FHIR server accepts it.

Writes go out strictly in order, oldest first, and a failure ends the round: a later write never
lands before an earlier one, so an older state can't overwrite a newer one. A write the FHIR server
rejects for good (a 4xx other than 408, 409 or 429) would block every later one, so it is parked
instead: kept with its error, never resent, counted apart, and the round goes on. The store (an IRIS SQL
table in `iris.py`) is behind `OutboxStore`, so the sending logic is tested without IRIS.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

log = logging.getLogger(__name__)

Resource = dict[str, Any]

DEFAULT_RETRY_SECONDS = 10.0

# 4xx answers that may succeed when resent: timeout, conflict, rate limit.
_RETRYABLE_4XX = {408, 409, 429}


@dataclass(frozen=True)
class OutboxEntry:
    id: str
    bundle: Resource
    attempts: int


class OutboxStore(Protocol):
    def oldest_pending(self) -> OutboxEntry | None: ...
    def mark_sent(self, entry_id: str) -> None: ...
    def mark_failed(self, entry_id: str, error: str) -> None: ...
    def mark_rejected(self, entry_id: str, error: str) -> None: ...
    def count_pending(self) -> int: ...


def rejected(exc: Exception) -> bool:
    """The FHIR server refused the write itself: resending the same Bundle fails the same way."""
    if not isinstance(exc, httpx.HTTPStatusError):
        return False
    status = exc.response.status_code
    return 400 <= status < 500 and status not in _RETRYABLE_4XX


def _error(exc: Exception) -> str:
    """The error with the server's answer (an `OperationOutcome`), for `last_error`."""
    error = f"{type(exc).__name__}: {exc}"
    if isinstance(exc, httpx.HTTPStatusError):
        error += f"\n{exc.response.text}"
    return error[:2000]


class Outbox:
    """Sends the queued writes; `start()` adds a daemon thread that retries what failed."""

    def __init__(
        self,
        store: OutboxStore,
        send: Callable[[Resource], None],
        *,
        retry_seconds: float = DEFAULT_RETRY_SECONDS,
    ) -> None:
        self.store = store
        self.send = send
        self.retry_seconds = retry_seconds
        self._send_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def flush(self) -> int:
        """Send pending writes oldest first until one fails; a rejected one is parked and the round
        goes on. Returns how many were sent."""
        sent = 0
        with self._send_lock:  # the save path and the retry thread never send concurrently
            while (entry := self.store.oldest_pending()) is not None:
                try:
                    self.send(entry.bundle)
                except Exception as exc:  # noqa: BLE001 - any other failure keeps the write queued
                    if rejected(exc):
                        log.error("FHIR write %s rejected, parked (attempt %d): %s",
                                  entry.id, entry.attempts + 1, _error(exc))
                        self.store.mark_rejected(entry.id, _error(exc))
                        continue
                    log.warning("FHIR write %s failed (attempt %d): %s",
                                entry.id, entry.attempts + 1, exc)
                    self.store.mark_failed(entry.id, _error(exc))
                    break
                self.store.mark_sent(entry.id)
                sent += 1
        return sent

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="onko-fhir-outbox", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.wait(self.retry_seconds):
            try:
                if self.store.count_pending():
                    self.flush()
            except Exception:  # a dropped IRIS link must not kill the retry thread
                log.exception("FHIR outbox retry round failed")
