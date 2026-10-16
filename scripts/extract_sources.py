"""Extract challenge .docx/.pptx sources into Markdown.

Usage:
    uv run python scripts/extract_sources.py <input file or dir> <output dir>

Example (regenerates data/vzp-structured/reports):
    uv run python scripts/extract_sources.py data/cesta-pacienta-data/Pacient data/vzp-structured/reports
"""

from __future__ import annotations

import sys
from pathlib import Path

from onko_documents import CONVERTERS


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    src, out_dir = Path(argv[1]), Path(argv[2])
    files = [src] if src.is_file() else sorted(src.iterdir())
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for f in files:
        convert = CONVERTERS.get(f.suffix.lower())
        if convert is None or f.name.startswith("~$"):
            continue
        target = out_dir / (f.stem + ".md")
        target.write_text(f"<!-- source: {f.name} -->\n\n" + convert(f), encoding="utf-8")
        count += 1
        print(f"{f.name} -> {target}")
    print(f"{count} file(s) written")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
