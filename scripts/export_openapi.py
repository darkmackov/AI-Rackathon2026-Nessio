"""Write the API's OpenAPI spec to apps/web/openapi.json (no running server needed).

Usage:
    uv run python scripts/export_openapi.py
Then regenerate the web client:
    npm --prefix apps/web run gen:api
"""

from __future__ import annotations

import json
from pathlib import Path

from onko_api.main import app

TARGET = Path(__file__).resolve().parents[1] / "apps" / "web" / "openapi.json"

if __name__ == "__main__":
    TARGET.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {TARGET}")
