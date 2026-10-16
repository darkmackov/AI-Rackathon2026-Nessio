"""Module-local types of `llm_gateway` (not shared contracts)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelSlot:
    key: str
    base_url: str
    api_key: str = field(repr=False)
    model: str


@dataclass(frozen=True)
class ChatResult:
    """One raw completion from an endpoint."""

    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass(frozen=True)
class CallRecord:
    """One `Gateway.complete` call, for the bench (tokens, latency) and debugging. No content."""

    slot: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    cached: bool
    attempts: int
    ok: bool
