"""Reading reference cases from disk and writing results to `bench-results/`."""

from __future__ import annotations

import csv
import dataclasses
import json
from pathlib import Path

from onko_contracts import DocumentMeta, Finding, Handover

from ..models import ReferenceCase, RunResult


def load_case(folder: Path) -> ReferenceCase:
    ref = folder / "reference"
    handover = Handover.model_validate_json(
        (ref / "expected_handover.json").read_text(encoding="utf-8")
    )
    findings = [
        Finding.model_validate(f)
        for f in json.loads((ref / "expected_findings.json").read_text(encoding="utf-8"))
    ]
    manifest = [
        DocumentMeta.model_validate(m)
        for m in json.loads((ref / "manifest.json").read_text(encoding="utf-8"))
    ]
    reports = {p.name[:2]: p for p in (folder / "reports").glob("*.md")}
    documents = []
    for meta in manifest:
        if meta.received_at is not None and meta.received_at.date() > handover.as_of:
            continue  # the snapshot only holds what arrived by the MDT
        text = reports[meta.id].read_text(encoding="utf-8")
        if text.startswith("<!--"):  # the `<!-- source: … -->` line is not in the original
            text = text.split("\n", 1)[1].lstrip("\n")
        documents.append((meta, text))
    return ReferenceCase(folder.name, documents, handover, findings)


SUMMARY = ["metadata", "fields", "examinations", "labs", "evidence", "findings"]


def write_results(out: Path, results: list[RunResult], details: dict[str, dict]) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    board = out / "leaderboard.csv"
    with board.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "model",
                "case",
                *SUMMARY,
                "false_positives",
                "extra_findings",
                "seconds",
                "prompt_tokens",
                "completion_tokens",
                "error",
            ]
        )
        for r in results:
            rates = [getattr(r, m).rate for m in SUMMARY]
            w.writerow(
                [
                    r.model,
                    r.case,
                    *[f"{x:.3f}" if x is not None else "" for x in rates],
                    len(r.false_positives),
                    len(r.extra_findings),
                    f"{r.seconds:.0f}",
                    r.prompt_tokens,
                    r.completion_tokens,
                    r.error or "",
                ]
            )
    for r in results:
        record = dataclasses.asdict(r) | {"output": details.get(f"{r.model}/{r.case}")}
        (out / f"{r.model}_{r.case}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=1, default=str), encoding="utf-8"
        )
    return board
