"""Feedback loop (S6): sending the confirmed MDT conclusion to the referring doctor, closing the
case on their receipt, the context attached to it, and when a patient notice may be recorded."""

from __future__ import annotations

from onko_contracts import Case, CaseState, Handover, MdtConclusion

from .coordination import _moved, refresh_progress
from .mdt import quoted_documents
from .models import CaseStateError, ConclusionNotConfirmedError, TransitionError

# 'Informovat pacienta' needs a taken-over case that isn't closed yet (like tasks, Q-F32).
NOTICE_LOCKED_STATES = frozenset({CaseState.DRAFT, CaseState.SENT, CaseState.CLOSED})


def feedback_attachments(conclusion: MdtConclusion, snapshot: Handover | None) -> list[str]:
    """What goes with the result: the uploaded MDT report (if any) first, then every document the
    frozen MDT snapshot quotes (the original context)."""
    quoted = quoted_documents(snapshot) if snapshot is not None else []
    first = [conclusion.document_id] if conclusion.document_id else []
    return list(dict.fromkeys([*first, *quoted]))


def send_feedback(case: Case, conclusion: MdtConclusion) -> Case:
    """'Odeslat PL': zaver_mdt → zpetna_vazba_odeslana with a confirmed conclusion. The referring
    doctor is on the move until they confirm receipt; the conclusion can't be changed any more."""
    if case.state is not CaseState.MDT_CONCLUSION:
        raise TransitionError(f"the feedback is sent from {CaseState.MDT_CONCLUSION}, not {case.state}")
    if conclusion.confirmed is None:
        raise ConclusionNotConfirmedError("confirm the MDT conclusion before sending it")
    return refresh_progress(_moved(case, CaseState.FEEDBACK_SENT), [])


def close_after_receipt(case: Case) -> Case:
    """'Potvrzuji převzetí': zpetna_vazba_odeslana → uzavreno. A hold ends with the case; open
    tasks stay as they are. Nobody is on the move."""
    if case.state is not CaseState.FEEDBACK_SENT:
        raise TransitionError(f"a case closes from {CaseState.FEEDBACK_SENT}, not {case.state}")
    closed = _moved(case.model_copy(update={"on_hold": None}), CaseState.CLOSED)
    return refresh_progress(closed, [])


def require_patient_notice_allowed(case: Case) -> None:
    if case.state in NOTICE_LOCKED_STATES:
        raise CaseStateError(f"the patient can't be notified in state {case.state}")
