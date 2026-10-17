"""MDT (S5): 'Připravit podklad pro MDT' (the frozen handover snapshot), the MDT record
(`MDT_zapis`), and the MDT conclusion (`MDT_zaver`): edit windows, confirmation and the prefill of
the parts that restate the record."""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Iterable
from typing import Any

from onko_contracts import (
    Actor,
    Case,
    CaseState,
    ConclusionPrefill,
    ConclusionSource,
    DocumentMeta,
    Finding,
    Handover,
    Job,
    JobKind,
    JobStatus,
    LabPanel,
    MdtBoard,
    MdtConclusion,
    MdtRecord,
    MdtResultRow,
    Organization,
    Severity,
    Stamp,
)

from .coordination import _moved
from .models import (
    CaseStateError,
    ConclusionIncompleteError,
    MdtBoardError,
    SnapshotBlockedError,
    TransitionError,
)
from .referral import set_handover_field, sync_case_from_handover

# The record is the MDT's input: edited only before the meeting (Q-F34). The conclusion can be
# corrected until it is sent; a correction needs a new confirmation (Q-I20).
RECORD_EDIT_STATES = frozenset({CaseState.READY_FOR_MDT})
CONCLUSION_EDIT_STATES = frozenset({CaseState.READY_FOR_MDT, CaseState.MDT_CONCLUSION})

DEFINITIVE_CODE_NOTE = "Definitivní kód ze závěru MDT"


def open_blockers(findings: Iterable[Finding]) -> list[Finding]:
    """Blockers not resolved, dismissed or overridden yet (Q-C2)."""
    return [f for f in findings if f.severity is Severity.BLOCKER and not f.resolved]


def _evidence_documents(node: Any) -> set[str]:
    """Ids of every document the handover's evidence quotes, at any depth."""
    found: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "evidence" and isinstance(value, list):
                found |= {e["document_id"] for e in value if isinstance(e, dict)}
            else:
                found |= _evidence_documents(value)
    elif isinstance(node, list):
        for item in node:
            found |= _evidence_documents(item)
    return found


def quoted_documents(handover: Handover) -> list[str]:
    """Ids of the documents the handover's values, examinations or labs quote, sorted."""
    return sorted(_evidence_documents(handover.model_dump()))


def late_documents(handover: Handover, documents: Iterable[DocumentMeta], as_of: dt.date) -> list[str]:
    """Documents received after `as_of` that the handover's values, examinations or labs quote."""
    late = {d.id for d in documents if d.received_at is not None and d.received_at.date() > as_of}
    return sorted(late & _evidence_documents(handover.model_dump()))


def pending_ingest(jobs: Iterable[Job]) -> list[str]:
    """Ids of the case's document ingest jobs that are still queued or running."""
    return [j.id for j in jobs
            if j.kind is JobKind.INGEST_DOCUMENT and j.status in (JobStatus.QUEUED, JobStatus.RUNNING)]


def prepare_snapshot(
    case: Case,
    handover: Handover,
    findings: Iterable[Finding],
    documents: Iterable[DocumentMeta],
    *,
    board: MdtBoard,
    mdt_date: dt.date,
    by: str,
    now: dt.datetime,
    jobs: Iterable[Job] = (),
) -> tuple[Case, Handover]:
    """'Připravit podklad pro MDT': kompletni → pripraveno_k_mdt with the board and date set, and
    the frozen copy of the live handover (`as_of` = MDT date), confirmed by the coordinator
    (Q-F5, D-3). Only what was known by the MDT date may be in it, and never a handover whose
    documents are still being extracted (Q-F39)."""
    if case.state is not CaseState.COMPLETE:
        raise TransitionError(f"the MDT input is prepared from {CaseState.COMPLETE}, not {case.state}")
    if board.organization_id != case.koc_id:
        raise MdtBoardError("not an MDT board of the case's KOC")
    pending = pending_ingest(jobs)
    if pending:
        raise SnapshotBlockedError("documents still processing: " + ", ".join(pending))
    blockers = open_blockers(findings)
    if blockers:
        raise SnapshotBlockedError(
            "unresolved blockers: " + ", ".join(f.id for f in blockers)
        )
    late = late_documents(handover, documents, mdt_date)
    if late:
        raise SnapshotBlockedError(
            f"the handover uses documents received after {mdt_date.isoformat()}: " + ", ".join(late)
        )
    snapshot = handover.model_copy(update={
        "as_of": mdt_date,
        "confirmed_by_coordinator": Stamp(by=by, at=now),
    })
    ready = _moved(case, CaseState.READY_FOR_MDT).model_copy(update={
        "mdt_board_id": board.id,
        "mdt_date": mdt_date,
    })
    return ready, snapshot


def _lab_result(panel: LabPanel) -> str:
    def value(v: Any) -> str:
        text = " ".join(p for p in (v.name, v.value, v.unit) if p)
        return f"{text} ({v.flag})" if v.flag else text

    return "; ".join(value(v) for v in panel.values)


def result_rows(snapshot: Handover) -> list[MdtResultRow]:
    """Section 5 before any AI one-liners (Q-F35): every examination with its verbatim result,
    every lab panel with its values as printed, oldest first."""
    rows = [MdtResultRow(date=e.date, examination=e.type, result=e.result_full_text)
            for e in snapshot.examinations]
    rows += [MdtResultRow(date=p.date, examination=f"Laboratoř, {p.place}", result=_lab_result(p))
             for p in snapshot.labs]
    return sorted(rows, key=lambda r: r.date)


def build_mdt_record(
    snapshot: Handover,
    case: Case,
    board: MdtBoard,
    referrer: Actor | None,
    *,
    by: str,
    now: dt.datetime,
) -> MdtRecord:
    """The MDT record (`MDT_zapis` sections 1–5) from the frozen snapshot, the board roster
    (copied, Q-F13) and the referring doctor from the directory. Missing values stay None."""
    patient = snapshot.patient
    names = [v for v in (patient.first_name.value, patient.last_name.value) if v]
    return MdtRecord(
        case_id=case.id,
        mdt_date=snapshot.as_of,
        board_id=board.id,
        members=list(board.members),
        patient_name=" ".join(names) if names else (case.patient_name or None),
        insurance_code=patient.insurance_code.value,
        patient_phone=snapshot.contacts.patient_phone.value,
        patient_email=snapshot.contacts.patient_email.value,
        patient_address=patient.address.value,
        weight_kg=snapshot.weight_kg.value,
        height_cm=snapshot.height_cm.value,
        referring_doctor_name=referrer.name if referrer else None,
        referring_doctor_phone=referrer.phone if referrer else None,
        referring_doctor_email=referrer.email if referrer else None,
        diagnosis_name=snapshot.diagnosis.value,
        diagnosis_code=snapshot.diagnosis_code.value,
        comorbidities=list(snapshot.comorbidities.value or []),
        results=result_rows(snapshot),
        mdt_question=snapshot.mdt_question.value,
        created=Stamp(by=by, at=now),
    )


def update_record(case: Case, record: MdtRecord, changes: dict[str, Any]) -> MdtRecord:
    """Edit the record before the meeting (members, result one-liners, question, …)."""
    if case.state not in RECORD_EDIT_STATES:
        raise CaseStateError(f"the MDT record can't be changed in state {case.state}")
    return MdtRecord.model_validate({**record.model_dump(), **changes})


def _require_conclusion_editable(case: Case) -> None:
    if case.state not in CONCLUSION_EDIT_STATES:
        raise CaseStateError(f"the MDT conclusion can't be changed in state {case.state}")


def save_conclusion(
    case: Case, existing: MdtConclusion | None, fields: dict[str, Any]
) -> MdtConclusion:
    """Write the conclusion's fields. An uploaded MDT report stays the source (its structured
    fields are typed in from it); a change always needs a new confirmation."""
    _require_conclusion_editable(case)
    uploaded = existing is not None and existing.source is ConclusionSource.UPLOADED
    return MdtConclusion(
        case_id=case.id,
        source=ConclusionSource.UPLOADED if uploaded else ConclusionSource.WRITTEN,
        document_id=existing.document_id if uploaded else None,
        **fields,
    )


def attach_uploaded_conclusion(
    case: Case, existing: MdtConclusion | None, document_id: str
) -> MdtConclusion:
    """The MDT's own report uploaded as the conclusion (Q-F12). Fields typed in earlier stay."""
    _require_conclusion_editable(case)
    base = existing or MdtConclusion(case_id=case.id)
    return base.model_copy(update={
        "source": ConclusionSource.UPLOADED,
        "document_id": document_id,
        "confirmed": None,
    })


def confirm_conclusion(
    case: Case,
    conclusion: MdtConclusion,
    handover: Handover,
    *,
    by: str,
    now: dt.datetime,
) -> tuple[Case, MdtConclusion, Handover]:
    """The coordinator confirms the conclusion (required to send it): pripraveno_k_mdt →
    zaver_mdt, or a re-confirmation after a correction. The definitive diagnosis goes into the
    live handover as a manual value and the MDT counts as held (T2). Findings stay as they are:
    resolving them is explicit (Q-F36)."""
    _require_conclusion_editable(case)
    if conclusion.source is ConclusionSource.UPLOADED:
        if not conclusion.document_id:
            raise ConclusionIncompleteError("the uploaded MDT report is missing")
    elif not (conclusion.conclusion or "").strip():
        raise ConclusionIncompleteError("the conclusion has no text")

    confirmed = conclusion.model_copy(update={"confirmed": Stamp(by=by, at=now)})
    for path, value in (("diagnosis", conclusion.diagnosis_name),
                        ("diagnosis_code", conclusion.diagnosis_code)):
        if value:
            handover = set_handover_field(handover, path, value, not_available=False,
                                          note=DEFINITIVE_CODE_NOTE, by=by, now=now)
    if case.state is CaseState.READY_FOR_MDT:
        case = _moved(case, CaseState.MDT_CONCLUSION)
    held = conclusion.date or case.mdt_date or now.date()
    case = case.model_copy(update={"milestones": case.milestones.model_copy(update={"mdt_held": held})})
    return sync_case_from_handover(case, handover), confirmed, handover


_POSTCODE_TOWN = re.compile(r"\b\d{3}\s?\d{2}\s+(.+)$")


def town(address: str | None) -> str | None:
    """The town after the postcode of a Czech address ('Nemocniční 15, 140 00 Praha 4' →
    'Praha 4'); None when there is no postcode."""
    if not address:
        return None
    match = _POSTCODE_TOWN.search(address.split(",")[-1].strip())
    return match.group(1).strip() if match else None


def conclusion_prefill(
    record: MdtRecord,
    koc: Organization | None,
    referrer: Actor | None,
    referrer_organization: Organization | None,
) -> ConclusionPrefill:
    """The `mdt_conclusion` draft (Q-F37): not AI, only the `MDT_zaver` parts that restate the
    record. The diagnosis from the snapshot, the MDT date, the KOC's town and a copy to the
    referring doctor. Assessment, conclusion and recommendations are the MDT's and stay empty."""
    copy_to = []
    if referrer is not None:
        address = referrer_organization.address if referrer_organization else None
        copy_to.append(", ".join(v for v in (referrer.name, address) if v))
    return ConclusionPrefill(
        diagnosis_name=record.diagnosis_name,
        diagnosis_code=record.diagnosis_code,
        date=record.mdt_date,
        place=town(koc.address) if koc else None,
        copy_to=copy_to,
    )
