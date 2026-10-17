"""S4 endpoints: the coordinator's workflow after the referral (demo steps 3–8), with the KOC-scoped
permissions, state rules and audit trail. Offline: in-memory repository, no model, the app clock
from the `empty` scenario."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from onko_api.main import app
from onko_contracts import DocumentMeta, Finding, FindingKind, Severity, SuggestedAction

KOC = "koc2-lipova"
GP = {"X-Actor-Id": "pl-reznicek"}
COORDINATOR = {"X-Actor-Id": "koordinator"}
OTHER_KOC = {"X-Actor-Id": "koord-severni"}
OWNERS = {"imaging_site": "koc1-severni", "pathology": "pato-pokorny",
          "pain_clinic": "koc1-severni", "psycho_oncology": "psycholog-vesela"}

F09 = Finding(id="F09", kind=FindingKind.UNATTACHED_REFERENCE, severity=Severity.WARNING,
              message_cs="07 uvádí 5 vyšetření bez výsledků", suggested_action=SuggestedAction.REQUEST)
F01 = Finding(id="F01", kind=FindingKind.MISSING, severity=Severity.BLOCKER, fields=["performance_status"],
              message_cs="Chybí ECOG", suggested_action=SuggestedAction.FILL_IN)
F04 = Finding(id="F04", kind=FindingKind.IDENTITY, severity=Severity.BLOCKER, message_cs="RČ nesedí",
              overridable=False)


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.post("/demo/reset", json={"scenario": "empty"})
        c.put("/demo/clock", json={"now": "2026-10-02T15:00:00"})
        yield c


def _sent_case(client) -> str:
    """A referral the GP has validated and sent, with the findings extraction would leave."""
    case_id = client.post("/referrals", json={"koc_id": KOC}, headers=GP).json()["id"]
    client.post(f"/cases/{case_id}/handover/validate", headers=GP)
    assert client.post(f"/cases/{case_id}/send", headers=GP).status_code == 200
    client.app.state.repo.save_findings(case_id, [F09, F01, F04])
    return case_id


def _taken_case(client) -> str:
    case_id = _sent_case(client)
    assert client.post(f"/cases/{case_id}/take-over", headers=COORDINATOR).status_code == 200
    return case_id


def _case(client, case_id: str) -> dict:
    return client.get(f"/cases/{case_id}").json()


def test_coordinator_runs_the_case_from_take_over_to_complete(client):
    case_id = _sent_case(client)

    # Step 3: take over.
    r = client.post(f"/cases/{case_id}/take-over", headers=COORDINATOR)
    assert r.status_code == 200
    taken = r.json()
    assert (taken["state"], taken["coordinator_id"], taken["on_move"]) == ("v_triage", "koordinator", "koordinator")
    assert taken["queue"] == "novy" and taken["next_step"] is None

    # Step 4: 'Vyžádat' on F09, addressed to the GP.
    r = client.post(f"/cases/{case_id}/findings/F09/request", headers=COORDINATOR, json={
        "owner_id": "pl-reznicek", "due": "2026-10-03T12:00:00", "note": "zprávy 01–06"})
    assert r.status_code == 201
    request = r.json()
    assert (request["kind"], request["finding_id"], request["owner"]) == ("request_documents", "F09", "pl-reznicek")
    assert request["title"] == "Vyžádat: 07 uvádí 5 vyšetření bez výsledků"
    assert request["external"] is True  # the GP's practice is outside the KOC
    case = _case(client, case_id)
    assert (case["on_move"], case["next_step"], case["state"]) == ("pl-reznicek", request["title"], "v_triage")
    assert client.get(f"/cases/{case_id}/findings").json()[0]["resolved"] is False

    r = client.post(f"/cases/{case_id}/transition", headers=COORDINATOR,
                    json={"to": "ceka_na_podklady", "note": "čekáme na 01–06"})
    assert r.status_code == 200 and r.json()["queue"] == "aktivni"

    # Step 5: the reports arrived; the request task is done.
    r = client.patch(f"/tasks/{request['id']}", headers=COORDINATOR, json={"status": "done"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    assert _case(client, case_id)["on_move"] == "koordinator"

    # Step 6: start the pancreatic-cancer task set, found by the diagnosis code.
    sets = client.get("/task-sets", params={"diagnosis_code": "C25.0"}).json()
    assert [s["id"] for s in sets] == ["ca-pankreas"]
    assert client.get("/task-sets", params={"diagnosis_code": "C18"}).json() == []
    r = client.post(f"/cases/{case_id}/task-sets/start", headers=COORDINATOR,
                    json={"task_set_id": "ca-pankreas", "owners": OWNERS})
    assert r.status_code == 201
    tasks = {t["id"].rsplit("-", 1)[-1]: t for t in r.json()}
    assert len(tasks) == 7
    assert tasks["ct"]["owner"] == "koc1-severni" and tasks["ct"]["external"] is True
    assert tasks["lab"]["owner"] == "koordinator" and tasks["lab"]["external"] is False
    assert tasks["psych"]["external"] is False
    assert tasks["eus"]["depends_on"] == [tasks["ct"]["id"]]
    case = _case(client, case_id)
    assert (case["on_move"], case["next_step"]) == ("koc1-severni", tasks["ct"]["title"])
    again = client.post(f"/cases/{case_id}/task-sets/start", headers=COORDINATOR,
                        json={"task_set_id": "ca-pankreas", "owners": OWNERS})
    assert again.status_code == 409

    # Step 7: on hold while waiting for the CT slot, then resume once booked.
    r = client.put(f"/cases/{case_id}/hold", headers=COORDINATOR,
                   json={"reason": "čeká na termín CT v KOC 1", "until": "2026-10-08"})
    assert r.status_code == 200
    assert r.json()["queue"] == "odlozeny" and r.json()["on_hold"]["set_by"] == "koordinator"
    r = client.patch(f"/tasks/{tasks['ct']['id']}", headers=COORDINATOR,
                     json={"status": "booked", "due": "2026-10-08T09:00:00", "location": "KOC 1, CT"})
    assert r.status_code == 200 and r.json()["location"] == "KOC 1, CT"
    r = client.delete(f"/cases/{case_id}/hold", headers=COORDINATOR)
    assert r.status_code == 200 and r.json()["queue"] == "aktivni" and r.json()["on_hold"] is None
    assert client.delete(f"/cases/{case_id}/hold", headers=COORDINATOR).status_code == 200  # no-op

    # ECOG stays missing: overridden with a note.
    assert client.post(f"/cases/{case_id}/findings/F01/resolve", headers=COORDINATOR,
                       json={"kind": "overridden"}).status_code == 422
    r = client.post(f"/cases/{case_id}/findings/F01/resolve", headers=COORDINATOR,
                    json={"kind": "overridden", "note": "ECOG nelze doložit"})
    assert r.status_code == 200
    assert r.json()["resolved"] is True and r.json()["resolution"]["by"] == "koordinator"
    assert client.get(f"/cases/{case_id}/findings").json()[1]["resolution"]["kind"] == "overridden"

    r = client.post(f"/cases/{case_id}/transition", headers=COORDINATOR, json={"to": "kompletni"})
    assert r.status_code == 200 and r.json()["state"] == "kompletni"

    actions = [e["action"] for e in client.get(f"/cases/{case_id}/audit").json()]
    assert actions == [
        "referral_created", "handover_validated", "referral_sent", "case_taken_over",
        "finding_requested", "case_transitioned", "task_updated", "task_set_started", "hold_set",
        "task_updated", "hold_cleared", "finding_resolved", "case_transitioned",
    ]
    audit = client.get(f"/cases/{case_id}/audit").json()
    # Czech labels and values, ids shown by name (api.md › Audit).
    assert [e["detail"] for e in audit] == [
        "KOC Nemocnice Lipová",
        None,
        "Koncept → Odesláno",
        "Odesláno → V triage",
        "„07 uvádí 5 vyšetření bez výsledků“ → MUDr. Tomáš Řezníček: zprávy 01–06",
        "V triage → Čeká na podklady: čekáme na 01–06",
        "Vyžádat: 07 uvádí 5 vyšetření bez výsledků: Stav: Dokončeno",
        "Karcinom pankreatu – diagnostika do MDT",
        "čeká na termín CT v KOC 1 (obnovit od 8. 10. 2026)",
        ("CT břicha a hrudníku, pankreatický protokol (KOC 1): Stav: Objednáno, Místo: KOC 1, CT, "
         "Termín: 8. 10. 2026 9:00"),
        "čeká na termín CT v KOC 1",
        "„Chybí ECOG“: Překonáno s poznámkou: ECOG nelze doložit",
        "Čeká na podklady → Kompletní",
    ]


def test_transition_takes_only_the_coordinators_own_moves(client):
    case_id = _taken_case(client)
    for to in ("vraceno_lekari", "pripraveno_k_mdt", "odeslano", "uzavreno"):
        r = client.post(f"/cases/{case_id}/transition", headers=COORDINATOR, json={"to": to})
        assert r.status_code == 409, to
    assert client.post(f"/cases/{case_id}/take-over", headers=COORDINATOR).status_code == 409


def test_only_a_coordinator_of_the_cases_koc_works_on_it(client):
    case_id = _sent_case(client)
    for headers in (OTHER_KOC, GP):
        assert client.post(f"/cases/{case_id}/take-over", headers=headers).status_code == 403
    client.post(f"/cases/{case_id}/take-over", headers=COORDINATOR)
    writes = [
        ("patch", f"/cases/{case_id}", {"priority": "high"}),
        ("post", f"/cases/{case_id}/transition", {"to": "kompletni"}),
        ("post", f"/cases/{case_id}/return", {"note": "x"}),
        ("put", f"/cases/{case_id}/hold", {"reason": "x"}),
        ("patch", f"/cases/{case_id}/milestones", {"symptom_onset": "2026-08-15"}),
        ("post", f"/cases/{case_id}/findings/F01/resolve", {"kind": "dismissed"}),
        ("post", f"/cases/{case_id}/findings/F09/request", {"owner_id": "pl-reznicek"}),
        ("post", f"/cases/{case_id}/tasks", {"title": "CT", "kind": "imaging", "owner_id": "koordinator"}),
        ("post", f"/cases/{case_id}/task-sets/start", {"task_set_id": "ca-pankreas", "owners": OWNERS}),
        # S3 handover edits by a coordinator are KOC-scoped too.
        ("patch", f"/cases/{case_id}/handover", {"path": "allergies", "value": "PNC"}),
        ("post", f"/cases/{case_id}/handover/examinations",
         {"date": "2026-10-01", "place": "X", "type": "UZ", "result_full_text": "…"}),
    ]
    for method, url, body in writes:
        assert client.request(method, url, json=body, headers=OTHER_KOC).status_code == 403, url
    assert client.post(f"/cases/{case_id}/extract", headers=OTHER_KOC).status_code == 403
    files = {"file": ("x.pdf", b"%PDF", "application/pdf")}
    assert client.post(f"/cases/{case_id}/documents", files=files, headers=OTHER_KOC).status_code == 403
    assert client.patch(f"/cases/{case_id}/handover", headers=COORDINATOR,
                        json={"path": "allergies", "value": "PNC"}).status_code == 200


def test_document_corrections_are_koc_scoped_and_audited(client):
    case_id = _taken_case(client)
    client.app.state.repo.save_document(DocumentMeta(id="doc-1", case_id=case_id, filename="01.docx"),
                                        b"", "text")
    body = {"document_date": "2026-09-01"}
    assert client.patch("/documents/doc-1", headers=OTHER_KOC, json=body).status_code == 403
    assert client.patch("/documents/doc-1", headers=COORDINATOR, json=body).status_code == 200
    assert client.patch("/documents/doc-1", headers=GP, json=body).status_code == 200
    events = [e for e in client.get(f"/cases/{case_id}/audit").json() if e["action"] == "document_updated"]
    assert [e["detail"] for e in events] == ["01.docx: Datum dokumentu: 1. 9. 2026"] * 2


def test_return_notifies_the_gp_and_the_resend_comes_back_to_triage(client):
    case_id = _taken_case(client)
    r = client.post(f"/cases/{case_id}/return", headers=COORDINATOR, json={"note": "x", "finding_id": "nope"})
    assert r.status_code == 400

    r = client.post(f"/cases/{case_id}/return", headers=COORDINATOR,
                    json={"note": "Doplňte prosím ECOG.", "finding_id": "F01"})
    assert r.status_code == 200
    returned = r.json()
    assert (returned["state"], returned["on_move"], returned["next_step"]) == ("vraceno_lekari", "pl-reznicek", None)
    [message] = client.app.state.repo.list_messages(case_id)
    assert message.kind.value == "case_returned" and message.recipient_ids == ["pl-reznicek"]
    assert (message.body, message.finding_id, message.sender_id) == ("Doplňte prosím ECOG.", "F01", "koordinator")
    assert message.sent_at is not None
    # Tasks and holds wait while the GP has the case.
    assert client.put(f"/cases/{case_id}/hold", headers=COORDINATOR, json={"reason": "x"}).status_code == 409

    client.put("/demo/clock", json={"now": "2026-10-03T10:00:00"})
    client.post(f"/cases/{case_id}/handover/validate", headers=GP)
    r = client.post(f"/cases/{case_id}/send", headers=GP)
    assert r.status_code == 200
    assert (r.json()["state"], r.json()["on_move"]) == ("v_triage", "koordinator")
    assert client.post(f"/cases/{case_id}/return", headers=COORDINATOR,
                       json={"note": "znovu"}).status_code == 200


def test_hold_and_tasks_wait_for_the_take_over(client):
    case_id = _sent_case(client)
    assert client.put(f"/cases/{case_id}/hold", headers=COORDINATOR, json={"reason": "x"}).status_code == 409
    r = client.post(f"/cases/{case_id}/tasks", headers=COORDINATOR,
                    json={"title": "CT", "kind": "imaging", "owner_id": "koordinator"})
    assert r.status_code == 409
    assert client.post(f"/cases/{case_id}/findings/F09/request", headers=COORDINATOR,
                       json={"owner_id": "pl-reznicek"}).status_code == 409


def test_case_details_and_time_to_treatment(client):
    case_id = _taken_case(client)
    url = f"/cases/{case_id}"
    r = client.patch(url, headers=COORDINATOR,
                     json={"priority": "high", "mdt_board_id": "mdt-git-lipova", "mdt_date": "2026-10-21"})
    assert r.status_code == 200
    assert (r.json()["priority"], r.json()["mdt_board_id"], r.json()["mdt_date"]) == (
        "high", "mdt-git-lipova", "2026-10-21")
    assert client.patch(url, headers=COORDINATOR, json={"mdt_board_id": "mdt-hpb-severni"}).status_code == 400
    assert client.patch(url, headers=COORDINATOR, json={"coordinator_id": "koord-severni"}).status_code == 400
    assert client.patch(url, headers=COORDINATOR, json={"coordinator_id": None}).status_code == 400
    assert client.patch(url, headers=COORDINATOR, json={"priority": None}).status_code == 422
    r = client.patch(url, headers=COORDINATOR, json={"mdt_date": None})
    assert r.json()["mdt_date"] is None and r.json()["priority"] == "high"

    r = client.patch(f"{url}/milestones", headers=COORDINATOR, json={"symptom_onset": "2026-08-15"})
    assert r.status_code == 200 and r.json()["milestones"]["symptom_onset"] == "2026-08-15"
    ttt = client.get(f"{url}/time-to-treatment").json()
    assert (ttt["t1"], ttt["t2"], ttt["total"]) == (48, None, None)
    details = [e["detail"] for e in client.get(f"{url}/audit").json()
               if e["action"] in ("case_updated", "milestones_updated")]
    assert details == [
        "Priorita: Vysoká, MDT tým: MDT pro nádory GIT, Plánované MDT: 21. 10. 2026",
        "Plánované MDT: neuvedeno",
        "Začátek obtíží: 15. 8. 2026",
    ]
    assert client.get("/cases/nope/time-to-treatment").status_code == 404
    assert client.get("/cases/nope/audit").status_code == 404


def test_findings_are_found_and_overridden_only_when_allowed(client):
    case_id = _taken_case(client)
    assert client.post(f"/cases/{case_id}/findings/nope/resolve", headers=COORDINATOR,
                       json={"kind": "resolved"}).status_code == 404
    assert client.post(f"/cases/{case_id}/findings/F04/resolve", headers=COORDINATOR,
                       json={"kind": "overridden", "note": "ověřeno"}).status_code == 409
    r = client.post(f"/cases/{case_id}/findings/F04/resolve", headers=COORDINATOR,
                    json={"kind": "resolved", "note": "RČ opraveno"})
    assert r.status_code == 200 and r.json()["resolution"]["kind"] == "resolved"


def test_tasks_are_checked(client):
    case_id = _taken_case(client)
    other_id = _taken_case(client)
    url = f"/cases/{case_id}/tasks"

    def task(**body):
        return client.post(url, headers=COORDINATOR,
                           json={"title": "CT", "kind": "imaging", "owner_id": "koordinator", **body})

    assert task(owner_id="nobody").status_code == 400
    assert task(depends_on=["nope"]).status_code == 400
    first = task(due="2026-10-05T10:00:00").json()
    second = task(title="EUS", depends_on=[first["id"]]).json()
    assert second["depends_on"] == [first["id"]] and second["external"] is False
    assert task(owner_id="koc1-severni").json()["external"] is True
    assert task(owner_id="koc1-severni", external=False).json()["external"] is False

    patch = client.patch
    assert patch(f"/tasks/{first['id']}", headers=COORDINATOR, json={"depends_on": [second["id"]]}).status_code == 400
    assert patch("/tasks/nope", headers=COORDINATOR, json={"status": "done"}).status_code == 404
    assert patch(f"/tasks/{first['id']}", headers=COORDINATOR, json={"title": None}).status_code == 422
    client.app.state.repo.save_document(DocumentMeta(id="doc-other", case_id=other_id, filename="x.docx"), b"", "")
    client.app.state.repo.save_document(DocumentMeta(id="doc-ct", case_id=case_id, filename="ct.docx"), b"", "")
    assert patch(f"/tasks/{first['id']}", headers=COORDINATOR,
                 json={"result_document_id": "doc-other"}).status_code == 400
    r = patch(f"/tasks/{first['id']}", headers=COORDINATOR,
              json={"result_document_id": "doc-ct", "status": "done", "owner_id": "koc1-severni"})
    assert r.status_code == 200
    assert (r.json()["result_document_id"], r.json()["external"]) == ("doc-ct", True)
    assert _case(client, case_id)["next_step"] == "EUS"


def test_task_sets_are_user_data(client):
    steps = [{"key": "ct", "title": "CT", "kind": "imaging", "owner_role": "imaging_site"},
             {"key": "mdt", "title": "MDT", "kind": "mdt", "owner_role": "coordinator",
              "depends_on": ["ct"]}]
    body = {"name": "Kolorektum", "diagnosis_codes": ["C18"], "steps": steps}
    assert client.post("/task-sets", headers=GP, json=body).status_code == 403
    assert client.post("/task-sets", headers=COORDINATOR,
                       json={**body, "steps": [steps[0], steps[0]]}).status_code == 400
    assert client.post("/task-sets", headers=COORDINATOR,
                       json={**body, "steps": [steps[1]]}).status_code == 400

    r = client.post("/task-sets", headers=COORDINATOR, json=body)
    assert r.status_code == 201
    created = r.json()
    assert created["created_by"] == "koordinator"
    r = client.put(f"/task-sets/{created['id']}", headers=OTHER_KOC, json={**body, "name": "Tlusté střevo"})
    assert r.status_code == 200 and r.json()["name"] == "Tlusté střevo" and r.json()["created_by"] == "koordinator"
    assert client.put("/task-sets/nope", headers=COORDINATOR, json=body).status_code == 404
    assert [s["id"] for s in client.get("/task-sets").json()] == ["ca-pankreas", created["id"]]

    # A role without an owner is refused; the coordinator role defaults to the case's coordinator.
    case_id = _taken_case(client)
    start = f"/cases/{case_id}/task-sets/start"
    assert client.post(start, headers=COORDINATOR, json={"task_set_id": created["id"]}).status_code == 400
    assert client.post(start, headers=COORDINATOR, json={"task_set_id": "nope"}).status_code == 404
    assert client.post(start, headers=COORDINATOR, json={"task_set_id": created["id"],
                                                         "owners": {"imaging_site": "nobody"}}).status_code == 400
    r = client.post(start, headers=COORDINATOR, json={
        "task_set_id": created["id"], "owners": {"imaging_site": "rdg-fiala"}, "start": "2026-10-05T08:00:00"})
    assert r.status_code == 201
    assert [(t["owner"], t["external"]) for t in r.json()] == [("rdg-fiala", True), ("koordinator", False)]


def test_notifications_list_owned_and_coordinated_tasks_due_soon(client):
    case_id = _taken_case(client)
    client.post(f"/cases/{case_id}/findings/F09/request", headers=COORDINATOR,
                json={"owner_id": "pl-reznicek", "due": "2026-10-03T12:00:00"})
    client.post(f"/cases/{case_id}/tasks", headers=COORDINATOR,
                json={"title": "CT", "kind": "imaging", "owner_id": "koc1-severni", "due": "2026-10-20T08:00:00"})
    client.post(f"/cases/{case_id}/tasks", headers=COORDINATOR,
                json={"title": "Odběry", "kind": "lab", "owner_id": "koordinator", "due": "2026-10-01T08:00:00"})

    mine = client.get("/notifications", headers=COORDINATOR).json()
    assert [(n["title"], n["overdue"]) for n in mine] == [
        ("Odběry", True), ("Vyžádat: 07 uvádí 5 vyšetření bez výsledků", False)]
    gp = client.get("/notifications", headers=GP).json()
    assert [n["title"] for n in gp] == ["Vyžádat: 07 uvádí 5 vyšetření bez výsledků"]
    # KOC 1 owns the CT as an organisation; its coordinator sees it once it is due soon.
    assert client.get("/notifications", headers=OTHER_KOC).json() == []
    soon = client.get("/notifications", headers=OTHER_KOC, params={"within_days": 30}).json()
    assert [n["title"] for n in soon] == ["CT"]


def test_every_scenario_has_the_starter_task_set(client):
    assert [s["id"] for s in client.get("/task-sets").json()] == ["ca-pankreas"]
    client.post("/demo/reset", json={"scenario": "reference_at_mdt"})
    assert [s["id"] for s in client.get("/task-sets").json()] == ["ca-pankreas"]
