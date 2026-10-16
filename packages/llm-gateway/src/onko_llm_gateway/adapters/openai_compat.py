"""`ChatClient` for OpenAI-compatible endpoints behind Azure API Management.

APIM authenticates with the `api-key` header, so the key is sent only there; the bearer token the
SDK always adds is a dummy. The only place in the repo that imports `openai`.
"""

from __future__ import annotations

import threading
from typing import Any

import httpx
from openai import OpenAI

from ..models import ChatResult, ModelSlot


class OpenAICompatClient:
    def __init__(self, *, timeout: float = 180.0, http_client: httpx.Client | None = None):
        self._timeout = timeout
        self._http_client = http_client
        self._clients: dict[str, OpenAI] = {}
        self._lock = threading.Lock()

    def _client(self, slot: ModelSlot) -> OpenAI:
        with self._lock:
            if slot.key not in self._clients:
                self._clients[slot.key] = OpenAI(
                    base_url=slot.base_url,
                    api_key="unused",
                    default_headers={"api-key": slot.api_key},
                    timeout=self._timeout,
                    max_retries=2,
                    http_client=self._http_client,
                )
            return self._clients[slot.key]

    def chat(
        self, slot: ModelSlot, messages: list[dict[str, Any]], json_schema: dict[str, Any] | None
    ) -> ChatResult:
        kwargs: dict[str, Any] = {}
        if json_schema is not None:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "output", "strict": True, "schema": json_schema},
            }
        response = self._client(slot).chat.completions.create(
            model=slot.model, messages=messages, **kwargs
        )
        usage = response.usage
        return ChatResult(
            text=response.choices[0].message.content or "",
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
        )
