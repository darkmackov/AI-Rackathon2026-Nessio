"""FHIR outbox (D-14): every FHIR write is queued in the same transaction as the app-state save,
then sent and retried until the FHIR server accepts it.

Writes go out strictly in order, oldest first, and a failure ends the round: a later write never
lands before an earlier one, so an older state can't overwrite a newer one. The store (an IRIS SQL
table in `iris.py`) is behind `OutboxStore`, so the sending logic is tested without IRIS.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

log = logging.getLogger(__name__)

Resource = dict[str, Any]

DEFAULT_RETRY_SECONDS = 10.0


@dataclass(frozen=True)
class OutboxEntry:
    id: str
    bundle: Resource
    attempts: int


class OutboxStore(Protocol):
    def oldest_pending(self) -> OutboxEntry | None: ...
    def mark_sent(self, entry_id: str) -> None: ...
    def mark_failed(self, entry_id: str, error: str) -> None: ...
    def count_pending(self) -> int: ...


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
        """Send pending writes oldest first until one fails. Returns how many were sent."""
        sent = 0
        with self._send_lock:  # the save path and the retry thread never send concurrently
            while (entry := self.store.oldest_pending()) is not None:
                try:
                    self.send(entry.bundle)
                except Exception as exc:  # noqa: BLE001 - any failure keeps the write queued
                    log.warning("FHIR write %s failed (attempt %d): %s",
                                entry.id, entry.attempts + 1, exc)
                    self.store.mark_failed(entry.id, f"{type(exc).__name__}: {exc}"[:2000])
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
