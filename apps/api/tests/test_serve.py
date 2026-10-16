from fastapi import FastAPI
from fastapi.testclient import TestClient
from onko_api.serve import WEB_DIST, SpaStaticFiles, app


def test_api_is_served_under_api_prefix_with_seed():
    with TestClient(app) as client:  # runs the API's lifespan (repository + seed)
        assert client.get("/api/health").json()["ok"] is True
        assert [c["id"] for c in client.get("/api/cases").json()] == ["vzp-prochazkova"]


def test_client_routes_fall_back_to_index_so_refresh_works(tmp_path):
    (tmp_path / "index.html").write_text("<div id=root></div>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("ok")
    web = FastAPI()
    web.mount("/", SpaStaticFiles(directory=tmp_path, html=True))
    client = TestClient(web)
    for route in ["/", "/coordinator", "/referrer", "/coordinator/cases/c1?tab=tasks"]:
        response = client.get(route)
        assert response.status_code == 200
        assert response.text == "<div id=root></div>"
    assert client.get("/assets/app.js").text == "ok"
    assert client.get("/assets/missing.js").status_code == 404


def test_served_app_refreshes_deep_links_and_keeps_api_404s():
    with TestClient(app) as client:
        assert client.get("/api/nope").status_code == 404
        if WEB_DIST.is_dir():
            assert client.get("/coordinator/cases/vzp-prochazkova").status_code == 200
