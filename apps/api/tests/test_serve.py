from fastapi.testclient import TestClient
from onko_api.serve import app


def test_api_is_served_under_api_prefix_with_seed():
    with TestClient(app) as client:  # runs the API's lifespan (repository + seed)
        assert client.get("/api/health").json()["ok"] is True
        assert [c["id"] for c in client.get("/api/cases").json()] == ["vzp-prochazkova"]
