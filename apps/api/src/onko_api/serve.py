"""Production entry (Azure, Q-I8): the API under `/api` and the built web app at `/`, the same URL
layout the Vite dev proxy gives the web app in development.

Run:  uv run uvicorn onko_api.serve:app --host 0.0.0.0 --port 8000
Web:  ONKO_WEB_DIST points at `apps/web/dist` (`npm --prefix apps/web run build`).
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import Scope

from .main import app as api
from .main import lifespan


class SpaStaticFiles(StaticFiles):
    """Static files that answer unknown client routes with `index.html`, so a browser refresh on a
    deep link (`/coordinator/cases/…`) loads the app instead of a 404. Missing files (a path whose
    last segment has an extension) still 404."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or "." in path.rsplit("/", 1)[-1]:
                raise
            return await super().get_response("index.html", scope)


WEB_DIST = Path(os.environ.get("ONKO_WEB_DIST", Path(__file__).resolve().parents[3] / "web" / "dist"))

# Starlette does not run a mounted app's lifespan, so the outer app runs the API's.
app = FastAPI(lifespan=lambda _: lifespan(api), docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
if WEB_DIST.is_dir():
    app.mount("/", SpaStaticFiles(directory=WEB_DIST, html=True), name="web")
