"""Embeddings computed in-process with fastembed (ONNX Runtime) for a slot whose base url is `local`.

No embedding deployment exists behind our endpoints (Q-M7), so the embedding slot can run a
sentence-transformers model in the app container instead. The model files come from fastembed's
cache (`FASTEMBED_CACHE_PATH`, baked into the Docker image). The only place that imports fastembed.
"""

from __future__ import annotations

import threading
from typing import Any

from ..models import EmbedResult, ModelSlot


class LocalEmbedClient:
    def __init__(self) -> None:
        self._models: dict[str, Any] = {}
        self._lock = threading.Lock()

    def _model(self, name: str) -> Any:
        with self._lock:
            if name not in self._models:
                from fastembed import TextEmbedding  # heavy: loaded on the first embed only

                self._models[name] = TextEmbedding(model_name=name)
            return self._models[name]

    def embed(self, slot: ModelSlot, texts: list[str]) -> EmbedResult:
        vectors = self._model(slot.model).embed(texts)
        return EmbedResult(vectors=[[float(x) for x in v] for v in vectors])
