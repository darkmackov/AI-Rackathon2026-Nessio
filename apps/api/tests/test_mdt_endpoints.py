"""S5 endpoints: the MDT input, record and conclusion (demo steps 9, 11, 12) on the seeded reference
case, with the KOC-scoped permissions, state rules and audit trail. Offline: in-memory repository,
a fake model, jobs run inline."""

from __future__ import annotations

import pytest
from api_testkit import FakeGateway
from fastapi.testclient import TestClient
from onko_ai import ResultLine, ResultLines
from onko_api.jobs import ImmediateExecutor
from onko_api.main import app
from onko_contracts import CaseState, MdtRecord, Stamp
from onko_documents import parse, render_mdt_record

CASE = "vzp-prochazkova"
BOARD = "mdt-git-lipova"
GP = {"X-Actor-Id": "pl-reznicek"}
COORDINATOR = {"X-Actor-Id": "koordinator"}
OTHER_KOC = {"X-Actor-Id": "koord-severni"}
SNAPSHOT = {"board_id": BOARD, "mdt_date": "2026-10-21"}
CONCLUSION = {
    "presented_by": "MUDr. Martin Svoboda",
    "diagnosis_name": "Duktální adenokarcinom hlavy pankreatu",
    "diagnosis_code": "C25.0",
    "clinical_assessment": "Hraničně resekabilní nález.",
    "conclusion": "Neoadjuvantní chemoterapie a restaging.",
    "recommendations": ["Onkologické konzilium", "Kontrolní CT po léčbě"],
    "place": "Praha 4",
    "date": "2026-10-21",
    "chair": "doc. MUDr. Pavel Hrubý, Ph.D.",
    "copy_to": ["MUDr. Tomáš Řezníček"],
}


class DraftGateway(FakeGateway):
    """The API fake, plus answers for the drafts."""

    def complete(self, messages, schema=None, *, slot=None):
        if schema is None:
            system = messages[0]["content"]
            return "AI epikríza." if "epikríza for the MDT" in system else "AI otázka pro MDT?"
        if schema is ResultLines:
            return ResultLines(lines=[ResultLine(index=0, result="Jedna řádka.")])
        return super().complete(messages, schema, slot=slot)


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/demo/reset", json={"scenario": "reference_at_mdt"})
        c.app.state.gateway = DraftGateway()
        c.app.state.jobs = ImmediateExecutor()
        yield c


def _repo(client):
    return client.app.state.repo


def _clear_blockers(client) -> None:
    """Demo step 9: the missing ECOG, the one open blocker, is overridden with a note (Q-C2)."""
    assert client.post(f"/cases/{CASE}/findings/F01/resolve", headers=COORDINATOR,
                       json={"kind": "overridden", "note": "ECOG neuveden, MDT rozhodne"}).status_code == 200


def _snapshot(client) -> dict:
    _clear_blockers(client)
    r = client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT)
    assert r.status_code == 201, r.text
    return r.json()


def _draft(client, kind: str) -> dict:
    r = client.post(f"/cases/{CASE}/drafts", headers=COORDINATOR, json={"kind": kind})
    assert r.status_code == 202, r.text
    assert (r.json()["kind"], r.json()["params"]) == ("draft", {"kind": kind})
    return client.get(f"/jobs/{r.json()['id']}").json()


def _state(client) -> str:
    return client.get(f"/cases/{CASE}").json()["state"]


def test_mdt_from_the_input_to_the_confirmed_conclusion(client):
    # Step 9: blockers stop the MDT input until they are resolved or overridden.
    r = client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT)
    assert r.status_code == 409
    assert r.json()["detail"] == "unresolved blockers: F01"
    assert _state(client) == "kompletni"

    # Step 9: AI drafts of what the MDT gets; the coordinator applies the question as her own.
    epicrisis = _draft(client, "epicrisis_summary")
    assert (epicrisis["status"], epicrisis["result"]) == ("done", {"text": "AI epikríza."})
    question = _draft(client, "mdt_question")["result"]["text"]
    assert client.patch(f"/cases/{CASE}/handover", headers=COORDINATOR,
                        json={"path": "mdt_question", "value": question}).status_code == 200
    for kind in ("mdt_results", "mdt_conclusion"):  # these need the MDT record
        r = client.post(f"/cases/{CASE}/drafts", headers=COORDINATOR, json={"kind": kind})
        assert r.status_code == 409
    assert client.get(f"/cases/{CASE}/mdt/record").status_code == 404

    # Step 11: 'Připravit podklad pro MDT'.
    record = _snapshot(client)
    board = client.get(f"/mdt-boards/{BOARD}").json()
    handover = client.get(f"/cases/{CASE}/handover").json()
    assert record["mdt_date"] == "2026-10-21"
    assert record["members"] == board["members"]
    assert record["patient_name"] == "Alena Procházková"
    assert record["referring_doctor_name"] == "MUDr. Tomáš Řezníček"
    assert record["referring_doctor_phone"] == "+420 311 000 287"
    assert record["diagnosis_code"] == handover["diagnosis_code"]["value"]
    assert record["mdt_question"] == "AI otázka pro MDT?"
    assert len(record["results"]) == len(handover["examinations"]) + len(handover["labs"])
    assert record["created"]["by"] == "koordinator"

    case = client.get(f"/cases/{CASE}").json()
    assert (case["state"], case["mdt_board_id"], case["mdt_date"]) == ("pripraveno_k_mdt", BOARD, "2026-10-21")
    snapshot = client.get(f"/cases/{CASE}/handover", params={"snapshot": True}).json()
    assert snapshot["as_of"] == "2026-10-21"
    assert snapshot["confirmed_by_coordinator"]["by"] == "koordinator"
    assert client.get(f"/cases/{CASE}/mdt/record").json() == record

    pdf = client.get(f"/cases/{CASE}/mdt/record.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert "Alena Procházková" in parse(pdf.content, "application/pdf")

    # The AI one-liners for the results table, applied to the record.
    rows = _draft(client, "mdt_results")["result"]["rows"]
    assert len(rows) == len(record["results"])
    assert rows[0]["result"] == "Jedna řádka."
    assert rows[1] == record["results"][1]  # the model left it out: full text stays
    r = client.patch(f"/cases/{CASE}/mdt/record", headers=COORDINATOR, json={"results": rows})
    assert r.status_code == 200 and r.json()["results"] == rows

    # Step 12: the conclusion prefill restates the record, the decision is the coordinator's input.
    fields = _draft(client, "mdt_conclusion")["result"]["fields"]
    assert fields == {
        "diagnosis_name": record["diagnosis_name"],
        "diagnosis_code": record["diagnosis_code"],
        "date": "2026-10-21",
        "place": "Praha 4",
        "copy_to": ["MUDr. Tomáš Řezníček, Na Návsi 3, 252 41 Dolní Břežany"],
    }
    r = client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json=CONCLUSION)
    assert r.status_code == 200
    assert (r.json()["source"], r.json()["confirmed"]) == ("written", None)
    assert _state(client) == "pripraveno_k_mdt"

    r = client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR)
    assert r.status_code == 200
    assert r.json()["confirmed"]["by"] == "koordinator"
    case = client.get(f"/cases/{CASE}").json()
    assert case["state"] == "zaver_mdt"
    assert case["milestones"]["mdt_held"] == "2026-10-21"
    assert client.get(f"/cases/{CASE}/time-to-treatment").json()["t2"] == 19  # 2. 10. → 21. 10.
    code = client.get(f"/cases/{CASE}/handover").json()["diagnosis_code"]
    assert (code["value"], code["origin"], code["entered"]["by"]) == ("C25.0", "manual", "koordinator")
    findings = {f["id"]: f for f in client.get(f"/cases/{CASE}/findings").json()}
    assert findings["F05"]["resolved"] is False  # resolving the provisional code is explicit (Q-F36)

    text = parse(client.get(f"/cases/{CASE}/mdt/conclusion.pdf").content, "application/pdf")
    assert "Neoadjuvantní chemoterapie" in text and "Nemocnice Lipová" in text
    record_text = parse(client.get(f"/cases/{CASE}/mdt/record.pdf").content, "application/pdf")
    assert "Neoadjuvantní chemoterapie" in record_text  # sections 6–7 from the confirmed conclusion

    # The record is the MDT's input: closed after the meeting.
    r = client.patch(f"/cases/{CASE}/mdt/record", headers=COORDINATOR, json={"mdt_question": "x"})
    assert r.status_code == 409

    # A correction drops the confirmation; it is confirmed again without a state change.
    r = client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR,
                   json={**CONCLUSION, "conclusion": "Opravený závěr."})
    assert r.json()["confirmed"] is None
    assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR).status_code == 200
    assert _state(client) == "zaver_mdt"

    actions = [e["action"] for e in client.get(f"/cases/{CASE}/audit").json()]
    for action in ("mdt_snapshot_created", "mdt_record_updated", "mdt_conclusion_saved",
                   "mdt_conclusion_confirmed"):
        assert action in actions
    confirmed = [e for e in client.get(f"/cases/{CASE}/audit").json()
                 if e["action"] == "mdt_conclusion_confirmed"]
    assert confirmed[0]["detail"] == "pripraveno_k_mdt → zaver_mdt, definitivní kód C25.0"


def test_reports_after_the_mdt_never_change_the_record(client):
    record = _snapshot(client)
    snapshot = client.get(f"/cases/{CASE}/handover", params={"snapshot": True}).json()

    # Step 15: a report arriving after the MDT updates the live case only.
    files = {"file": ("12.pdf", render_mdt_record(MdtRecord.model_validate(record)), "application/pdf")}
    r = client.post(f"/cases/{CASE}/documents", headers=COORDINATOR, files=files,
                    data={"received_at": "2026-10-26T10:00:00"})
    assert r.status_code == 201
    assert client.get(f"/jobs/{r.json()['job']['id']}").json()["status"] == "done"

    assert client.get(f"/cases/{CASE}/mdt/record").json() == record
    assert client.get(f"/cases/{CASE}/handover", params={"snapshot": True}).json() == snapshot


def test_the_snapshot_refuses_a_handover_that_uses_a_later_document(client):
    _clear_blockers(client)
    repo = _repo(client)
    ct = repo.get_document("08")
    repo.update_document(ct.model_copy(update={"received_at": ct.received_at.replace(month=11)}))

    r = client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT)
    assert r.status_code == 409
    assert "08" in r.json()["detail"]
    assert client.get(f"/cases/{CASE}/mdt/record").status_code == 404


def test_snapshot_rules(client):
    _clear_blockers(client)
    assert client.post(f"/cases/{CASE}/mdt/snapshot", headers=GP, json=SNAPSHOT).status_code == 403
    assert client.post(f"/cases/{CASE}/mdt/snapshot", headers=OTHER_KOC, json=SNAPSHOT).status_code == 403
    r = client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR,
                    json={**SNAPSHOT, "board_id": "nope"})
    assert r.status_code == 400
    other_board = next(b["id"] for b in client.get("/mdt-boards").json() if b["organization_id"] != "koc2-lipova")
    r = client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR,
                    json={**SNAPSHOT, "board_id": other_board})
    assert r.status_code == 400
    assert client.post("/cases/nope/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT).status_code == 404

    assert client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT).status_code == 201
    r = client.post(f"/cases/{CASE}/mdt/snapshot", headers=COORDINATOR, json=SNAPSHOT)
    assert r.status_code == 409  # already prepared


def test_reads_answer_404_for_an_unknown_case_or_a_missing_record(client):
    for path in ("mdt/record", "mdt/record.pdf", "mdt/conclusion", "mdt/conclusion.pdf"):
        assert client.get(f"/cases/nope/{path}").json()["detail"] == "case not found"
    assert client.get(f"/cases/{CASE}/mdt/record").json()["detail"] == "no MDT record yet"
    assert client.get(f"/cases/{CASE}/mdt/record.pdf").status_code == 404
    assert client.get(f"/cases/{CASE}/mdt/conclusion").json()["detail"] == "no MDT conclusion yet"
    assert client.get(f"/cases/{CASE}/mdt/conclusion.pdf").status_code == 404
    assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR).status_code == 404


def test_writes_are_for_a_coordinator_of_the_case_koc(client):
    _snapshot(client)
    for headers in (GP, OTHER_KOC):
        assert client.patch(f"/cases/{CASE}/mdt/record", headers=headers, json={}).status_code == 403
        assert client.put(f"/cases/{CASE}/mdt/conclusion", headers=headers, json=CONCLUSION).status_code == 403
        assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=headers).status_code == 403
        assert client.post(f"/cases/{CASE}/drafts", headers=headers,
                           json={"kind": "mdt_question"}).status_code == 403
        files = {"file": ("zaver.pdf", b"%PDF", "application/pdf")}
        assert client.post(f"/cases/{CASE}/mdt/conclusion/upload", headers=headers,
                           files=files).status_code == 403


def test_uploaded_mdt_report_is_the_conclusion(client):
    report = render_mdt_record(MdtRecord(case_id=CASE, mdt_date="2026-10-21", board_id=BOARD, members=[],
                                         patient_name="Závěr MDT", created=Stamp(by="k", at="2026-10-21T15:00")))
    files = {"file": ("zaver-mdt.pdf", report, "application/pdf")}

    r = client.post(f"/cases/{CASE}/mdt/conclusion/upload", headers=COORDINATOR, files=files)
    assert r.status_code == 409  # not before the MDT input is prepared
    assert len(client.get(f"/cases/{CASE}/documents").json()) == 11  # nothing stored

    _snapshot(client)
    r = client.post(f"/cases/{CASE}/mdt/conclusion/upload", headers=COORDINATOR, files=files)
    assert r.status_code == 201
    document = r.json()["document"]
    conclusion = client.get(f"/cases/{CASE}/mdt/conclusion").json()
    assert (conclusion["source"], conclusion["document_id"]) == ("uploaded", document["id"])
    assert client.get(f"/jobs/{r.json()['job']['id']}").json()["status"] == "done"

    # The definitive code typed in from the report; the report stays the source.
    r = client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR,
                   json={"diagnosis_code": "C25.0"})
    assert (r.json()["source"], r.json()["document_id"], r.json()["diagnosis_code"]) == (
        "uploaded", document["id"], "C25.0")
    assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR).status_code == 200
    assert _state(client) == "zaver_mdt"

    pdf = client.get(f"/cases/{CASE}/mdt/conclusion.pdf")
    assert pdf.content == report  # the MDT's own PDF, as uploaded
    assert "mdt_conclusion_uploaded" in [e["action"] for e in client.get(f"/cases/{CASE}/audit").json()]


def test_a_written_conclusion_needs_its_text_to_be_confirmed(client):
    _snapshot(client)
    client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json={"diagnosis_code": "C25.0"})
    r = client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR)
    assert r.status_code == 409
    assert _state(client) == "pripraveno_k_mdt"


def test_conclusion_is_locked_before_the_input_and_after_the_feedback(client):
    assert client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR,
                      json=CONCLUSION).status_code == 409  # kompletni: no MDT yet
    _snapshot(client)
    client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json=CONCLUSION)
    client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR)

    repo = _repo(client)  # sending the feedback is S6; set the state it leaves behind
    repo.save_case(repo.get_case(CASE).model_copy(update={"state": CaseState.FEEDBACK_SENT}))
    assert client.put(f"/cases/{CASE}/mdt/conclusion", headers=COORDINATOR, json=CONCLUSION).status_code == 409
    assert client.post(f"/cases/{CASE}/mdt/conclusion/confirm", headers=COORDINATOR).status_code == 409
    files = {"file": ("zaver.pdf", b"%PDF", "application/pdf")}
    assert client.post(f"/cases/{CASE}/mdt/conclusion/upload", headers=COORDINATOR,
                       files=files).status_code == 409


def test_drafts_need_a_model_except_the_conclusion_prefill(client):
    _snapshot(client)
    client.app.state.gateway = None
    failed = _draft(client, "epicrisis_summary")
    assert failed["status"] == "failed"
    assert "jazykový model" in failed["error"]
    prefill = _draft(client, "mdt_conclusion")
    assert prefill["status"] == "done" and prefill["result"]["fields"]["date"] == "2026-10-21"


def test_board_roster_is_edited_by_its_koc_and_records_keep_theirs(client):
    record = _snapshot(client)
    members = [{"name": "MUDr. Nový Člen", "specialty": "radiologie", "actor_id": None}]

    assert client.put(f"/mdt-boards/{BOARD}/members", headers=GP, json={"members": members}).status_code == 403
    assert client.put(f"/mdt-boards/{BOARD}/members", headers=OTHER_KOC,
                      json={"members": members}).status_code == 403
    assert client.put("/mdt-boards/nope/members", headers=COORDINATOR, json={"members": members}).status_code == 404

    r = client.put(f"/mdt-boards/{BOARD}/members", headers=COORDINATOR, json={"members": members})
    assert r.status_code == 200 and r.json()["members"] == members
    assert client.get(f"/mdt-boards/{BOARD}").json()["members"] == members
    assert client.get(f"/cases/{CASE}/mdt/record").json()["members"] == record["members"]
