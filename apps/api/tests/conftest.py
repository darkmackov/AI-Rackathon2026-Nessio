"""API tests run on the in-memory fake, even when a dev's .env points at IRIS (PY-9)."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _in_memory_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    # An environment variable beats .env; an empty value means "not configured".
    monkeypatch.setenv("ONKO_IRIS_CONNECTION_STRING", "")


@pytest.fixture(autouse=True)
def _no_model(monkeypatch: pytest.MonkeyPatch) -> None:
    # Tests never call a real model (TEST-3): no slots, so the app starts without a gateway.
    monkeypatch.setenv("ONKO_MODELS", "")
    monkeypatch.setenv("ONKO_ACTIVE_MODEL", "")
