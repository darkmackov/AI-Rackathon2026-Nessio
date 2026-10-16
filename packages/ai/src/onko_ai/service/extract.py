"""Documents -> `Handover`: map (one model call per document), verify quotes, merge."""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from onko_contracts import (
    DocumentMeta,
    DocumentType,
    Evidence,
    Examination,
    FieldStatus,
    Handover,
    LabPanel,
    LabValue,
    Origin,
    ParsedDocument,
    Sourced,
)
from onko_llm_gateway import Gateway

from ..models import (
    LIST_FIELDS,
    Certainty,
    DocExtraction,
    DocMetaDraft,
    Extraction,
    ExtractionResult,
    FieldClaim,
    FieldPath,
)
from . import prompts
from .quotes import evidence, locate, section

# Identity: documents may misprint one value; the majority wins and the identity check reports it.
IDENTITY = {
    FieldPath.FIRST_NAME,
    FieldPath.LAST_NAME,
    FieldPath.BIRTH_NUMBER,
    FieldPath.BIRTH_DATE,
    FieldPath.SEX,
}
# Facts that should not change between documents: disagreement is a conflict a human decides.
STABLE = {FieldPath.ALLERGIES, FieldPath.INSURANCE_CODE}
# Everything else changes over time: the newest document wins, except the diagnosis itself.
DIAGNOSTIC = {FieldPath.DIAGNOSIS, FieldPath.HISTOLOGY}

_NONE_WORDS = {"neguje", "negativní", "žádné", "žádná", "nejsou", "bez alergií", "nemá", "0", "-"}


def _messages(system: str, doc: ParsedDocument) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Document id {doc.meta.id}:\n\n{doc.text}"},
    ]


def parse_date(value: str | None) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value.strip()[:10])
    except ValueError:
        m = re.search(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})", value)
        if m:
            try:
                return dt.date(int(m[3]), int(m[2]), int(m[1]))
            except ValueError:
                return None
    return None


def parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    m = re.search(r"-?\d+(?:[.,]\d+)?", value)
    return float(m.group().replace(",", ".")) if m else None


def norm(value: Any) -> str:
    """Comparison key: case, diacritics, punctuation and whitespace don't matter."""
    if isinstance(value, list):
        return "|".join(sorted(norm(v) for v in value))
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().casefold()
    text = re.sub(r"[^\w]+", " ", text).strip()
    return text


def birth_number_facts(rc: str) -> tuple[dt.date, str] | None:
    """Birth date and sex encoded in a Czech rodné číslo (women: month + 50; since 2004 also + 20)."""
    digits = re.sub(r"\D", "", rc)
    if len(digits) not in (9, 10):
        return None
    yy, mm, dd = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    sex = "žena" if mm > 50 else "muž"
    mm = mm - 50 if mm > 50 else mm
    mm = mm - 20 if mm > 20 else mm
    year = 1900 + yy if len(digits) == 9 or yy >= 54 else 2000 + yy
    try:
        return dt.date(year, mm, dd), sex
    except ValueError:
        return None


def _allergy_key(value: str) -> str:
    return "none" if value.strip().casefold().rstrip(".") in _NONE_WORDS else norm(value)


def extract_metadata(text: str, gateway: Gateway, *, document_id: str = "") -> DocMetaDraft:
    """AI document metadata (Q-A8)."""
    doc = ParsedDocument(meta=DocumentMeta(id=document_id, filename=""), text=text)
    return gateway.complete(_messages(prompts.METADATA, doc), DocMetaDraft)


def apply_metadata(meta: DocumentMeta, draft: DocMetaDraft) -> DocumentMeta:
    return meta.model_copy(
        update={
            "title": draft.title,
            "doc_type": draft.doc_type,
            "document_date": parse_date(draft.document_date),
            "facility": draft.facility,
            "department": draft.department,
            "author": draft.author,
            "ordered_by": draft.ordered_by,
        }
    )


# --- one claim -> typed value + verified evidence -------------------------------------------


def _typed(claim: FieldClaim) -> Any:
    path = claim.path
    if path in LIST_FIELDS:
        items = [i.strip() for i in claim.items or [] if i and i.strip()]
        return items or None
    if path is FieldPath.BIRTH_DATE:
        return parse_date(claim.value)
    if path is FieldPath.AGE:
        n = parse_number(claim.value)
        return int(n) if n is not None else None
    if path in (FieldPath.WEIGHT_KG, FieldPath.HEIGHT_CM):
        return parse_number(claim.value)
    return claim.value.strip() if claim.value and claim.value.strip() else None


def verified(claim: FieldClaim, doc: ParsedDocument) -> list[Evidence]:
    return [e for q in claim.quotes if (e := evidence(q, doc)) is not None]


class _Candidate:
    def __init__(
        self,
        value: Any,
        ev: list[Evidence],
        order: tuple,
        claim: FieldClaim,
        doc_type: DocumentType,
    ):
        self.value, self.evidence, self.order, self.claim = value, ev, order, claim
        self.doc_type = doc_type


def _order(doc: ParsedDocument, i: int) -> tuple:
    meta = doc.meta
    return (meta.document_date or dt.date.min, meta.received_at or dt.datetime.min, i)


def merge(case_id: str, as_of: dt.date, extractions: list[Extraction]) -> Handover:
    """Pure reduce step: per-document claims -> one `Handover` (see IDENTITY / STABLE above)."""
    candidates: dict[FieldPath, list[_Candidate]] = {}
    for i, ex in enumerate(extractions):
        for claim in ex.output.fields:
            value = _typed(claim)
            ev = verified(claim, ex.document)
            if value is None or not ev:
                continue  # never infer: no verbatim quote, no value (D-2)
            candidates.setdefault(claim.path, []).append(
                _Candidate(value, ev, _order(ex.document, i), claim, ex.document.meta.doc_type)
            )

    data: dict[str, Any] = {}
    for path, cands in candidates.items():
        cands.sort(key=lambda c: c.order)
        if path in DIAGNOSTIC:
            # The pathology report settles the diagnosis; otherwise a confirmed statement beats a suspicion.
            best = [c for c in cands if c.doc_type is DocumentType.HISTOLOGY] or [
                c for c in cands if c.claim.certainty is Certainty.CONFIRMED
            ]
            cands = best or cands
        if path in IDENTITY:
            counts = Counter(norm(c.value) for c in cands)
            best = max(cands, key=lambda c: (counts[norm(c.value)], c.order))
            chosen = [c for c in cands if norm(c.value) == norm(best.value)]
            sourced = _found(best.value, chosen)
        elif path in STABLE:
            key = _allergy_key if path is FieldPath.ALLERGIES else norm
            if len({key(str(c.value)) for c in cands}) > 1:
                sourced = Sourced(
                    value=None,
                    status=FieldStatus.CONFLICT,
                    evidence=[e for c in cands for e in c.evidence],
                    note="Podklady se liší: "
                    + "; ".join(f"{c.value} ({c.evidence[0].document_id})" for c in cands),
                )
            else:
                sourced = _found(cands[-1].value, cands)
        else:
            if path in LIST_FIELDS:
                # A single drug mentioned in passing must not replace the full list.
                longest = max(len(c.value) for c in cands)
                cands = [c for c in cands if len(c.value) * 2 >= longest]
            newest = cands[-1]
            same = [c for c in cands if norm(c.value) == norm(newest.value)]
            sourced = _found(
                newest.value,
                [c for c in same if c.evidence[0].document_id == newest.evidence[0].document_id],
            )
        _put(data, path.value, sourced)

    patient = data.setdefault("patient", {})
    rc = patient.get("birth_number")
    facts = birth_number_facts(str(rc["value"])) if rc else None
    if "sex" not in patient and facts:  # Q-C5: sex may come from the RČ, with a note
        patient["sex"] = {**rc, "value": facts[1], "note": "Odvozeno z rodného čísla."}

    examinations: list[Examination] = []
    labs: list[LabPanel] = []
    epicrisis: list[tuple[tuple, Sourced]] = []
    for i, ex in enumerate(extractions):
        doc, out = ex.document, ex.output
        span = None
        if out.epicrisis_start_quote and out.epicrisis_end_quote:
            span = section(out.epicrisis_start_quote, out.epicrisis_end_quote, doc)
        # One report = one examination (Q-C7, Q-C8): keep the most complete one. In a referral the
        # clinical part is the epikríza + anamnéza, not the list of examinations and the request.
        exams = [x for e in out.examinations if (x := _examination(e, doc)) is not None]
        if exams:
            exam = max(exams, key=lambda x: len(x.result_full_text))
            if span is not None and doc.meta.doc_type is DocumentType.REFERRAL:
                exam = exam.model_copy(update={"result_full_text": span[0]})
            examinations.append(exam)
        # Panels come only from laboratory reports (values quoted in other reports stay in their
        # text), one panel per report.
        panels = [p for lab in out.labs if (p := _lab_panel(lab, doc)) is not None]
        if panels and doc.meta.doc_type is DocumentType.LAB:
            date = doc.meta.document_date or panels[0].date
            labs.append(
                panels[0].model_copy(
                    update={"date": date, "values": [v for p in panels for v in p.values]}
                )
            )
        if span is not None:
            found = span
            epicrisis.append(
                (
                    _order(doc, i),
                    Sourced(value=found[0], status=FieldStatus.FOUND, evidence=[found[1]]),
                )
            )
    if epicrisis:
        _put(data, "epicrisis_source", max(epicrisis, key=lambda x: x[0])[1])

    examinations.sort(key=lambda e: e.date)
    labs.sort(key=lambda p: p.date)
    return Handover(case_id=case_id, as_of=as_of, examinations=examinations, labs=labs, **data)


def _found(value: Any, cands: list[_Candidate]) -> Sourced:
    seen: set[tuple[str, str]] = set()
    ev = []
    for c in cands:
        for e in c.evidence:
            if (e.document_id, e.quote) not in seen:
                seen.add((e.document_id, e.quote))
                ev.append(e)
    return Sourced(value=value, status=FieldStatus.FOUND, evidence=ev)


def _put(data: dict[str, Any], path: str, value: Sourced) -> None:
    value = value.model_dump()  # re-validated as the field's own `Sourced[T]`
    head, _, tail = path.partition(".")
    if tail:
        data.setdefault(head, {})[tail] = value
    else:
        data[head] = value


def _examination(e, doc: ParsedDocument) -> Examination | None:
    date = parse_date(e.date)
    full = section(e.start_quote, e.end_quote, doc)
    if date is None or full is None:
        return None
    key = evidence(e.key_quote, doc)
    return Examination(
        date=date,
        place=e.place,
        type=e.type,
        result_full_text=full[0],
        evidence=[key] if key else [full[1]],
    )


def _lab_panel(lab, doc: ParsedDocument) -> LabPanel | None:
    date = parse_date(lab.date)
    anchor = evidence(lab.date_quote, doc)
    values = [
        LabValue(
            name=v.name, value=v.value, unit=v.unit, reference_range=v.reference_range, flag=v.flag
        )
        for v in lab.values
        if locate(v.name, doc.text) is not None and locate(v.value, doc.text) is not None
    ]
    if date is None or anchor is None or not values:
        return None
    return LabPanel(date=date, place=lab.place, values=values, evidence=[anchor])


def keep_manual(previous: Handover | None, handover: Handover) -> Handover:
    """Values people typed in (origin manual) always win over a new extraction."""
    if previous is None:
        return handover
    update: dict[str, Any] = {}
    for name in type(handover).model_fields:
        old = getattr(previous, name)
        if isinstance(old, Sourced) and old.origin is Origin.MANUAL:
            update[name] = old
        elif name in ("patient", "contacts"):
            sub = {
                f: getattr(old, f)
                for f in type(old).model_fields
                if getattr(old, f).origin is Origin.MANUAL
            }
            if sub:
                update[name] = getattr(handover, name).model_copy(update=sub)
    update["examinations"] = handover.examinations + [
        x for x in previous.examinations if x.origin is Origin.MANUAL
    ]
    update["labs"] = handover.labs + [x for x in previous.labs if x.origin is Origin.MANUAL]
    update["validated_by_referrer"] = previous.validated_by_referrer
    update["confirmed_by_coordinator"] = previous.confirmed_by_coordinator
    return handover.model_copy(update=update)


class LlmExtractor:
    """`Extractor`: one structured model call per document (in parallel), then `merge`."""

    def __init__(self, gateway: Gateway, *, workers: int = 4):
        self.gateway = gateway
        self.workers = workers

    def extract_document(self, doc: ParsedDocument) -> DocExtraction:
        return self.gateway.complete(_messages(prompts.EXTRACT, doc), DocExtraction)

    def extract_all(
        self, case_id: str, documents: list[ParsedDocument], as_of: dt.date
    ) -> ExtractionResult:
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            outputs = list(pool.map(self.extract_document, documents))
        extractions = [Extraction(d, o) for d, o in zip(documents, outputs, strict=True)]
        return ExtractionResult(merge(case_id, as_of, extractions), extractions)

    def extract(self, case_id: str, documents: list[ParsedDocument], as_of: dt.date) -> Handover:
        return self.extract_all(case_id, documents, as_of).handover
