"""Bench: run metadata + extraction + checks per model and reference case, and score the output."""

from __future__ import annotations

import argparse
import datetime as dt
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from onko_ai import analyse_case, apply_metadata, extract_metadata, locate
from onko_contracts import DocumentMeta, FieldStatus, Finding, Handover, ParsedDocument
from onko_llm_gateway import Gateway
from pydantic import BaseModel

from .adapters.files import load_case, write_results
from .models import ReferenceCase, RunResult, Score

DEFAULT_CASES = ["data/vzp-structured", "data/reference-2"]

# Handover leaves and how a value is compared. Free-text summaries are scored on status only;
# the final `epicrisis` is a coordinator draft (S5) and is not scored.
EXACT = [
    "patient.first_name", "patient.last_name", "patient.birth_number", "patient.birth_date", "patient.age",
    "patient.sex", "patient.insurance_code", "contacts.patient_phone", "contacts.patient_email",
    "contacts.contact_person_phone", "diagnosis_code", "allergies", "weight_kg", "height_cm",
]  # fmt: skip
TEXT = [
    "patient.address", "contacts.contact_person", "diagnosis", "histology", "performance_status",
    "comorbidities", "medications", "epicrisis_source",
]  # fmt: skip
STATUS_ONLY = ["symptoms", "other", "mdt_question"]
OUT_OF_SCOPE = ("referring_doctor.", "mdt_record.")  # findings on data outside the handover (S3/S5)


def words(value: Any) -> list[str]:
    if isinstance(value, list):
        value = " ".join(map(str, value))
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().casefold()
    return re.findall(r"\w+", text)


def similar(a: Any, b: Any, threshold: float = 0.5) -> bool:
    """Token F1 between two values."""
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return wa == wb
    common = sum(min(wa.count(w), wb.count(w)) for w in set(wa))
    if not common:
        return False
    p, r = common / len(wa), common / len(wb)
    return 2 * p * r / (p + r) >= threshold


def same(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-6
    return words(a) == words(b)


def _get(h: Handover, path: str):
    obj: Any = h
    for part in path.split("."):
        obj = getattr(obj, part)
    return obj


def score_metadata(expected: list[DocumentMeta], got: list[DocumentMeta]) -> Score:
    s = Score()
    by_id = {m.id: m for m in got}
    for e in expected:
        g = by_id.get(e.id)
        s.add(
            g is not None and g.doc_type == e.doc_type,
            f"{e.id}.doc_type: {g.doc_type if g else None} != {e.doc_type}",
        )
        s.add(
            g is not None and g.document_date == e.document_date,
            f"{e.id}.document_date: {g.document_date if g else None} != {e.document_date}",
        )
    return s


def score_fields(expected: Handover, got: Handover) -> Score:
    s = Score()
    for path in EXACT + TEXT + STATUS_ONLY:
        e, g = _get(expected, path), _get(got, path)
        ok = e.status == g.status
        if ok and e.status is FieldStatus.FOUND and path not in STATUS_ONLY:
            ok = same(e.value, g.value) if path in EXACT else similar(e.value, g.value)
        s.add(ok, f"{path}: {g.status}={g.value!r} != {e.status}={e.value!r}")
    return s


def score_examinations(expected: Handover, got: Handover) -> Score:
    """Each expected examination: present (same date) and its full text verbatim-equal."""
    s = Score()
    pool = list(got.examinations)
    for e in expected.examinations:
        match = next((g for g in pool if g.date == e.date), None)
        s.add(match is not None, f"{e.date} {e.type}: missing")
        if match is not None:
            pool.remove(match)
            s.add(
                words(match.result_full_text) == words(e.result_full_text)
                or similar(match.result_full_text, e.result_full_text, 0.9),
                f"{e.date} {e.type}: full text differs",
            )
    for g in pool:
        s.add(False, f"{g.date} {g.type}: not expected")
    return s


def score_labs(expected: Handover, got: Handover) -> Score:
    """Each expected lab value in the panel of the same date, same printed value."""
    s = Score()
    panels: dict = {}
    for p in got.labs:
        for v in p.values:  # the first row of a name wins (a blood value before its urine namesake)
            panels.setdefault(p.date, {}).setdefault(" ".join(words(v.name)), v)
    for p in expected.labs:
        values = panels.get(p.date, {})
        for v in p.values:
            g = values.get(" ".join(words(v.name)))
            s.add(
                g is not None and same(g.value, v.value),
                f"{p.date} {v.name}: {g.value if g else None} != {v.value}",
            )
    extra = set(panels) - {p.date for p in expected.labs}
    for d in sorted(extra):
        s.add(False, f"{d}: panel not expected")
    return s


def score_evidence(handover: Handover, findings: list[Finding], texts: dict[str, str]) -> Score:
    s = Score()

    def walk(obj: Any):
        if isinstance(obj, list):
            for x in obj:
                yield from walk(x)
        elif isinstance(obj, BaseModel):
            if type(obj).__name__ == "Evidence":
                yield obj
            else:
                for name in type(obj).model_fields:
                    yield from walk(getattr(obj, name))

    for ev in walk([handover, findings]):
        s.add(
            ev.document_id in texts and locate(ev.quote, texts[ev.document_id]) is not None,
            f"{ev.document_id}: {ev.quote[:60]!r}",
        )
    return s


def _matches(expected: Finding, got: Finding) -> bool:
    return expected.kind == got.kind and bool(set(expected.fields) & set(got.fields))


def score_findings(
    expected: list[Finding], got: list[Finding]
) -> tuple[Score, list[str], list[str]]:
    """Recall of open in-scope expected findings (kind + a shared field), false positives (an open
    finding matching one the reference has as resolved), and extras (matching nothing)."""
    s = Score()
    in_scope = [e for e in expected if not any(f.startswith(OUT_OF_SCOPE) for f in e.fields)]
    open_got = [g for g in got if not g.resolved]
    for e in in_scope:
        if not e.resolved:
            s.add(any(_matches(e, g) for g in open_got), f"{e.id} {e.kind} {e.fields}: not raised")
    false_pos = [
        f"{g.id}: {g.message_cs}"
        for g in open_got
        if any(e.resolved and _matches(e, g) for e in in_scope)
        and not any(not e.resolved and _matches(e, g) for e in in_scope)
    ]
    extra = [
        f"{g.id}: {g.message_cs}" for g in open_got if not any(_matches(e, g) for e in in_scope)
    ]
    return s, false_pos, extra


def run_case(case: ReferenceCase, gateway: Gateway, now: dt.datetime) -> tuple[RunResult, dict]:
    started = time.perf_counter()
    expected_meta = [m for m, _ in case.documents]
    texts = {m.id: t for m, t in case.documents}
    bare = [
        DocumentMeta(id=m.id, case_id=m.case_id, filename=m.filename, received_at=m.received_at)
        for m in expected_meta
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        drafts = list(
            pool.map(lambda m: extract_metadata(texts[m.id], gateway, document_id=m.id), bare)
        )
    docs = [
        ParsedDocument(meta=apply_metadata(m, d), text=texts[m.id])
        for m, d in zip(bare, drafts, strict=True)
    ]
    handover, findings, _ = analyse_case(
        case.expected_handover.case_id, docs, gateway=gateway, as_of=case.as_of, now=now
    )
    seconds = time.perf_counter() - started
    finding_score, false_pos, extra = score_findings(case.expected_findings, findings)
    result = RunResult(
        model=gateway.active,
        case=case.name,
        metadata=score_metadata(expected_meta, [d.meta for d in docs]),
        fields=score_fields(case.expected_handover, handover),
        examinations=score_examinations(case.expected_handover, handover),
        labs=score_labs(case.expected_handover, handover),
        evidence=score_evidence(handover, findings, texts),
        findings=finding_score,
        false_positives=false_pos,
        extra_findings=extra,
        seconds=seconds,
        prompt_tokens=sum(c.prompt_tokens for c in gateway.calls),
        completion_tokens=sum(c.completion_tokens for c in gateway.calls),
    )
    output = {
        "metadata": [d.meta.model_dump(mode="json") for d in docs],
        "handover": handover.model_dump(mode="json"),
        "findings": [f.model_dump(mode="json") for f in findings],
    }
    return result, output


def run(
    cases: list[ReferenceCase], gateway: Gateway, models: list[str], now: dt.datetime
) -> tuple[list[RunResult], dict]:
    """Every model on every case, each on a fresh gateway (own cache and call log), cases in parallel."""
    jobs = [(m, c) for m in models for c in cases]

    def one(job):
        model, case = job
        gw = Gateway(gateway.slots, model, client=gateway.client)
        try:
            return run_case(case, gw, now)
        except Exception as e:  # noqa: BLE001 - one failed run must not lose the others
            empty = Score()
            return RunResult(
                model,
                case.name,
                empty,
                empty,
                empty,
                empty,
                empty,
                empty,
                [],
                [],
                0,
                0,
                0,
                error=repr(e)[:300],
            ), {}

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        outcomes = list(pool.map(one, jobs))
    return [r for r, _ in outcomes], {f"{r.model}/{r.case}": o for r, o in outcomes}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="onko-bench", description="Score model slots on the reference cases."
    )
    parser.add_argument(
        "--models", help="comma-separated slots (default: every slot in ONKO_MODELS)"
    )
    parser.add_argument("--cases", nargs="+", default=DEFAULT_CASES, help="reference case folders")
    parser.add_argument("--out", default="bench-results", help="output folder")
    args = parser.parse_args(argv)

    gateway = Gateway.from_env()
    models = args.models.split(",") if args.models else list(gateway.slots)
    cases = [load_case(Path(c)) for c in args.cases]
    now = dt.datetime.now()  # the bench is a CLI edge; the pipeline itself gets `now` passed in
    results, details = run(cases, gateway, models, now)
    out = Path(args.out) / now.strftime("%Y%m%d-%H%M%S")
    board = write_results(out, results, details)
    print(board.read_text(encoding="utf-8"))
    print(f"details: {out}")
