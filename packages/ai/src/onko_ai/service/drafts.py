"""Drafts for the coordinator (S5): what the MDT receives. The epikríza summary (Q-F15), the MDT
question (Q-F14) and one-line result rows for the MDT record. A draft is only text to edit: the
coordinator applies it as a manual value, nothing is written to the case here (Q-F37)."""

from __future__ import annotations

from typing import Any

from onko_contracts import Finding, Handover, MdtResultRow, Sourced
from onko_llm_gateway import Gateway

from ..models import ResultLines
from . import prompts

DRAFT_PROMPTS = {
    "epicrisis_summary": prompts.EPICRISIS_SUMMARY,
    "mdt_question": prompts.MDT_QUESTION,
}

# Handover values in the digest, with their Czech labels.
_FIELDS: list[tuple[str, str]] = [
    ("patient.age", "Věk"),
    ("patient.sex", "Pohlaví"),
    ("diagnosis", "Diagnóza"),
    ("diagnosis_code", "Kód diagnózy (MKN-10)"),
    ("symptoms", "Obtíže a jejich začátek"),
    ("comorbidities", "Komorbidity (OA)"),
    ("medications", "Medikace (FA)"),
    ("allergies", "Alergie (AA)"),
    ("performance_status", "Stav výkonnosti"),
    ("weight_kg", "Hmotnost (kg)"),
    ("height_cm", "Výška (cm)"),
    ("histology", "Histologie"),
    ("other", "Jiná sdělení"),
    ("mdt_question", "Požadavek / otázka na MDT"),
]


def _value(handover: Handover, path: str) -> Any:
    node: Any = handover
    for part in path.split("."):
        node = getattr(node, part)
    assert isinstance(node, Sourced)
    return node.value


def handover_digest(handover: Handover) -> str:
    """The case as known now, in Czech, from the handover's values only (no evidence offsets)."""
    lines = []
    for path, label in _FIELDS:
        value = _value(handover, path)
        if value in (None, "", []):
            continue
        lines.append(f"{label}: {'; '.join(value) if isinstance(value, list) else value}")
    if handover.epicrisis_source.value:
        lines += ["", "Epikríza referujícího lékaře:", handover.epicrisis_source.value]
    if handover.examinations:
        lines += ["", "Provedená vyšetření:"]
        for e in sorted(handover.examinations, key=lambda e: e.date):
            lines.append(f"- {e.date.isoformat()}, {e.place}, {e.type}:\n{e.result_full_text}")
    if handover.labs:
        lines += ["", "Laboratoř:"]
        for p in sorted(handover.labs, key=lambda p: p.date):
            values = "; ".join(" ".join(x for x in (v.name, v.value, v.unit, v.flag) if x)
                               for v in p.values)
            lines.append(f"- {p.date.isoformat()}, {p.place}: {values}")
    return "\n".join(lines)


def _open_problems(findings: list[Finding]) -> str:
    open_ = [f.message_cs for f in findings if not f.resolved]
    return "\n".join(f"- {m}" for m in open_) or "(žádné)"


def draft(kind: str, handover: Handover, findings: list[Finding], *, gateway: Gateway) -> str:
    """Draft text for the coordinator to edit: 'epicrisis_summary' (Q-F15) or 'mdt_question'
    (Q-F14), from the handover as known now and the open problems."""
    if kind not in DRAFT_PROMPTS:
        raise ValueError(f"no AI draft for {kind}")
    messages = [
        {"role": "system", "content": DRAFT_PROMPTS[kind]},
        {"role": "user", "content": f"Údaje případu:\n{handover_digest(handover)}\n\n"
                                    f"Otevřené problémy:\n{_open_problems(findings)}"},
    ]
    text = gateway.complete(messages)
    assert isinstance(text, str)
    return text.strip()


def draft_results(rows: list[MdtResultRow], *, gateway: Gateway) -> list[MdtResultRow]:
    """One-line results for the MDT record (`mdt_results`). Date and examination stay as they are;
    a row the model leaves out keeps its full text."""
    if not rows:
        return []
    listing = "\n\n".join(f"[{i}] {r.date.isoformat()} | {r.examination}\n{r.result}"
                          for i, r in enumerate(rows))
    answer = gateway.complete(
        [{"role": "system", "content": prompts.RESULT_LINES},
         {"role": "user", "content": listing}],
        ResultLines,
    )
    assert isinstance(answer, ResultLines)
    lines = {line.index: line.result.strip() for line in answer.lines if line.result.strip()}
    return [r.model_copy(update={"result": lines.get(i, r.result)}) for i, r in enumerate(rows)]
