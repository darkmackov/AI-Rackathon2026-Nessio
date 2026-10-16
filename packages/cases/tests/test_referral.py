"""S3 referral functions: draft, manual handover edits, validation and sending."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from onko_cases import (
    CodeNotNeededError,
    HandoverEditError,
    HandoverLockedError,
    NotValidatedError,
    TransitionError,
    add_examination,
    diagnosis_for_code,
    new_referral,
    pick_diagnosis_code,
    receive_referral,
    require_editable,
    send_referral,
    set_handover_field,
    sync_case_from_handover,
    validate_handover,
)
from onko_contracts import (
    CaseState,
    CodeCandidate,
    Evidence,
    FieldStatus,
    Handover,
    Origin,
    QueueColumn,
    Sourced,
    Stamp,
)
from pydantic import ValidationError

NOW = datetime(2026, 10, 2, 14, 0)
GP = "pl-1"


def _draft():
    return new_referral("case-1", "koc-1", GP, NOW)


def test_new_referral_is_a_draft_with_an_empty_handover():
    case, handover = _draft()
    assert case.state is CaseState.DRAFT and case.queue is QueueColumn.NEW
    assert case.patient_name == "" and case.referring_doctor_id == GP
    assert handover.case_id == "case-1" and handover.as_of == NOW.date()
    assert handover.validated_by_referrer is None


def test_set_field_stores_a_manual_value():
    _, handover = _draft()
    out = set_handover_field(handover, "performance_status", "ECOG 1", not_available=False,
                             note=None, by=GP, now=NOW)
    field = out.performance_status
    assert field.value == "ECOG 1" and field.status is FieldStatus.FOUND
    assert field.origin is Origin.MANUAL and field.entered == Stamp(by=GP, at=NOW)


def test_set_field_marks_not_available_with_a_note():
    _, handover = _draft()
    out = set_handover_field(handover, "contacts.patient_email", None, not_available=True,
                             note="pacientka nemá e-mail", by=GP, now=NOW)
    field = out.contacts.patient_email
    assert field.value is None and field.status is FieldStatus.MISSING
    assert field.origin is Origin.MANUAL and field.note == "pacientka nemá e-mail"


def test_set_field_reaches_nested_patient_fields_and_lists():
    _, handover = _draft()
    out = set_handover_field(handover, "patient.first_name", "Jana", not_available=False,
                             note=None, by=GP, now=NOW)
    out = set_handover_field(out, "comorbidities", ["DM 2. typu"], not_available=False,
                             note=None, by=GP, now=NOW)
    assert out.patient.first_name.value == "Jana"
    assert out.comorbidities.value == ["DM 2. typu"]


@pytest.mark.parametrize("path", ["nope", "examinations", "patient", "patient.nope", "case_id"])
def test_set_field_rejects_paths_that_are_not_sourced_fields(path):
    _, handover = _draft()
    with pytest.raises(HandoverEditError):
        set_handover_field(handover, path, "x", not_available=False, note=None, by=GP, now=NOW)


def test_set_field_needs_a_value_or_not_available():
    _, handover = _draft()
    with pytest.raises(HandoverEditError):
        set_handover_field(handover, "allergies", None, not_available=False, note=None, by=GP, now=NOW)


def test_set_field_rejects_a_value_of_the_wrong_type():
    _, handover = _draft()
    with pytest.raises(ValidationError):
        set_handover_field(handover, "weight_kg", "hodně", not_available=False, note=None, by=GP, now=NOW)


def test_add_examination_is_manual():
    _, handover = _draft()
    out = add_examination(handover, date=date(2026, 9, 30), place="Ordinace PL", type="UZ břicha",
                          result_full_text="Ložisko v hlavě pankreatu.", by=GP, now=NOW)
    (exam,) = out.examinations
    assert exam.origin is Origin.MANUAL and exam.entered == Stamp(by=GP, at=NOW)


def test_editable_states_per_role():
    case, _ = _draft()
    require_editable(case, "referring_doctor")
    with pytest.raises(HandoverLockedError):
        require_editable(case, "coordinator")
    triage = case.model_copy(update={"state": CaseState.TRIAGE})
    require_editable(triage, "coordinator")
    with pytest.raises(HandoverLockedError):
        require_editable(triage, "referring_doctor")


def test_send_needs_validation():
    case, handover = _draft()
    with pytest.raises(NotValidatedError):
        send_referral(case, handover, None, NOW)


def test_send_a_draft_goes_to_the_koc_and_starts_the_clock():
    case, handover = _draft()
    handover = validate_handover(case, handover, GP, NOW)
    sent = send_referral(case, handover, None, NOW)
    assert sent.state is CaseState.SENT and sent.queue is QueueColumn.NEW
    assert sent.milestones.referred_at == NOW


def test_resend_after_a_return_needs_a_fresh_validation():
    case, handover = _draft()
    handover = validate_handover(case, handover, GP, NOW)
    referred = case.milestones.model_copy(update={"referred_at": NOW})
    returned = case.model_copy(update={"state": CaseState.RETURNED_TO_REFERRER, "milestones": referred})
    returned_at = NOW + timedelta(days=1)
    with pytest.raises(NotValidatedError):
        send_referral(returned, handover, returned_at, returned_at)

    later = returned_at + timedelta(hours=1)
    handover = validate_handover(returned, handover, GP, later)
    resent = send_referral(returned, handover, returned_at, later)
    assert resent.state is CaseState.TRIAGE
    assert resent.milestones.referred_at == NOW  # T1 keeps the original referral


def test_send_and_validate_only_from_draft_or_returned():
    case, handover = _draft()
    handover = validate_handover(case, handover, GP, NOW)
    sent = case.model_copy(update={"state": CaseState.SENT})
    with pytest.raises(TransitionError):
        send_referral(sent, handover, None, NOW)
    with pytest.raises(HandoverLockedError):
        validate_handover(sent, handover, GP, NOW)


def test_sync_copies_name_and_diagnosis_and_keeps_what_is_missing():
    case, handover = _draft()
    assert sync_case_from_handover(case, handover) == case
    for path, value in [("patient.first_name", "Jana"), ("patient.last_name", "Nováková"),
                        ("diagnosis", "Tumor hlavy pankreatu")]:
        handover = set_handover_field(handover, path, value, not_available=False, note=None, by=GP, now=NOW)
    synced = sync_case_from_handover(case, handover)
    assert synced.patient_name == "Jana Nováková"
    assert synced.diagnosis_label == "Tumor hlavy pankreatu"


def test_received_referral_is_sent_and_new_without_a_validation():
    case, handover = receive_referral("case-2", "koc-1", GP, NOW)
    assert case.state is CaseState.SENT and case.queue is QueueColumn.NEW
    assert case.milestones.referred_at == NOW and case.referring_doctor_id == GP
    assert handover.case_id == "case-2" and handover.validated_by_referrer is None


# --- MKN-10 code from AI suggestions (S8, Q-C11) --------------------------------------------


def _with_diagnosis(code: str | None = None):
    quoted = [Evidence(document_id="d1", quote="adenokarcinom")]
    handover = Handover(case_id="case-1", as_of=NOW.date(),
                        diagnosis=Sourced(value="adenokarcinom", status=FieldStatus.FOUND,
                                          evidence=quoted))
    if code:
        handover = handover.model_copy(update={"diagnosis_code": Sourced(
            value=code, status=FieldStatus.FOUND, evidence=quoted)})
    return handover


def _candidates():
    return [CodeCandidate(code="X01.0", title_cs="Novotvar A"),
            CodeCandidate(code="X01.9", title_cs="Novotvar B")]


def test_a_picked_candidate_is_a_manual_code_and_the_suggestion_is_audited():
    handover, event = pick_diagnosis_code(_with_diagnosis(), "X01.9", _candidates(),
                                          event_id="audit-1", by="koordinator", now=NOW)

    assert handover.diagnosis_code.value == "X01.9"
    assert handover.diagnosis_code.origin is Origin.MANUAL
    assert handover.diagnosis_code.entered == Stamp(by="koordinator", at=NOW)
    assert event.action == "diagnosis_code_from_ai" and event.case_id == "case-1"
    assert "X01.9" in event.detail and "X01.0" in event.detail


def test_only_a_suggested_code_can_be_picked():
    with pytest.raises(HandoverEditError):
        pick_diagnosis_code(_with_diagnosis(), "Z99", _candidates(), event_id="a", by="k", now=NOW)


def test_candidates_need_a_diagnosis_without_a_code():
    assert diagnosis_for_code(_with_diagnosis()) == "adenokarcinom"
    with pytest.raises(CodeNotNeededError):
        diagnosis_for_code(_with_diagnosis("X01.0"))
    with pytest.raises(CodeNotNeededError):
        diagnosis_for_code(Handover(case_id="case-1", as_of=NOW.date()))
