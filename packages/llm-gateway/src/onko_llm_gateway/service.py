"""Model slots from env and the `Gateway` every model call goes through."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from typing import Any, TypeVar

from dotenv import dotenv_values
from pydantic import BaseModel, ValidationError

from .models import CallRecord, ChatResult, ModelSlot
from .ports import ChatClient, EmbedClient

log = logging.getLogger(__name__)

M = TypeVar("M", bound=BaseModel)

# A slot with this base url embeds in-process (adapters/local_embed.py), not on an endpoint.
LOCAL_BASE_URL = "local"


def load_slots(env: dict[str, str] | None = None) -> dict[str, ModelSlot]:
    env = dict(os.environ if env is None else env)
    slots = {}
    for key in filter(None, (k.strip() for k in env.get("ONKO_MODELS", "").split(","))):
        p = f"ONKO_MODEL_{key.upper()}_"
        slots[key] = ModelSlot(
            key, env[p + "BASE_URL"], env.get(p + "API_KEY", ""), env[p + "NAME"]
        )
    return slots


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema of `model` in the shape strict structured output accepts: every object closed
    (`additionalProperties: false`), every property required (optional ones are nullable in the
    model), no `default` / `title`."""

    def fix(node: Any) -> Any:
        if isinstance(node, dict):
            node = {
                k: fix(v) for k, v in node.items() if k not in ("default", "title", "properties")
            } | (
                {"properties": {name: fix(sub) for name, sub in node["properties"].items()}}
                if isinstance(node.get("properties"), dict)
                else {}
            )
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node["properties"])
            return node
        if isinstance(node, list):
            return [fix(v) for v in node]
        return node

    return fix(model.model_json_schema())


class Gateway:
    def __init__(
        self,
        slots: dict[str, ModelSlot],
        active: str,
        embed: str | None = None,
        *,
        client: ChatClient | None = None,
        local: EmbedClient | None = None,
    ):
        if active not in slots:
            raise ValueError(f"active model slot {active!r} is not configured")
        self.slots = slots
        self.active = active
        self.embed_slot = embed
        if client is None:
            from .adapters.openai_compat import OpenAICompatClient

            client = OpenAICompatClient()
        self.client = client
        self._local = local
        self.calls: list[CallRecord] = []
        self._cache: dict[str, BaseModel | str | list[float]] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls, env_file: str = ".env") -> Gateway:
        """Slots from the process env, falling back to `env_file` (real env wins)."""
        env = {k: v for k, v in dotenv_values(env_file).items() if v is not None}
        env.update(os.environ)
        return cls(
            load_slots(env), env.get("ONKO_ACTIVE_MODEL", ""), env.get("ONKO_EMBED_MODEL") or None
        )

    def complete(
        self,
        messages: list[dict[str, Any]],
        schema: type[M] | None = None,
        *,
        slot: str | None = None,
    ) -> M | str:
        """Chat completion on the active model (or `slot`, used by the bench).

        With `schema`, the model is asked for strict structured output and the answer is
        validated into `schema`; an invalid answer gets one repair round with the error.
        Identical calls (model + messages + schema) are served from an in-memory cache."""
        s = self.slots[slot or self.active]
        json_schema = strict_schema(schema) if schema else None
        key = hashlib.sha256(
            json.dumps(
                [s.model, messages, json_schema], sort_keys=True, ensure_ascii=False
            ).encode()
        ).hexdigest()
        with self._lock:
            hit = self._cache.get(key)
        if hit is not None:
            self._record(s, ChatResult(""), 0, cached=True, attempts=0, ok=True)
            return hit  # type: ignore[return-value]

        started = time.perf_counter()
        convo = list(messages)
        prompt = completion = 0
        for attempt in (1, 2):
            result = self.client.chat(s, convo, json_schema)
            prompt += result.prompt_tokens
            completion += result.completion_tokens
            if schema is None:
                value: BaseModel | str = result.text
                break
            try:
                value = schema.model_validate_json(result.text)
                break
            except ValidationError as e:
                if attempt == 2:
                    self._record(
                        s,
                        ChatResult("", prompt, completion),
                        started,
                        cached=False,
                        attempts=2,
                        ok=False,
                    )
                    raise
                convo += [
                    {"role": "assistant", "content": result.text},
                    {
                        "role": "user",
                        "content": f"The JSON is invalid: {e}. Answer again with valid JSON.",
                    },
                ]
        self._record(
            s, ChatResult("", prompt, completion), started, cached=False, attempts=attempt, ok=True
        )
        with self._lock:
            self._cache[key] = value
        return value  # type: ignore[return-value]

    def _record(
        self,
        s: ModelSlot,
        usage: ChatResult,
        started: float,
        *,
        cached: bool,
        attempts: int,
        ok: bool,
    ) -> None:
        latency = 0 if cached else int((time.perf_counter() - started) * 1000)
        record = CallRecord(
            s.key,
            s.model,
            usage.prompt_tokens,
            usage.completion_tokens,
            latency,
            cached,
            attempts,
            ok,
        )
        with self._lock:
            self.calls.append(record)
        log.info("llm call %s", record)

    @property
    def can_embed(self) -> bool:
        """An embedding slot is configured (Q-M2, Q-M7)."""
        return self.embed_slot is not None and self.embed_slot in self.slots

    def _embed_client(self, s: ModelSlot) -> EmbedClient:
        if s.base_url != LOCAL_BASE_URL:
            return self.client
        if self._local is None:
            from .adapters.local_embed import LocalEmbedClient

            self._local = LocalEmbedClient()
        return self._local

    def embed(self, texts: list[str], *, batch: int = 64) -> list[list[float]]:
        """Embeddings on the embedding slot, one vector per text, in order. Texts already embedded
        are served from the cache; the rest go out in batches of `batch`."""
        if not self.can_embed:
            raise RuntimeError("no embedding model slot is configured (ONKO_EMBED_MODEL)")
        s = self.slots[self.embed_slot]  # type: ignore[index]
        keys = [
            "embed:" + hashlib.sha256(json.dumps([s.model, t], ensure_ascii=False).encode()).hexdigest()
            for t in texts
        ]
        with self._lock:
            found = {k: self._cache[k] for k in keys if k in self._cache}
        first = {k: i for i, k in reversed(list(enumerate(keys)))}  # one call per distinct text
        todo = sorted(i for k, i in first.items() if k not in found)
        for at in range(0, len(todo), batch):
            part = todo[at : at + batch]
            started = time.perf_counter()
            result = self._embed_client(s).embed(s, [texts[i] for i in part])
            if len(result.vectors) != len(part):
                self._record(s, ChatResult(""), started, cached=False, attempts=1, ok=False)
                raise ValueError(f"{len(result.vectors)} embeddings for {len(part)} texts")
            self._record(
                s, ChatResult("", result.prompt_tokens), started, cached=False, attempts=1, ok=True
            )
            with self._lock:
                for i, vector in zip(part, result.vectors, strict=True):
                    self._cache[keys[i]] = vector  # type: ignore[assignment]
                    found[keys[i]] = vector  # type: ignore[assignment]
        if not todo:
            self._record(s, ChatResult(""), 0, cached=True, attempts=0, ok=True)
        return [list(found[k]) for k in keys]  # type: ignore[arg-type]
