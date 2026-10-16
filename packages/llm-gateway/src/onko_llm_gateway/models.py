"""Module-local types of `llm_gateway` (not shared contracts)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSlot:
    key: str
    base_url: str
    api_key: str
    model: str
