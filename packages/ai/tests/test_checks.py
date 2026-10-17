"""Generic checks on small invented cases, and the whole-case run with a fake gateway."""

from __future__ import annotations

import datetime as dt

from ai_testkit import NOW, FakeGateway, claim, make_doc, out
from onko_ai import (
    CheckContext,
    DocExtraction,
    Extraction,
    analyse_case,
    build_checks,
    check,
    merge,
    reconcile_findings,
)
from onko_ai.models import (
    Certainty,
    ClinicalReview,
    DatedEvent,
    EventKind,
    FieldPath,
    LabClaim,
    LabValueClaim,
    QuoteRef,
    ReferencedResult,
    ReferenceMatch,
    ReferenceMatches,
    ReviewNote,
)
from onko_contracts import DocumentType, FindingKind, Severity

AS_OF = dt.date(2026, 10, 20)


def run(pairs, gateway=None, as_of=AS_OF):
    extractions = [Extraction(d, o) for d, o in pairs]
    handover = merge("c", as_of, extractions)
    ctx = CheckContext(handover, [d for d, _ in pairs], extractions, as_of)
    return check(ctx, build_checks(gateway))


def by_id(findings):
    return {f.id: f for f in findings}


def test_missing_performance_status_is_an_overridable_blocker_and_present_fields_are_quiet():
    doc = make_doc("a", "AA: neguje. ECOG 1.", dt.date(2026, 10, 1))
    found = by_id(run([(doc, out(claim(FieldPath.ALLERGIES, "neguje", "AA: neguje")))]))
    ps = found["required:performance_status"]
    assert ps.severity is Severity.BLOCKER and ps.overridable
    assert "required:allergies" not in found
    assert found["required:contacts.patient_email"].severity is Severity.WARNING


def test_missing_identity_insurer_and_phone_are_blockers_that_cannot_be_overridden():
    doc = make_doc("a", "ECOG 1.", dt.date(2026, 10, 1))
    found = by_id(run([(doc, out(claim(FieldPath.PERFORMANCE_STATUS, "ECOG 1", "ECOG 1")))]))
    for path in (
        "patient.first_name",
        "patient.last_name",
        "patient.birth_number",
        "patient.insurance_code",
        "contacts.patient_phone",
    ):
        f = found[f"required:{path}"]
        assert f.severity is Severity.BLOCKER and not f.overridable, path
    assert found["required:patient.birth_date"].severity is Severity.WARNING


def test_conflict_status_raises_a_conflict_finding():
    a = make_doc("a", "AA: jod", dt.date(2026, 9, 1))
    b = make_doc("b", "AA: neguje", dt.date(2026, 10, 1))
    found = by_id(
        run(
            [
                (a, out(claim(FieldPath.ALLERGIES, "jod", "AA: jod"))),
                (b, out(claim(FieldPath.ALLERGIES, "neguje", "AA: neguje"))),
            ]
        )
    )
    assert found["conflict:allergies"].kind is FindingKind.CONFLICT


def test_suspected_code_is_provisional_until_a_document_confirms_it():
    ref = make_doc("a", "Susp. dg.: C34.1", dt.date(2026, 9, 1))
    suspected = (
        ref,
        out(
            claim(
                FieldPath.DIAGNOSIS_CODE, "C34.1", "Susp. dg.: C34.1", certainty=Certainty.SUSPECTED
            )
        ),
    )
    assert "provisional:diagnosis_code" in by_id(run([suspected]))

    hist = make_doc("b", "Dg.: C34.1, histologicky ověřeno", dt.date(2026, 10, 1))
    confirmed = (
        hist,
        out(
            claim(
                FieldPath.DIAGNOSIS_CODE,
                "C34.1",
                "Dg.: C34.1, histologicky ověřeno",
                certainty=Certainty.CONFIRMED,
            )
        ),
    )
    assert "provisional:diagnosis_code" not in by_id(run([suspected, confirmed]))


def test_event_after_its_document_date_is_temporal_but_planned_events_are_not():
    doc = make_doc(
        "a",
        "Výkon 3. 10. Odběr materiálu 9. 10. Kontrola 30. 10.",
        dt.date(2026, 10, 5),
        DocumentType.HISTOLOGY,
    )
    events = [
        DatedEvent(
            kind=EventKind.PROCEDURE, date="2026-10-03", description="výkon", quote="Výkon 3. 10."
        ),
        DatedEvent(
            kind=EventKind.SAMPLE_TAKEN,
            date="2026-10-09",
            description="odběr materiálu",
            quote="Odběr materiálu 9. 10.",
        ),
        DatedEvent(
            kind=EventKind.PLANNED,
            date="2026-10-30",
            description="kontrola",
            quote="Kontrola 30. 10.",
        ),
    ]
    temporal = [f for f in run([(doc, out(events=events))]) if f.kind is FindingKind.TEMPORAL]
    assert len(temporal) == 1
    assert temporal[0].fields == ["histology"]
    assert temporal[0].evidence[0].quote == "Odběr materiálu 9. 10."


def test_birth_date_not_matching_the_birth_number_is_an_identity_finding():
    a = make_doc("a", "RČ 705402/1234, nar. 2. 4. 1970", dt.date(2026, 9, 1))
    b = make_doc("b", "RČ 705402/1234, nar. 2. 4. 1975", dt.date(2026, 10, 1))
    pairs = [
        (
            a,
            out(
                claim(FieldPath.BIRTH_NUMBER, "705402/1234", "RČ 705402/1234"),
                claim(FieldPath.BIRTH_DATE, "1970-04-02", "nar. 2. 4. 1970"),
            ),
        ),
        (
            b,
            out(
                claim(FieldPath.BIRTH_NUMBER, "705402/1234", "RČ 705402/1234"),
                claim(FieldPath.BIRTH_DATE, "1975-04-02", "nar. 2. 4. 1975"),
            ),
        ),
    ]
    identity = [f for f in run(pairs) if f.kind is FindingKind.IDENTITY]
    assert [f.id for f in identity] == ["identity:patient.birth_date:b"]


def test_weight_loss_and_a_stale_weight_are_trends_small_changes_are_not():
    docs = [
        make_doc("a", "Hmotnost 80 kg.", dt.date(2026, 6, 1)),
        make_doc("b", "Hmotnost 74 kg.", dt.date(2026, 9, 1)),
    ]
    pairs = [(d, out(claim(FieldPath.WEIGHT_KG, d.text[9:11], d.text))) for d in docs]
    found = by_id(run(pairs))
    assert found["trend:weight_kg"].message_cs.startswith("Úbytek hmotnosti 80 → 74 kg")
    assert "stale:weight_kg" in found

    docs = [
        make_doc("a", "Hmotnost 80 kg.", dt.date(2026, 9, 20)),
        make_doc("b", "Hmotnost 79 kg.", dt.date(2026, 10, 10)),
    ]
    found = by_id(run([(d, out(claim(FieldPath.WEIGHT_KG, d.text[9:11], d.text))) for d in docs]))
    assert "trend:weight_kg" not in found and "stale:weight_kg" not in found


def test_lab_trend_lists_changed_or_newly_flagged_values_only():
    def panel(doc_id, date, hb, flag, na):
        doc = make_doc(
            doc_id,
            f"Odběr {date}\n| Hemoglobin | {hb} {flag or ''} |\n| Sodík | {na} |",
            dt.date.fromisoformat(date),
            DocumentType.LAB,
        )
        lab = LabClaim(
            date=date,
            place="Lab",
            date_quote=f"Odběr {date}",
            values=[
                LabValueClaim(
                    name="Hemoglobin", value=str(hb), unit="g/l", reference_range=None, flag=flag
                ),
                LabValueClaim(
                    name="Sodík", value=str(na), unit="mmol/l", reference_range=None, flag=None
                ),
            ],
        )
        return doc, out(labs=[lab])

    found = by_id(
        run([panel("a", "2026-09-01", 125, None, 140), panel("b", "2026-10-01", 117, "L", 139)])
    )
    msg = found["trend:labs"].message_cs
    assert "Hemoglobin 125 → 117" in msg and "Sodík" not in msg


def test_unattached_reference_uses_the_model_match_and_raises_a_blocker():
    referral = make_doc(
        "r",
        "Provedeno: MR mozku 1. 9. 2026, CT hrudníku 3. 9. 2026",
        dt.date(2026, 10, 1),
        DocumentType.REFERRAL,
    )
    ct = make_doc("ct", "CT hrudníku: bez ložisek", dt.date(2026, 9, 3), DocumentType.IMAGING)
    refs = [
        ReferencedResult(
            description="MR mozku",
            doc_type=DocumentType.IMAGING,
            date="2026-09-01",
            quote="MR mozku 1. 9. 2026",
        ),
        ReferencedResult(
            description="CT hrudníku",
            doc_type=DocumentType.IMAGING,
            date="2026-09-03",
            quote="CT hrudníku 3. 9. 2026",
        ),
    ]
    gw = FakeGateway(
        {
            ReferenceMatches: ReferenceMatches(
                matches=[
                    ReferenceMatch(reference=0, document_id=None),
                    ReferenceMatch(reference=1, document_id="ct"),
                ]
            ),
            ClinicalReview: ClinicalReview(notes=[]),
        }
    )
    found = by_id(run([(referral, out(referenced_results=refs)), (ct, out())], gw))
    f = found["unattached:r"]
    assert f.severity is Severity.BLOCKER and f.kind is FindingKind.UNATTACHED_REFERENCE
    assert "MR mozku" in f.message_cs and "CT hrudníku" not in f.message_cs


def test_clinical_review_keeps_only_notes_with_verified_quotes():
    doc = make_doc("a", "Ferritin 9 µg/l.", dt.date(2026, 10, 1))
    gw = FakeGateway(
        {
            ClinicalReview: ClinicalReview(
                notes=[
                    ReviewNote(
                        message_cs="Sideropenie bez substituce.",
                        fields=["labs"],
                        quotes=[QuoteRef(document_id="a", quote="Ferritin 9 µg/l.")],
                    ),
                    ReviewNote(
                        message_cs="Vymyšlená věc.",
                        fields=["other"],
                        quotes=[QuoteRef(document_id="a", quote="neexistuje")],
                    ),
                ]
            ),
        }
    )
    review = [f for f in run([(doc, out())], gw) if f.advisory]
    assert [f.message_cs for f in review] == ["Sideropenie bez substituce."]
    assert review[0].severity is Severity.INFO


def test_reconcile_keeps_resolutions_and_resolves_findings_that_disappeared():
    doc = make_doc("a", "nic", dt.date(2026, 10, 1))
    first = run([(doc, out())])
    gone = first[0]
    second = [f for f in first if f.id != gone.id]
    merged = by_id(reconcile_findings(first, second, NOW))
    assert merged[gone.id].resolved and merged[gone.id].resolution.by == "ai"
    assert not merged[second[0].id].resolved


def test_analyse_case_runs_the_whole_pipeline():
    doc = make_doc("a", "AA: neguje", dt.date(2026, 10, 1))
    gw = FakeGateway(
        {
            DocExtraction: out(claim(FieldPath.ALLERGIES, "neguje", "AA: neguje")),
            ClinicalReview: ClinicalReview(notes=[]),
        }
    )
    handover, findings, _ = analyse_case("c", [doc], gateway=gw, as_of=AS_OF, now=NOW)
    assert handover.allergies.value == "neguje"
    assert any(f.id == "required:performance_status" for f in findings)
    assert handover.validated_by_referrer is None


def test_clinical_review_field_paths_are_normalised():
    doc = make_doc("a", "Ferritin 9 µg/l.", dt.date(2026, 10, 1))
    note = ReviewNote(
        message_cs="x",
        fields=["handover.medications.value", "labs[0]", "nonsense"],
        quotes=[QuoteRef(document_id="a", quote="Ferritin 9 µg/l.")],
    )
    gw = FakeGateway(
        {
            ClinicalReview: ClinicalReview(notes=[note]),
            ReferenceMatches: ReferenceMatches(matches=[]),
        }
    )
    review = [f for f in run([(doc, out())], gw) if f.advisory]
    assert review[0].fields == ["labs", "medications"]


def test_a_finding_that_comes_back_is_open_again_after_an_automatic_resolution():
    doc = make_doc("a", "nic", dt.date(2026, 10, 1))
    first = run([(doc, out())])
    gone = first[0]
    closed = reconcile_findings(first, first[1:], NOW)
    back = by_id(reconcile_findings(closed, first, NOW))
    assert not back[gone.id].resolved and back[gone.id].resolution is None
