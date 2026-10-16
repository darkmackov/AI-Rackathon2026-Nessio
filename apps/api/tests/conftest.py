"""API tests run on the in-memory fake, even when a dev's .env points at IRIS (PY-9)."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _in_memory_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    # An environment variable beats .env; an empty value means "not configured".
    monkeypatch.setenv("ONKO_IRIS_CONNECTION_STRING", "")
