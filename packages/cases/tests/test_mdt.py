"""MDT (S5): snapshot, MDT record, conclusion edit windows and confirmation. Pure logic, fixed NOW."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from onko_cases import (
    CaseStateError,
    ConclusionIncompleteError,
    MdtBoardError,
    SnapshotBlockedError,
    TransitionError,
    attach_uploaded_conclusion,
    build_mdt_record,
    conclusion_prefill,
    confirm_conclusion,
    late_documents,
    open_blockers,
    prepare_snapshot,
    result_rows,
    save_conclusion,
    town,
    update_record,
)
from onko_contracts import (
    Actor,
    Case,
    CaseState,
    ConclusionSource,
    Contacts,
    DocumentMeta,
    Evidence,
    Examination,
    FieldStatus,
    Finding,
    FindingKind,
    Handover,
    LabPanel,
    LabValue,
    MdtBoard,
    MdtConclusion,
    MdtMember,
    Organization,
    OrganizationKind,
    Origin,
    PatientDetails,
    QueueColumn,
    Resolution,
    ResolutionKind,
    Severity,
    Sourced,
    Stamp,
)

NOW = datetime(2026, 10, 21, 8, 0)
MDT_DAY = date(2026, 10, 21)
BOARD = MdtBoard(id="mdt-a", name="MDT GIT", organization_id="koc-a",
                 members=[MdtMember(name="MUDr. Hrubý", specialty="chirurgie")])
GP = Actor(id="pl-a", name="MUDr. Řezníček", role="referring_doctor", organization_id="pl-org",
           phone="+420 311 000 287")


def _case(state: CaseState = CaseState.COMPLETE, **update) -> Case:
    case = Case(id="c1", patient_name="Jana Nováková", koc_id="koc-a", referring_doctor_id="pl-a",
                coordinator_id="koord-a", state=state, queue=QueueColumn.ACTIVE,
                created_at=datetime(2026, 10, 2, 14, 0))
    return case.model_copy(update=update)


def _ai(value, document_id: str = "d1") -> Sourced:
    return Sourced(value=value, status=FieldStatus.FOUND,
                   evidence=[Evidence(document_id=document_id, quote=str(value))])


def _handover(**update) -> Handover:
    handover = Handover(
        case_id="c1", as_of=date(2026, 10, 20),
        patient=PatientDetails(first_name=_ai("Jana"), last_name=_ai("Nováková"),
                               insurance_code=_ai("211"), address=_ai("Za Školou 17")),
        contacts=Contacts(patient_phone=_ai("+420 777 123 456")),
        diagnosis=_ai("Karcinom pankreatu"), diagnosis_code=_ai("C25.0"),
        comorbidities=_ai(["hypertenze"]), weight_kg=_ai(65.0), height_cm=_ai(165.0),
        mdt_question=Sourced(value="Resekabilita?", status=FieldStatus.FOUND, origin=Origin.MANUAL,
                             entered=Stamp(by="koord-a", at=NOW)),
        examinations=[Examination(date=date(2026, 10, 8), place="KOC 1", type="CT břicha",
                                  result_full_text="Tumor 35 mm.",
                                  evidence=[Evidence(document_id="d2", quote="Tumor")])],
        labs=[LabPanel(date=date(2026, 9, 1), place="LabJih",
                       values=[LabValue(name="CRP", value="86", unit="mg/l", flag="H"),
                               LabValue(name="Hb", value="118", unit="g/l")])],
    )
    return handover.model_copy(update=update)


def _doc(doc_id: str, received: datetime | None) -> DocumentMeta:
    return DocumentMeta(id=doc_id, case_id="c1", filename=f"{doc_id}.docx", received_at=received)


DOCS = [_doc("d1", datetime(2026, 10, 2, 9)), _doc("d2", datetime(2026, 10, 8, 12))]


def _blocker(resolved: bool = False) -> Finding:
    return Finding(
        id="F01", kind=FindingKind.MISSING, severity=Severity.BLOCKER, message_cs="Chybí ECOG",
        resolved=resolved,
        resolution=Resolution(kind=ResolutionKind.OVERRIDDEN, note="neuvedeno", by="koord-a", at=NOW)
        if resolved else None,
    )


def _snapshot(**kw):
    args = {"board": BOARD, "mdt_date": MDT_DAY, "by": "koord-a", "now": NOW}
    return prepare_snapshot(_case(), _handover(), kw.pop("findings", []), kw.pop("documents", DOCS),
                            **{**args, **kw})


# --- snapshot ----------------------------------------------------------------------------------


def test_snapshot_freezes_the_handover_and_moves_the_case():
    ready, snapshot = _snapshot(findings=[_blocker(resolved=True)])

    assert ready.state is CaseState.READY_FOR_MDT
    assert ready.mdt_board_id == "mdt-a"
    assert ready.mdt_date == MDT_DAY
    assert ready.queue is QueueColumn.ACTIVE
    assert snapshot.as_of == MDT_DAY
    assert snapshot.confirmed_by_coordinator == Stamp(by="koord-a", at=NOW)
    assert snapshot.diagnosis == _handover().diagnosis  # a copy, nothing re-extracted


def test_open_blockers_stop_the_snapshot():
    assert open_blockers([_blocker(), _blocker(resolved=True)]) == [_blocker()]
    with pytest.raises(SnapshotBlockedError, match="F01"):
        _snapshot(findings=[_blocker()])


def test_warnings_do_not_stop_the_snapshot():
    warning = _blocker().model_copy(update={"severity": Severity.WARNING})
    ready, _ = _snapshot(findings=[warning])
    assert ready.state is CaseState.READY_FOR_MDT


def test_a_document_received_after_the_mdt_date_stops_the_snapshot():
    late = [DOCS[0], _doc("d2", datetime(2026, 10, 26, 9))]
    assert late_documents(_handover(), late, MDT_DAY) == ["d2"]  # quoted by the examination
    with pytest.raises(SnapshotBlockedError, match="d2"):
        _snapshot(documents=late)


def test_a_late_document_the_handover_does_not_use_is_fine():
    unused = [*DOCS, _doc("d9", datetime(2026, 10, 27, 9))]
    assert late_documents(_handover(), unused, MDT_DAY) == []
    _snapshot(documents=unused)


def test_snapshot_only_from_complete_and_with_a_board_of_the_koc():
    with pytest.raises(TransitionError):
        prepare_snapshot(_case(CaseState.WAITING_FOR_DOCUMENTS), _handover(), [], DOCS,
                         board=BOARD, mdt_date=MDT_DAY, by="koord-a", now=NOW)
    with pytest.raises(MdtBoardError):
        _snapshot(board=BOARD.model_copy(update={"organization_id": "koc-b"}))


# --- record ------------------------------------------------------------------------------------


def test_record_comes_from_the_snapshot_board_and_referrer():
    ready, snapshot = _snapshot()
    record = build_mdt_record(snapshot, ready, BOARD, GP, by="koord-a", now=NOW)

    assert record.mdt_date == MDT_DAY
    assert record.members == BOARD.members
    assert record.patient_name == "Jana Nováková"
    assert record.insurance_code == "211"
    assert record.patient_phone == "+420 777 123 456"
    assert record.patient_email is None  # missing stays missing
    assert (record.weight_kg, record.height_cm) == (65.0, 165.0)
    assert record.referring_doctor_name == "MUDr. Řezníček"
    assert record.referring_doctor_phone == "+420 311 000 287"
    assert (record.diagnosis_name, record.diagnosis_code) == ("Karcinom pankreatu", "C25.0")
    assert record.comorbidities == ["hypertenze"]
    assert record.mdt_question == "Resekabilita?"
    assert record.created == Stamp(by="koord-a", at=NOW)


def test_results_list_examinations_verbatim_and_labs_oldest_first():
    rows = result_rows(_handover())
    assert [(r.date, r.examination) for r in rows] == [
        (date(2026, 9, 1), "Laboratoř, LabJih"), (date(2026, 10, 8), "CT břicha")]
    assert rows[0].result == "CRP 86 mg/l (H); Hb 118 g/l"
    assert rows[1].result == "Tumor 35 mm."


def test_record_without_a_name_falls_back_to_the_case():
    snapshot = _handover(patient=PatientDetails())
    record = build_mdt_record(snapshot, _case(), BOARD, None, by="k", now=NOW)
    assert record.patient_name == "Jana Nováková"
    assert record.referring_doctor_name is None


def test_record_is_edited_only_before_the_meeting():
    ready, snapshot = _snapshot()
    record = build_mdt_record(snapshot, ready, BOARD, GP, by="koord-a", now=NOW)

    edited = update_record(ready, record, {"mdt_question": "Neoadjuvance?", "results": []})
    assert edited.mdt_question == "Neoadjuvance?"
    assert edited.results == []
    assert edited.patient_name == record.patient_name

    with pytest.raises(CaseStateError):
        update_record(_case(CaseState.MDT_CONCLUSION), record, {"mdt_question": "x"})


# --- conclusion --------------------------------------------------------------------------------


def test_written_conclusion_replaces_the_fields_and_drops_the_confirmation():
    ready = _case(CaseState.READY_FOR_MDT, mdt_date=MDT_DAY)
    confirmed = MdtConclusion(case_id="c1", conclusion="Chemo", confirmed=Stamp(by="k", at=NOW))
    saved = save_conclusion(ready, confirmed, {"conclusion": "Operace", "recommendations": ["CT"]})
    assert saved.source is ConclusionSource.WRITTEN
    assert saved.conclusion == "Operace"
    assert saved.confirmed is None


def test_uploaded_report_stays_the_source_when_fields_are_typed_in():
    ready = _case(CaseState.READY_FOR_MDT)
    uploaded = attach_uploaded_conclusion(ready, None, "doc-mdt")
    assert (uploaded.source, uploaded.document_id) == (ConclusionSource.UPLOADED, "doc-mdt")

    typed = save_conclusion(ready, uploaded, {"diagnosis_code": "C25.0"})
    assert (typed.source, typed.document_id, typed.diagnosis_code) == (
        ConclusionSource.UPLOADED, "doc-mdt", "C25.0")

    written = MdtConclusion(case_id="c1", conclusion="Chemo", confirmed=Stamp(by="k", at=NOW))
    replaced = attach_uploaded_conclusion(ready, written, "doc-mdt")
    assert replaced.conclusion == "Chemo"
    assert replaced.confirmed is None


@pytest.mark.parametrize("state", [CaseState.COMPLETE, CaseState.FEEDBACK_SENT, CaseState.CLOSED])
def test_conclusion_is_locked_outside_its_window(state):
    with pytest.raises(CaseStateError):
        save_conclusion(_case(state), None, {"conclusion": "x"})
    with pytest.raises(CaseStateError):
        attach_uploaded_conclusion(_case(state), None, "doc")
    with pytest.raises(CaseStateError):
        confirm_conclusion(_case(state), MdtConclusion(case_id="c1", conclusion="x"), _handover(),
                           by="k", now=NOW)


def test_confirm_moves_the_case_and_records_the_definitive_diagnosis():
    ready = _case(CaseState.READY_FOR_MDT, mdt_date=MDT_DAY)
    conclusion = MdtConclusion(case_id="c1", conclusion="Neoadjuvance.", diagnosis_code="C25.0",
                               diagnosis_name="Duktální adenokarcinom hlavy pankreatu")
    later = datetime(2026, 10, 21, 15, 0)

    case, confirmed, handover = confirm_conclusion(ready, conclusion, _handover(), by="koord-a",
                                                   now=later)

    assert case.state is CaseState.MDT_CONCLUSION
    assert case.milestones.mdt_held == MDT_DAY
    assert case.diagnosis_label == "Duktální adenokarcinom hlavy pankreatu"
    assert confirmed.confirmed == Stamp(by="koord-a", at=later)
    code = handover.diagnosis_code
    assert (code.value, code.origin, code.entered) == ("C25.0", Origin.MANUAL,
                                                       Stamp(by="koord-a", at=later))
    assert handover.diagnosis.origin is Origin.MANUAL


def test_reconfirming_a_correction_keeps_the_state():
    case = _case(CaseState.MDT_CONCLUSION, mdt_date=MDT_DAY)
    conclusion = MdtConclusion(case_id="c1", conclusion="Opraveno.", date=date(2026, 10, 22))
    moved, confirmed, handover = confirm_conclusion(case, conclusion, _handover(), by="k", now=NOW)
    assert moved.state is CaseState.MDT_CONCLUSION
    assert moved.milestones.mdt_held == date(2026, 10, 22)
    assert confirmed.confirmed is not None
    assert handover.diagnosis_code == _handover().diagnosis_code  # no code given, nothing written


def test_confirm_needs_the_text_or_the_report():
    ready = _case(CaseState.READY_FOR_MDT)
    with pytest.raises(ConclusionIncompleteError):
        confirm_conclusion(ready, MdtConclusion(case_id="c1", conclusion="  "), _handover(),
                           by="k", now=NOW)
    with pytest.raises(ConclusionIncompleteError):
        confirm_conclusion(ready, MdtConclusion(case_id="c1", source=ConclusionSource.UPLOADED),
                           _handover(), by="k", now=NOW)
    uploaded = MdtConclusion(case_id="c1", source=ConclusionSource.UPLOADED, document_id="doc")
    case, _, _ = confirm_conclusion(ready, uploaded, _handover(), by="k", now=NOW)
    assert case.state is CaseState.MDT_CONCLUSION


def test_prefill_restates_the_record_and_leaves_the_decision_empty():
    ready, snapshot = _snapshot()
    record = build_mdt_record(snapshot, ready, BOARD, GP, by="koord-a", now=NOW)
    koc = Organization(id="koc-a", name="KOC A", kind=OrganizationKind.KOC,
                       address="Nemocniční 15, 140 00 Praha 4")
    practice = Organization(id="pl-org", name="Ordinace", kind=OrganizationKind.GP_PRACTICE,
                            address="Na Návsi 3, 252 41 Dolní Břežany")

    fields = conclusion_prefill(record, koc, GP, practice)

    assert fields == {
        "diagnosis_name": "Karcinom pankreatu",
        "diagnosis_code": "C25.0",
        "date": "2026-10-21",
        "place": "Praha 4",
        "copy_to": ["MUDr. Řezníček, Na Návsi 3, 252 41 Dolní Břežany"],
    }
    assert conclusion_prefill(record, None, None, None)["copy_to"] == []


@pytest.mark.parametrize(("address", "expected"), [
    ("Nemocniční 15, 140 00 Praha 4", "Praha 4"),
    ("Holzova 5, 628 00 Brno", "Brno"),
    ("Masarykovo nám. 12, 25101 Říčany", "Říčany"),
    ("bez PSČ", None),
    (None, None),
])
def test_town_after_the_postcode(address, expected):
    assert town(address) == expected
