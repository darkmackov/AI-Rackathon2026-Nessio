"""Typst template + JSON data -> PDF, with the bundled DejaVu Sans so Czech diacritics render
without system fonts (the slim Docker image has none). System fonts are ignored, so the output
is the same everywhere (Q-K13)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import typst

PACKAGE = Path(__file__).resolve().parent.parent
FONTS = PACKAGE / "fonts"
TEMPLATES = PACKAGE / "templates"


def typst_to_pdf(template: str, data: Mapping[str, Any]) -> bytes:
    """Compile `templates/<template>.typ`; it reads `data` as JSON from `sys.inputs.data`."""
    path = TEMPLATES / f"{template}.typ"
    if not path.is_file():
        raise ValueError(f"No template {template}")
    return typst.compile(
        str(path),
        root=str(TEMPLATES),
        font_paths=[str(FONTS)],
        ignore_system_fonts=True,
        sys_inputs={"data": json.dumps(data, ensure_ascii=False)},
    )
