"""Ports of `llm_gateway`: the endpoint client `Gateway` calls (faked in tests)."""

from __future__ import annotations

from typing import Any, Protocol

from .models import ChatResult, ModelSlot


class ChatClient(Protocol):
    def chat(
        self, slot: ModelSlot, messages: list[dict[str, Any]], json_schema: dict[str, Any] | None
    ) -> ChatResult:
        """One chat completion on `slot`. With `json_schema`, ask for strict structured output."""
        ...
