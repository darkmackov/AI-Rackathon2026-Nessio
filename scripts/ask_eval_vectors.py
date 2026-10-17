"""Cache the real embeddings the offline 'ask the case' evaluation needs (Q-I19, TEST-3).

Embeds every chunk of the reference case's reports and the evaluation questions with the local
embedding model and writes them to `packages/ai/tests/data/ask_eval_vectors.json`, keyed by a hash
of the text, as base64 float16. Rerun it after a change to chunking, the reports or the questions:

    FASTEMBED_CACHE_PATH=… uv run python scripts/ask_eval_vectors.py

The model files download on first use (about 1.1 GB) unless they are in FASTEMBED_CACHE_PATH.
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from pathlib import Path

from fastembed import TextEmbedding
from onko_ai import chunk_document
from onko_contracts import DocumentMeta, ParsedDocument

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "vzp-structured"
OUT = ROOT / "packages" / "ai" / "tests" / "data" / "ask_eval_vectors.json"
MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"  # the deployed one (Q-M2)

QUESTIONS = [
    "Jaký byl nález na CT?",
    "Jaký je závěr bioptického nálezu?",
    "Jaký typ nádoru byl prokázán histologicky?",
    "Jaké léky pacientka užívá?",
    "Jaké jsou hodnoty nádorových markerů?",
    "Jaký byl nález na RTG plic?",
]


def key(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def main() -> None:
    texts = list(QUESTIONS)
    for raw in json.loads((DATA / "reference" / "manifest.json").read_text(encoding="utf-8")):
        meta = DocumentMeta.model_validate(raw).model_copy(update={"case_id": "eval"})
        text = (DATA / "reports" / (Path(meta.filename).stem + ".md")).read_text(encoding="utf-8")
        texts += [c.text for c in chunk_document(ParsedDocument(meta=meta, text=text))]
    vectors = TextEmbedding(model_name=MODEL).embed(texts)
    out = {
        key(t): base64.b64encode(struct.pack(f"<{len(v)}e", *map(float, v))).decode()
        for t, v in zip(texts, vectors, strict=True)
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"model": MODEL, "vectors": out}, indent=0) + "\n", encoding="utf-8")
    print(f"{len(out)} vectors → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
