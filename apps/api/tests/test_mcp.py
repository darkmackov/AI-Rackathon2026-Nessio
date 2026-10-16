"""The read-only MCP server (S10): every tool over streamable HTTP against the in-memory fake."""

from __future__ import annotations

from typing import Any

from api_testkit import FakeGateway
from fastapi.testclient import TestClient
from onko_api.main import app
from onko_api.serve import app as served_app

COORDINATOR = "koordinator"
CASE = "vzp-prochazkova"


def call(
    client: TestClient, method: str, params: dict[str, Any], actor_id: str | None = COORDINATOR,
    path: str = "/mcp",
) -> dict[str, Any]:
    headers = {"Accept": "application/json, text/event-stream"}
    if actor_id is not None:
        headers["X-Actor-Id"] = actor_id
    response = client.post(
        path, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, headers=headers
    )
    assert response.status_code == 200
    return response.json()["result"]


def tool(client: TestClient, name: str, actor_id: str | None = COORDINATOR, **arguments: Any):
    result = call(client, "tools/call", {"name": name, "arguments": arguments}, actor_id)
    assert not result["isError"], result["content"]
    return result["structuredContent"]


def tool_error(client: TestClient, name: str, actor_id: str | None = COORDINATOR, **arguments):
    result = call(client, "tools/call", {"name": name, "arguments": arguments}, actor_id)
    assert result["isError"]
    return result["content"][0]["text"]


def test_mcp_lists_only_read_only_tools():
    with TestClient(app) as client:
        tools = call(client, "tools/list", {})["tools"]
        assert {t["name"] for t in tools} == {
            "search_cases", "get_case", "get_time_to_treatment", "case_overview", "list_findings",
            "get_handover", "ask_case",
        }
        assert all(t["annotations"]["readOnlyHint"] for t in tools)


def test_search_cases_filters_like_the_rest_endpoint():
    with TestClient(app) as client:
        assert [c["id"] for c in tool(client, "search_cases")["result"]] == [CASE]
        assert [c["id"] for c in tool(client, "search_cases", koc_id="koc2-lipova")["result"]] == [CASE]
        assert tool(client, "search_cases", koc_id="koc1-u-mostu")["result"] == []
        assert tool(client, "search_cases", state="pripraveno_k_mdt")["result"][0]["id"] == CASE
        assert tool(client, "search_cases", state="uzavreno")["result"] == []


def test_search_cases_overdue_follows_the_app_clock():
    with TestClient(app) as client:  # the reference case's next step is due 21. 10. 14:00
        client.put("/demo/clock", json={"now": "2026-10-21T09:00:00"})
        assert tool(client, "search_cases", overdue=True)["result"] == []
        client.put("/demo/clock", json={"now": "2026-10-22T09:00:00"})
        assert [c["id"] for c in tool(client, "search_cases", overdue=True)["result"]] == [CASE]


def test_get_case_returns_the_case_summary():
    with TestClient(app) as client:
        case = tool(client, "get_case", case_id=CASE)
        assert case == client.get(f"/cases/{CASE}").json()
        assert case["next_step"] == "MDT pro nádory GIT"
        assert tool_error(client, "get_case", case_id="missing") == "case not found"


def test_get_time_to_treatment_counts_the_known_parts():
    with TestClient(app) as client:
        ttt = tool(client, "get_time_to_treatment", case_id=CASE)
        assert set(ttt) == {"t1", "t2", "t3", "total"}
        assert ttt["t3"] is None and ttt["total"] is None  # treatment has not started at the MDT


def test_case_overview_combines_case_findings_and_open_tasks():
    with TestClient(app) as client:
        overview = tool(client, "case_overview", case_id=CASE)
        assert overview["case"] == client.get(f"/cases/{CASE}").json()
        assert overview["time_to_treatment"] == tool(client, "get_time_to_treatment", case_id=CASE)

        findings = client.get(f"/cases/{CASE}/findings").json()
        assert overview["findings"] == [f for f in findings if not f["resolved"]]

        tasks = client.get(f"/cases/{CASE}/tasks").json()
        open_ids = {t["id"] for t in tasks if t["status"] not in ("done", "cancelled")}
        assert {t["id"] for t in overview["open_tasks"]} == open_ids
        dues = [t["due"] for t in overview["open_tasks"] if t["due"]]
        assert dues == sorted(dues)
        assert tool_error(client, "case_overview", case_id="missing") == "case not found"


def test_findings_and_handover_match_the_rest_endpoints():
    with TestClient(app) as client:
        findings = tool(client, "list_findings", case_id=CASE)["result"]
        assert findings == client.get(f"/cases/{CASE}/findings").json()
        assert findings

        handover = tool(client, "get_handover", case_id=CASE)
        assert handover == client.get(f"/cases/{CASE}/handover").json()
        assert handover["performance_status"]["status"] == "missing"
        assert tool_error(client, "list_findings", case_id="missing") == "case not found"


def test_ask_case_answers_with_verbatim_quotes_from_the_documents():
    with TestClient(app) as client:
        client.app.state.gateway = FakeGateway()
        question = "Jaké má pacient alergie?"

        answer = tool(client, "ask_case", case_id=CASE, question=question)

        assert answer["found"] and answer["question"] == question
        for quote in answer["quotes"]:
            text = client.get(f"/documents/{quote['document_id']}/text").json()["text"]
            assert text[quote["start"]:quote["end"]] == quote["quote"] == "AA: neguje"


def test_ask_case_without_a_verbatim_quote_is_not_found():
    with TestClient(app) as client:
        client.app.state.gateway = FakeGateway(answer_quote="AA: penicilin")
        answer = tool(client, "ask_case", case_id=CASE, question="Jaké má pacient alergie?")
        assert answer == {"question": "Jaké má pacient alergie?", "found": False, "quotes": []}


def test_ask_case_without_a_model_is_a_tool_error_with_the_reason():
    with TestClient(app) as client:  # tests start without a model (conftest)
        assert "ONKO_MODELS" in tool_error(client, "ask_case", case_id=CASE, question="ECOG?")
        client.app.state.gateway = FakeGateway(can_embed=False)
        assert "ONKO_EMBED_MODEL" in tool_error(client, "ask_case", case_id=CASE, question="ECOG?")
        assert tool_error(client, "ask_case", case_id="missing", question="ECOG?") == (
            "case not found"
        )
        assert tool_error(client, "ask_case", actor_id=None, case_id=CASE, question="ECOG?") == (
            "X-Actor-Id header is required"
        )


def test_tools_use_the_same_actor_check_as_the_rest_api():
    with TestClient(app) as client:
        assert tool_error(client, "get_case", actor_id=None, case_id=CASE) == (
            "X-Actor-Id header is required"
        )
        assert tool_error(client, "get_case", actor_id="nobody", case_id=CASE) == "actor not found"
        assert tool_error(client, "get_case", actor_id="pato-pokorny", case_id=CASE) == (
            "actor is not a user of the app"
        )
        assert tool(client, "get_case", actor_id="pl-reznicek", case_id=CASE)["id"] == CASE


def test_mcp_is_served_under_api_prefix_in_production():
    with TestClient(served_app) as client:
        result = call(client, "tools/call", {"name": "get_case", "arguments": {"case_id": CASE}},
                      path="/api/mcp")
        assert result["structuredContent"]["id"] == CASE
