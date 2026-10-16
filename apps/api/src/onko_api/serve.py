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

from .main import app as api
from .main import lifespan

WEB_DIST = Path(os.environ.get("ONKO_WEB_DIST", Path(__file__).resolve().parents[3] / "web" / "dist"))

# Starlette does not run a mounted app's lifespan, so the outer app runs the API's.
app = FastAPI(lifespan=lambda _: lifespan(api), docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
