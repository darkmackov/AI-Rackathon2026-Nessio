"""LLM gateway: one client for our OpenAI-compatible endpoints.

Owner: stream B. Decision Q-M1: the bench compares the candidate models once, we pick ONE and
build on its capabilities. Q-M2: one embedding model for IRIS Vector Search. Q-M3: no rate
limiting. Every model call goes through `Gateway`, so the logging lives in one place.

Configured via env (see `.env.example`):
    ONKO_MODELS=a,b,c                  # candidate slots (the bench runs all of them)
    ONKO_MODEL_A_BASE_URL=...          # per slot: base url, api key, model name
    ONKO_MODEL_A_API_KEY=...
    ONKO_MODEL_A_NAME=...
    ONKO_ACTIVE_MODEL=a                # the one the app uses
    ONKO_EMBED_MODEL=e                 # embedding slot
`from_env()` also reads `.env`; the real environment wins. Endpoints sit behind Azure API
Management, which takes the key in the `api-key` header.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .models import CallRecord, ChatResult, ModelSlot
from .ports import ChatClient
from .service import Gateway, load_slots, strict_schema

__all__ = [
    "CallRecord",
    "ChatClient",
    "ChatResult",
    "Gateway",
    "ModelSlot",
    "load_slots",
    "strict_schema",
]
