from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from onko_api.clock import AppClock
from onko_api.main import app


def test_reference_case_is_served():
    with TestClient(app) as client:
        assert client.get("/health").json()["ok"] is True
        cases = client.get("/cases").json()
        assert [c["id"] for c in cases] == ["vzp-prochazkova"]
        case = cases[0]
        assert case["state"] == "pripraveno_k_mdt"
        assert case["next_step"] == "MDT pro nádory GIT"

        handover = client.get("/cases/vzp-prochazkova/handover").json()
        assert handover["performance_status"]["status"] == "missing"

        docs = client.get("/cases/vzp-prochazkova/documents").json()
        assert {d["id"] for d in docs} == {f"{i:02d}" for i in range(1, 12)}  # 12, 13 come after MDT


def test_me_follows_the_role_switcher():
    with TestClient(app) as client:
        gp = client.get("/me", headers={"X-Actor-Id": "pl-reznicek"})
        assert gp.status_code == 200
        assert gp.json()["role"] == "referring_doctor"
        coordinator = client.get("/me", headers={"X-Actor-Id": "koordinator"})
        assert coordinator.json()["role"] == "coordinator"


def test_me_rejects_unknown_actors_and_non_users():
    with TestClient(app) as client:
        assert client.get("/me", headers={"X-Actor-Id": "nobody"}).status_code == 404
        assert client.get("/me", headers={"X-Actor-Id": "pato-pokorny"}).status_code == 403  # Q-F21
        assert client.get("/me").status_code == 422


def test_directory_is_served_and_filtered():
    with TestClient(app) as client:
        kocs = client.get("/directory/organizations", params={"kind": "koc"}).json()
        assert len(kocs) == 5
        assert all(o["kind"] == "koc" for o in kocs)
        assert len(client.get("/directory/organizations").json()) > len(kocs)

        coordinators = client.get("/directory/actors", params={"role": "coordinator"}).json()
        assert len(coordinators) == 5
        at_koc2 = client.get("/directory/actors", params={"organization_id": "koc2-lipova"}).json()
        assert at_koc2 and all(a["organization_id"] == "koc2-lipova" for a in at_koc2)
        both = client.get(
            "/directory/actors", params={"role": "coordinator", "organization_id": "koc2-lipova"}
        ).json()
        assert [a["id"] for a in both] == ["koordinator"]


def test_mdt_boards():
    with TestClient(app) as client:
        assert len(client.get("/mdt-boards").json()) == 5
        board = client.get("/mdt-boards/mdt-git-lipova")
        assert board.status_code == 200
        assert board.json()["organization_id"] == "koc2-lipova"
        assert client.get("/mdt-boards/missing").status_code == 404


def test_demo_clock_set_and_back_to_wall_clock():
    with TestClient(app) as client:
        assert client.get("/demo/clock").json()["simulated"] is False

        clock = client.put("/demo/clock", json={"now": "2026-10-21T09:00:00"}).json()
        assert clock["simulated"] is True
        now = datetime.fromisoformat(clock["now"])
        assert datetime(2026, 10, 21, 9, 0) <= now < datetime(2026, 10, 21, 9, 1)
        assert client.get("/demo/clock").json()["simulated"] is True

        assert client.put("/demo/clock", json={"now": None}).json()["simulated"] is False


def test_app_clock_keeps_ticking_from_the_set_moment():
    wall = [datetime(2030, 1, 1, 12, 0)]
    clock = AppClock(wall=lambda: wall[0])
    clock.set(datetime(2026, 10, 21, 9, 0))
    wall[0] += timedelta(minutes=5)
    assert clock.now() == datetime(2026, 10, 21, 9, 5)
    clock.set(None)
    assert clock.now() == wall[0]
    assert not clock.simulated


def test_app_clock_converts_aware_datetimes_to_local_time():
    clock = AppClock(wall=lambda: datetime(2030, 1, 1, 12, 0))
    aware = datetime(2026, 10, 21, 7, 0, tzinfo=UTC)
    clock.set(aware)
    assert clock.now() == aware.astimezone().replace(tzinfo=None)


def test_reset_to_empty_keeps_the_directory():
    with TestClient(app) as client:
        assert client.post("/demo/reset", json={"scenario": "empty"}).json() == []
        assert client.get("/cases").json() == []
        assert client.get("/me", headers={"X-Actor-Id": "koordinator"}).status_code == 200
        clock = client.get("/demo/clock").json()
        assert clock["simulated"] is True
        assert clock["now"].startswith("2026-10-02T08:0")


def test_reset_to_reference_at_mdt():
    with TestClient(app) as client:
        client.post("/demo/reset", json={"scenario": "empty"})
        cases = client.post("/demo/reset", json={"scenario": "reference_at_mdt"}).json()
        assert [c["id"] for c in cases] == ["vzp-prochazkova"]
        assert cases[0]["state"] == "pripraveno_k_mdt"
        assert client.get("/demo/clock").json()["now"].startswith("2026-10-21T08:0")


def test_committed_openapi_spec_is_current():
    """apps/web/openapi.json feeds the generated client; regenerate with scripts/export_openapi.py."""
    import json
    from pathlib import Path

    spec = Path(__file__).resolve().parents[2] / "web" / "openapi.json"
    assert json.loads(spec.read_text(encoding="utf-8")) == app.openapi(), "run scripts/export_openapi.py"
