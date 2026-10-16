"""Gateway tests: offline through `httpx.MockTransport`; the live smoke test needs ONKO_TEST_LLM=1."""

from __future__ import annotations

import json
import os

import httpx
import pytest
from onko_llm_gateway import (
    LOCAL_BASE_URL,
    EmbedResult,
    Gateway,
    ModelSlot,
    load_slots,
    strict_schema,
)
from onko_llm_gateway.adapters.local_embed import LocalEmbedClient
from onko_llm_gateway.adapters.openai_compat import OpenAICompatClient
from pydantic import BaseModel, ValidationError

SLOT = ModelSlot("a", "https://apim.example/openai/v1", "secret-key", "gpt-test")


class Diagnosis(BaseModel):
    diagnosis: str
    quote: str | None = None


def _reply(content: str) -> dict:
    return {
        "id": "x",
        "object": "chat.completion",
        "created": 0,
        "model": "gpt-test",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


def _gateway(answers: list[str], seen: list[httpx.Request]) -> Gateway:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_reply(answers[min(len(seen), len(answers)) - 1]))

    client = OpenAICompatClient(http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    return Gateway({"a": SLOT}, "a", client=client)


def test_structured_output_is_validated_and_sent_with_api_key_header():
    seen: list[httpx.Request] = []
    gw = _gateway(['{"diagnosis": "C25.0", "quote": "adenokarcinom"}'], seen)

    out = gw.complete([{"role": "user", "content": "x"}], Diagnosis)

    assert out == Diagnosis(diagnosis="C25.0", quote="adenokarcinom")
    assert seen[0].headers["api-key"] == "secret-key"
    body = json.loads(seen[0].content)
    assert body["model"] == "gpt-test"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert gw.calls[0].prompt_tokens == 10 and gw.calls[0].ok


def test_invalid_answer_gets_one_repair_round():
    seen: list[httpx.Request] = []
    gw = _gateway(['{"quote": null}', '{"diagnosis": "C20", "quote": null}'], seen)

    assert gw.complete([{"role": "user", "content": "x"}], Diagnosis) == Diagnosis(diagnosis="C20")
    assert len(seen) == 2
    assert "invalid" in json.loads(seen[1].content)["messages"][-1]["content"]
    assert gw.calls[-1].attempts == 2


def test_second_invalid_answer_raises():
    gw = _gateway(["not json"], [])
    with pytest.raises(ValidationError):
        gw.complete([{"role": "user", "content": "x"}], Diagnosis)
    assert gw.calls[-1].ok is False


def test_identical_calls_are_cached():
    seen: list[httpx.Request] = []
    gw = _gateway(["plain text"], seen)
    messages = [{"role": "user", "content": "x"}]

    assert gw.complete(messages) == "plain text"
    assert gw.complete(messages) == "plain text"
    assert len(seen) == 1
    assert [c.cached for c in gw.calls] == [False, True]


def test_strict_schema_closes_objects_and_requires_every_property():
    schema = strict_schema(Diagnosis)
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["diagnosis", "quote"]
    assert "default" not in json.dumps(schema)


def test_strict_schema_keeps_properties_named_like_keywords():
    class Doc(BaseModel):
        title: str | None
        default: int

    schema = strict_schema(Doc)
    assert set(schema["properties"]) == {"title", "default"}
    assert schema["required"] == ["title", "default"]


def test_slot_repr_hides_the_key():
    assert "secret-key" not in repr(SLOT)


def test_from_env_reads_env_file_and_real_env_wins(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "ONKO_MODELS=a\nONKO_MODEL_A_BASE_URL=https://file\nONKO_MODEL_A_API_KEY=k\n"
        "ONKO_MODEL_A_NAME=from-file\nONKO_ACTIVE_MODEL=a\nONKO_EMBED_MODEL=\n"
    )
    monkeypatch.setenv("ONKO_MODEL_A_NAME", "from-env")
    for var in ("ONKO_MODELS", "ONKO_ACTIVE_MODEL", "ONKO_MODEL_A_BASE_URL", "ONKO_EMBED_MODEL"):
        monkeypatch.delenv(var, raising=False)

    gw = Gateway.from_env(str(env_file))

    assert gw.slots["a"].model == "from-env"
    assert gw.slots["a"].base_url == "https://file"
    assert gw.embed_slot is None


def test_unknown_active_slot_is_rejected():
    with pytest.raises(ValueError):
        Gateway(load_slots({}), "a")


@pytest.mark.skipif(
    os.environ.get("ONKO_TEST_LLM") != "1", reason="set ONKO_TEST_LLM=1 to call the real models"
)
@pytest.mark.parametrize("slot", ["a", "b"])
def test_live_structured_output(slot):
    gw = Gateway.from_env()
    if slot not in gw.slots:
        pytest.skip(f"slot {slot} not configured")
    out = gw.complete(
        [
            {
                "role": "system",
                "content": "Extract the diagnosis and quote it verbatim from the text.",
            },
            {"role": "user", "content": "Závěr: adenokarcinom hlavy pankreatu, G2."},
        ],
        Diagnosis,
        slot=slot,
    )
    assert out.quote and out.quote in "Závěr: adenokarcinom hlavy pankreatu, G2."


EMBED = ModelSlot("e", "https://apim.example/openai/v1", "embed-key", "embed-test")


def _embed_gateway(seen: list[httpx.Request]) -> Gateway:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        texts = json.loads(request.content)["input"]
        data = [  # out of order, as an endpoint may answer
            {"object": "embedding", "index": i, "embedding": [float(len(t)), float(i)]}
            for i, t in reversed(list(enumerate(texts)))
        ]
        return httpx.Response(200, json={"object": "list", "data": data, "model": "embed-test",
                                         "usage": {"prompt_tokens": 3, "total_tokens": 3}})

    client = OpenAICompatClient(http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    return Gateway({"a": SLOT, "e": EMBED}, "a", "e", client=client)


def test_embed_returns_one_vector_per_text_in_order_on_the_embedding_slot():
    seen: list[httpx.Request] = []
    gw = _embed_gateway(seen)

    vectors = gw.embed(["ab", "abcd", "ab"])

    assert [v[0] for v in vectors] == [2.0, 4.0, 2.0]
    body = json.loads(seen[0].content)
    assert body["model"] == "embed-test" and body["input"] == ["ab", "abcd"]  # distinct texts once
    assert seen[0].headers["api-key"] == "embed-key"
    assert gw.calls[0].slot == "e" and gw.calls[0].prompt_tokens == 3


def test_embed_serves_known_texts_from_the_cache_and_batches_the_rest():
    seen: list[httpx.Request] = []
    gw = _embed_gateway(seen)
    gw.embed(["a"])

    vectors = gw.embed(["a", "bb", "ccc"], batch=1)

    assert [v[0] for v in vectors] == [1.0, 2.0, 3.0]
    assert [json.loads(r.content)["input"] for r in seen] == [["a"], ["bb"], ["ccc"]]


def test_embed_without_an_embedding_slot_is_an_error():
    gw = Gateway({"a": SLOT}, "a", client=OpenAICompatClient())
    assert not gw.can_embed
    with pytest.raises(RuntimeError, match="ONKO_EMBED_MODEL"):
        gw.embed(["text"])


LOCAL = ModelSlot("e", LOCAL_BASE_URL, "", "local-model")


class FakeLocal:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    def embed(self, slot: ModelSlot, texts: list[str]) -> EmbedResult:
        self.calls.append((slot.model, texts))
        return EmbedResult(vectors=[[float(len(t))] for t in texts])


def test_a_local_embedding_slot_embeds_in_process_without_an_endpoint():
    seen: list[httpx.Request] = []
    local = FakeLocal()
    client = OpenAICompatClient(
        http_client=httpx.Client(transport=httpx.MockTransport(lambda r: seen.append(r)))
    )
    gw = Gateway({"a": SLOT, "e": LOCAL}, "a", "e", client=client, local=local)

    assert gw.can_embed
    assert gw.embed(["ab", "abc"]) == [[2.0], [3.0]]
    assert local.calls == [("local-model", ["ab", "abc"])]
    assert seen == []


def test_local_embed_client_loads_each_fastembed_model_once(monkeypatch):
    import fastembed

    loaded: list[str] = []

    class FakeTextEmbedding:
        def __init__(self, model_name: str) -> None:
            loaded.append(model_name)

        def embed(self, texts: list[str]):
            return (iter([len(t), 0]) for t in texts)

    monkeypatch.setattr(fastembed, "TextEmbedding", FakeTextEmbedding)
    client = LocalEmbedClient()

    first = client.embed(LOCAL, ["ab"])
    second = client.embed(LOCAL, ["abcd"])

    assert first.vectors == [[2.0, 0.0]] and second.vectors == [[4.0, 0.0]]
    assert all(isinstance(x, float) for x in first.vectors[0])
    assert loaded == ["local-model"]
