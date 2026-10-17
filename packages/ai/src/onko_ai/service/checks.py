"""Generic checks: handover + documents -> `Finding`s. Nothing here may know a reference case (PY-6)."""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import re
from collections.abc import Iterable

from onko_contracts import (
    DocumentType,
    Evidence,
    FieldStatus,
    Finding,
    FindingKind,
    Handover,
    Resolution,
    ResolutionKind,
    Severity,
    Sourced,
    SuggestedAction,
)
from onko_llm_gateway import Gateway

from ..models import (
    CheckContext,
    ClinicalReview,
    EventKind,
    Extraction,
    FieldPath,
    ReferenceMatches,
)
from ..ports import Check
from . import prompts
from .extract import birth_number_facts, norm, parse_date, parse_number, verified
from .quotes import evidence

LABELS = {
    "patient.first_name": "Jméno pacienta",
    "patient.last_name": "Příjmení pacienta",
    "patient.birth_number": "Rodné číslo",
    "patient.birth_date": "Datum narození",
    "patient.sex": "Pohlaví",
    "patient.insurance_code": "Kód zdravotní pojišťovny",
    "contacts.patient_phone": "Telefon pacienta",
    "contacts.patient_email": "E-mail pacienta",
    "contacts.contact_person": "Kontaktní osoba",
    "diagnosis": "Diagnóza",
    "diagnosis_code": "Kód diagnózy (MKN-10)",
    "comorbidities": "Komorbidity (OA)",
    "medications": "Léková anamnéza (FA)",
    "allergies": "Alergie (AA)",
    "performance_status": "Stav výkonnosti (ECOG / Karnofsky)",
    "weight_kg": "Hmotnost",
    "height_cm": "Výška",
    "symptoms": "Symptomy a jejich počátek",
    "examinations": "Provedená vyšetření",
}

# Handover_obsah + MDT_zapis (Q-C4): what must be there, how bad a gap is, the usual fix, and
# whether the coordinator may override the gap with a note. Identity and the patient's phone must be filled in.
REQUIRED: list[tuple[str, Severity, SuggestedAction, bool]] = [
    ("patient.first_name", Severity.BLOCKER, SuggestedAction.FILL_IN, False),
    ("patient.last_name", Severity.BLOCKER, SuggestedAction.FILL_IN, False),
    ("patient.birth_number", Severity.BLOCKER, SuggestedAction.FILL_IN, False),
    ("patient.birth_date", Severity.WARNING, SuggestedAction.FILL_IN, True),
    ("patient.sex", Severity.WARNING, SuggestedAction.FILL_IN, True),
    ("patient.insurance_code", Severity.BLOCKER, SuggestedAction.FILL_IN, False),
    ("contacts.patient_phone", Severity.BLOCKER, SuggestedAction.FILL_IN, False),
    ("contacts.patient_email", Severity.WARNING, SuggestedAction.FILL_IN, True),
    ("contacts.contact_person", Severity.WARNING, SuggestedAction.FILL_IN, True),
    ("diagnosis", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("diagnosis_code", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("comorbidities", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("medications", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("allergies", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("performance_status", Severity.BLOCKER, SuggestedAction.REQUEST, True),  # Q-C2: overridable blocker
    ("weight_kg", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("height_cm", Severity.WARNING, SuggestedAction.REQUEST, True),
    ("symptoms", Severity.WARNING, SuggestedAction.REQUEST, True),
]

AUTO = "ai"  # `Resolution.by` of findings the pipeline itself closed; people's resolutions are kept
STALE_AFTER = dt.timedelta(days=28)  # Q-C6
WEIGHT_TREND = 0.05  # relative change worth showing
LAB_TREND = 0.15


def get(handover: Handover, path: str) -> Sourced:
    obj = handover
    for part in path.split("."):
        obj = getattr(obj, part)
    return obj  # type: ignore[return-value]


def _fmt(d: dt.date | None) -> str:
    return f"{d.day}. {d.month}. {d.year}" if d else "?"


def _claims(extractions: Iterable[Extraction], path: FieldPath):
    for ex in extractions:
        for claim in ex.output.fields:
            if claim.path is path:
                yield ex, claim


class RequiredFields:
    id = "required"

    def run(self, ctx: CheckContext) -> list[Finding]:
        out = []
        for path, severity, action, overridable in REQUIRED:
            sourced = get(ctx.handover, path)
            if sourced.status is not FieldStatus.MISSING or sourced.value is not None:
                continue
            out.append(
                Finding(
                    id=f"required:{path}",
                    kind=FindingKind.MISSING,
                    severity=severity,
                    fields=[path],
                    message_cs=f"{LABELS[path]}: v podkladech chybí.",
                    evidence=sourced.evidence,
                    suggested_action=action,
                    overridable=overridable,
                )
            )
        if not ctx.handover.examinations:
            out.append(
                Finding(
                    id="required:examinations",
                    kind=FindingKind.MISSING,
                    severity=Severity.WARNING,
                    fields=["examinations"],
                    message_cs="V podkladech není žádné provedené vyšetření s výsledkem.",
                    suggested_action=SuggestedAction.REQUEST,
                )
            )
        return out


class Conflicts:
    id = "conflict"

    def run(self, ctx: CheckContext) -> list[Finding]:
        out = []
        for path in [p.value for p in FieldPath]:
            sourced = get(ctx.handover, path)
            if sourced.status is FieldStatus.CONFLICT:
                out.append(
                    Finding(
                        id=f"conflict:{path}",
                        kind=FindingKind.CONFLICT,
                        severity=Severity.WARNING,
                        fields=[path],
                        message_cs=f"{LABELS.get(path, path)}: podklady si odporují. {sourced.note or ''}".strip(),
                        evidence=sourced.evidence,
                        suggested_action=SuggestedAction.REQUEST,
                    )
                )
        return out


class ProvisionalDiagnosis:
    """The code only appears as suspected and no document confirms it (Q-C9)."""

    id = "provisional"

    def run(self, ctx: CheckContext) -> list[Finding]:
        code = get(ctx.handover, "diagnosis_code")
        if code.status is not FieldStatus.FOUND:
            return []
        claims = [
            (ex, c)
            for ex, c in _claims(ctx.extractions, FieldPath.DIAGNOSIS_CODE)
            if norm(c.value) == norm(code.value)
        ]
        if any(c.certainty == "confirmed" for _, c in claims):
            return []
        suspected = [
            e for ex, c in claims if c.certainty == "suspected" for e in verified(c, ex.document)
        ]
        if not suspected:
            return []
        return [
            Finding(
                id="provisional:diagnosis_code",
                kind=FindingKind.MISSING,
                severity=Severity.WARNING,
                fields=["diagnosis_code"],
                message_cs=f"Kód diagnózy {code.value} je v podkladech uveden jen jako suspektní. "
                "Definitivní kód doplní koordinátor(ka) podle závěru MDT.",
                evidence=suspected + get(ctx.handover, "histology").evidence[:1],
                suggested_action=SuggestedAction.REVIEW,
            )
        ]


class Temporal:
    """A document states something that happened after the document itself was issued."""

    id = "temporal"

    def run(self, ctx: CheckContext) -> list[Finding]:
        out = []
        for ex in ctx.extractions:
            doc_date = ex.document.meta.document_date
            if doc_date is None:
                continue
            seen = set()
            for event in ex.output.events:
                when = parse_date(event.date)
                if (
                    when is None
                    or when <= doc_date
                    or event.kind in (EventKind.PLANNED, EventKind.RESULT_ISSUED)
                ):
                    continue
                ev = evidence(event.quote, ex.document)
                if ev is None or when in seen:
                    continue
                seen.add(when)
                if event.kind is EventKind.LAST_DOSE:
                    fields = ["examinations", "medications"]
                elif ex.document.meta.doc_type is DocumentType.HISTOLOGY:
                    fields = ["histology"]
                else:
                    fields = ["examinations"]
                title = ex.document.meta.title or ex.document.meta.filename
                out.append(
                    Finding(
                        id=f"temporal:{ex.document.meta.id}:{when.isoformat()}",
                        kind=FindingKind.TEMPORAL,
                        severity=Severity.WARNING,
                        fields=fields,
                        message_cs=f"{title} ({_fmt(doc_date)}) uvádí datum {_fmt(when)}, tedy po datu "
                        f"dokumentu ({event.description}). Datum je pravděpodobně chybné, ověřit.",
                        evidence=[ev],
                        suggested_action=SuggestedAction.REQUEST,
                    )
                )
        return out


class UnattachedReferences:
    """A document cites a result that is not among the case documents."""

    id = "unattached"

    def __init__(self, gateway: Gateway):
        self.gateway = gateway

    def run(self, ctx: CheckContext) -> list[Finding]:
        refs = [(ex, r) for ex in ctx.extractions for r in ex.output.referenced_results]
        if not refs:
            return []
        attached = [
            {
                "id": d.meta.id,
                "title": d.meta.title,
                "doc_type": d.meta.doc_type,
                "date": str(d.meta.document_date),
            }
            for d in ctx.documents
        ]
        listed = [
            {
                "reference": i,
                "cited_in": ex.document.meta.id,
                "description": r.description,
                "doc_type": r.doc_type,
                "date": r.date,
            }
            for i, (ex, r) in enumerate(refs)
        ]
        answer = self.gateway.complete(
            [
                {"role": "system", "content": prompts.MATCH_REFERENCES},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"attached": attached, "references": listed},
                        ensure_ascii=False,
                        default=str,
                    ),
                },
            ],
            ReferenceMatches,
        )
        known = {d.meta.id for d in ctx.documents}
        matched = {m.reference for m in answer.matches if m.document_id in known}
        missing: dict[str, list] = {}
        for i, (ex, r) in enumerate(refs):
            if i not in matched:
                missing.setdefault(ex.document.meta.id, []).append((ex, r))
        out = []
        for doc_id, items in missing.items():
            ev = [e for ex, r in items if (e := evidence(r.quote, ex.document)) is not None]
            fields = ["examinations"] + (
                ["labs"] if any(r.doc_type is DocumentType.LAB for _, r in items) else []
            )
            what = "; ".join(
                f"{r.description}{' ' + _fmt(parse_date(r.date)) if parse_date(r.date) else ''}"
                for _, r in items
            )
            out.append(
                Finding(
                    id=f"unattached:{doc_id}",
                    kind=FindingKind.UNATTACHED_REFERENCE,
                    severity=Severity.BLOCKER,
                    fields=fields,
                    message_cs=f"Dokument {doc_id} odkazuje na výsledky, které nejsou přiloženy: {what}. Vyžádat.",
                    evidence=ev,
                    suggested_action=SuggestedAction.REQUEST,
                )
            )
        return out


def _age(birth: dt.date, on: dt.date) -> int:
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


class Identity:
    """RČ ↔ birth date / sex / age, per document (Q-C5)."""

    id = "identity"

    def run(self, ctx: CheckContext) -> list[Finding]:
        rc = get(ctx.handover, "patient.birth_number")
        facts = birth_number_facts(str(rc.value)) if rc.status is FieldStatus.FOUND else None
        if facts is None:
            return []
        birth, sex = facts
        out = []
        for ex in ctx.extractions:
            doc = ex.document
            for claim in ex.output.fields:
                ev = verified(claim, doc)
                if not ev:
                    continue
                problem = None
                if claim.path is FieldPath.BIRTH_NUMBER and norm(claim.value) != norm(rc.value):
                    problem = f"rodné číslo {claim.value} se liší od {rc.value}"
                elif claim.path is FieldPath.BIRTH_DATE and parse_date(claim.value) not in (
                    None,
                    birth,
                ):
                    problem = f"datum narození {_fmt(parse_date(claim.value))} neodpovídá RČ {rc.value} ({_fmt(birth)})"
                elif claim.path is FieldPath.SEX and claim.value and norm(claim.value) != norm(sex):
                    problem = f"pohlaví '{claim.value}' neodpovídá RČ {rc.value}"
                elif claim.path is FieldPath.AGE and doc.meta.document_date:
                    age = parse_number(claim.value)
                    expected = _age(birth, doc.meta.document_date)
                    if age is not None and int(age) not in (expected, expected + 1, expected - 1):
                        problem = f"věk {int(age)} neodpovídá RČ {rc.value} ({expected} let)"
                if problem:
                    out.append(
                        Finding(
                            id=f"identity:{claim.path.value}:{doc.meta.id}",
                            kind=FindingKind.IDENTITY,
                            severity=Severity.WARNING,
                            fields=[claim.path.value],
                            message_cs=f"Dokument {doc.meta.id}: {problem}. Ověřit totožnost / opravit údaj.",
                            evidence=ev + rc.evidence[:1],
                            suggested_action=SuggestedAction.REVIEW,
                        )
                    )
        return out


class Trends:
    """Weight and lab changes across documents, and a stale last weight (Q-C6). Informational."""

    id = "trend"

    def run(self, ctx: CheckContext) -> list[Finding]:
        return self._weight(ctx) + self._labs(ctx.handover)

    def _weight(self, ctx: CheckContext) -> list[Finding]:
        points: list[tuple[dt.date, float, Evidence]] = []
        for ex, claim in _claims(ctx.extractions, FieldPath.WEIGHT_KG):
            value, when, ev = (
                parse_number(claim.value),
                ex.document.meta.document_date,
                verified(claim, ex.document),
            )
            if value is not None and when is not None and ev:
                points.append((when, value, ev[0]))
        points.sort(key=lambda p: p[0])
        out = []
        if len(points) >= 2:
            first, last = points[0], points[-1]
            if abs(last[1] - first[1]) / first[1] >= WEIGHT_TREND:
                verb = "Úbytek" if last[1] < first[1] else "Nárůst"
                out.append(
                    Finding(
                        id="trend:weight_kg",
                        kind=FindingKind.TREND,
                        severity=Severity.INFO,
                        fields=["weight_kg"],
                        message_cs=f"{verb} hmotnosti {first[1]:g} → {last[1]:g} kg ({_fmt(first[0])} → {_fmt(last[0])}).",
                        evidence=[first[2], last[2]],
                        suggested_action=SuggestedAction.REVIEW,
                    )
                )
        if points and ctx.as_of - points[-1][0] > STALE_AFTER:
            when, value, ev = points[-1]
            weeks = (ctx.as_of - when).days // 7
            out.append(
                Finding(
                    id="stale:weight_kg",
                    kind=FindingKind.TREND,
                    severity=Severity.INFO,
                    fields=["weight_kg"],
                    message_cs=f"Poslední hmotnost ({value:g} kg) je z {_fmt(when)}, k {_fmt(ctx.as_of)} tedy {weeks} týdnů stará.",
                    evidence=[ev],
                    suggested_action=SuggestedAction.REQUEST,
                )
            )
        return out

    def _labs(self, handover: Handover) -> list[Finding]:
        series: dict[str, list] = {}
        for panel in handover.labs:
            for v in panel.values:
                n = parse_number(v.value)
                if n is not None:
                    series.setdefault(norm(v.name), []).append((panel, v, n))
        lines, ev = [], []
        for points in series.values():
            if len(points) < 2:
                continue
            (p0, v0, n0), (p1, v1, n1) = points[0], points[-1]
            if p0.date == p1.date:
                continue
            changed = n0 != 0 and abs(n1 - n0) / abs(n0) >= LAB_TREND
            if changed or (v0.flag or "") != (v1.flag or ""):
                lines.append(f"{v1.name} {v0.value} → {v1.value}{' ' + v1.unit if v1.unit else ''}")
                ev += [e for e in (p0.evidence[:1] + p1.evidence[:1]) if e not in ev]
        if not lines:
            return []
        first, last = handover.labs[0].date, handover.labs[-1].date
        return [
            Finding(
                id="trend:labs",
                kind=FindingKind.TREND,
                severity=Severity.INFO,
                fields=["labs"],
                message_cs=f"Laboratorní vývoj {_fmt(first)} → {_fmt(last)}: "
                + ", ".join(lines)
                + ".",
                evidence=ev,
                suggested_action=SuggestedAction.REVIEW,
            )
        ]


REVIEW_PATHS = [p.value for p in FieldPath] + ["examinations", "labs"]


def _review_path(raw: str) -> str | None:
    path = raw.strip().removeprefix("handover.").removesuffix(".value")
    path = re.sub(r"\[\d+\].*$", "", path)
    return path if path in REVIEW_PATHS else None


class ClinicalReviewCheck:
    """Advisory LLM review of the whole case (Q-C3). Only notes backed by verified quotes survive."""

    id = "review"

    def __init__(self, gateway: Gateway):
        self.gateway = gateway

    def run(self, ctx: CheckContext) -> list[Finding]:
        docs = {d.meta.id: d for d in ctx.documents}
        handover = ctx.handover.model_dump(mode="json", exclude={"epicrisis_source"})
        for exam in handover["examinations"]:
            exam.pop("evidence", None)
        payload = {
            "handover": handover,
            "problems_already_found": [f.message_cs for f in ctx.prior],
            "documents": {i: d.text for i, d in docs.items()},
        }
        review = self.gateway.complete(
            [
                {
                    "role": "system",
                    "content": prompts.CLINICAL_REVIEW.replace("{paths}", ", ".join(REVIEW_PATHS)),
                },
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False, default=str)},
            ],
            ClinicalReview,
        )
        out = []
        for note in review.notes[:3]:
            ev = [
                e
                for q in note.quotes
                if q.document_id in docs and (e := evidence(q.quote, docs[q.document_id]))
            ]
            if not ev:
                continue
            fields = sorted({p for f in note.fields if (p := _review_path(f))}) or ["other"]
            out.append(
                Finding(
                    id=f"review:{'+'.join(fields)}",
                    kind=FindingKind.MISSING,
                    severity=Severity.INFO,
                    fields=fields,
                    message_cs=note.message_cs,
                    evidence=ev,
                    suggested_action=SuggestedAction.REVIEW,
                    advisory=True,
                )
            )
        return out


def build_checks(gateway: Gateway | None) -> list[Check]:
    """The registry. Model-backed checks only run with a gateway."""
    checks: list[Check] = [
        RequiredFields(),
        Conflicts(),
        ProvisionalDiagnosis(),
        Temporal(),
        Identity(),
        Trends(),
    ]
    if gateway is not None:
        checks.insert(4, UnattachedReferences(gateway))
        checks.append(ClinicalReviewCheck(gateway))
    return checks


def check(ctx: CheckContext, checks: list[Check]) -> list[Finding]:
    found: list[Finding] = []
    for c in checks:
        found += c.run(dataclasses.replace(ctx, prior=list(found)))
    unique = {}
    for f in found:
        unique.setdefault(f.id, f)
    return list(unique.values())


def reconcile_findings(
    previous: list[Finding], current: list[Finding], now: dt.datetime
) -> list[Finding]:
    """Keep people's resolutions across re-runs; a previous open finding that no longer appears
    is marked resolved (e.g. the cited report got uploaded)."""
    before = {f.id: f for f in previous}
    out = []
    for f in current:
        old = before.get(f.id)
        if old is not None and old.resolution is not None and old.resolution.by != AUTO:
            f = f.model_copy(update={"resolved": old.resolved, "resolution": old.resolution})
        out.append(f)
    ids = {f.id for f in current}
    for old in previous:
        if old.id in ids:
            continue
        if not old.resolved:
            old = old.model_copy(
                update={
                    "resolved": True,
                    "resolution": Resolution(
                        kind=ResolutionKind.RESOLVED,
                        note="Po novém vytěžení podkladů již neplatí.",
                        by=AUTO,
                        at=now,
                    ),
                }
            )
        out.append(old)
    return out
