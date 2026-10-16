from fastapi.testclient import TestClient
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


def test_committed_openapi_spec_is_current():
    """apps/web/openapi.json feeds the generated client; regenerate with scripts/export_openapi.py."""
    import json
    from pathlib import Path

    spec = Path(__file__).resolve().parents[2] / "web" / "openapi.json"
    assert json.loads(spec.read_text(encoding="utf-8")) == app.openapi(), "run scripts/export_openapi.py"
