"""Model slots from env and the `Gateway` every model call goes through."""

from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel

from .models import ModelSlot


def load_slots(env: dict[str, str] | None = None) -> dict[str, ModelSlot]:
    env = dict(os.environ if env is None else env)
    slots = {}
    for key in filter(None, (k.strip() for k in env.get("ONKO_MODELS", "").split(","))):
        p = f"ONKO_MODEL_{key.upper()}_"
        slots[key] = ModelSlot(key, env[p + "BASE_URL"], env.get(p + "API_KEY", ""), env[p + "NAME"])
    return slots


class Gateway:
    def __init__(self, slots: dict[str, ModelSlot], active: str, embed: str | None = None):
        self.slots = slots
        self.active = active
        self.embed_slot = embed

    @classmethod
    def from_env(cls) -> Gateway:
        slots = load_slots()
        return cls(slots, os.environ["ONKO_ACTIVE_MODEL"], os.environ.get("ONKO_EMBED_MODEL"))

    def complete(
        self,
        messages: list[dict[str, Any]],
        schema: type[BaseModel] | None = None,
        *,
        slot: str | None = None,
    ) -> BaseModel | str:
        """Chat completion on the active model (or `slot`, used by the bench).
        With `schema`, returns a validated model, using whatever structured-output mode the
        chosen model supports. TODO stream B."""
        raise NotImplementedError

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError
