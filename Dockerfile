# API + web in one image for the Azure demo (Q-I8). See docs/deploy.md.

FROM node:24-slim AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
# The image serves the real API next to the web app, so the web talks to it (Q-W6); mock for a standalone demo
ARG VITE_API_MODE=real
RUN VITE_API_MODE=$VITE_API_MODE npm run build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /bin/uv
# tzdata: the FHIR projection converts naive datetimes to Europe/Prague (D-13)
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN uv sync --frozen --no-dev --no-editable --package onko-api
# The reference case (with its original reports) and the demo directory feed the seed (seed.py)
COPY data/vzp-structured/ data/vzp-structured/
COPY data/demo/ data/demo/
COPY data/cesta-pacienta-data/Pacient/ data/cesta-pacienta-data/Pacient/
COPY --from=web /web/dist/ apps/web/dist/

ENV PATH=/app/.venv/bin:$PATH \
    ONKO_DATA_DIR=/app/data \
    ONKO_WEB_DIST=/app/apps/web/dist
EXPOSE 8000
CMD ["uvicorn", "onko_api.serve:app", "--host", "0.0.0.0", "--port", "8000"]
