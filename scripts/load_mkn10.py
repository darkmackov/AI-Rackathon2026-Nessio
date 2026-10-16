"""Load the MKN-10 code list into IRIS for code suggestions (S8, Q-C11, Q-C12).

Each code is embedded by its Czech name through the embedding slot and stored in `mkn10_code`,
replacing the list already there. Needs IRIS, ONKO_EMBED_DIM and an embedding slot in `.env`.

Usage:
    uv run python scripts/load_mkn10.py <file.csv> [code column] [name column]

The file is a delimited text export of the ÚZIS MKN-10 classification (UTF-8 or Windows-1250, the
delimiter is detected). Without column names the first column is the code and the second its name.
The exact ÚZIS export is not settled yet (Q-C12): check the columns when the file arrives.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

from onko_ai import load_codes
from onko_contracts import CodeCandidate
from onko_llm_gateway import Gateway
from onko_repository import IrisRepository, IrisSettings


def read_codes(path: Path, code_column: str | None = None, name_column: str | None = None
               ) -> list[CodeCandidate]:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1250")
    dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t|")
    rows = list(csv.reader(text.splitlines(), dialect))
    if code_column and name_column:
        header = [h.strip() for h in rows[0]]
        code_at, name_at = header.index(code_column), header.index(name_column)
        rows = rows[1:]
    else:
        code_at, name_at = 0, 1
    codes: dict[str, CodeCandidate] = {}
    for row in rows:
        if len(row) <= max(code_at, name_at):
            continue
        code, name = row[code_at].strip(), row[name_at].strip()
        if code and name and code not in codes:
            codes[code] = CodeCandidate(code=code, title_cs=name)
    return list(codes.values())


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 4):
        print(__doc__)
        return 2
    codes = read_codes(Path(argv[1]), *argv[2:4])
    settings = IrisSettings()
    if not settings.iris_configured or settings.embed_dim is None:
        print("Set ONKO_IRIS_CONNECTION_STRING and ONKO_EMBED_DIM in .env")
        return 1
    gateway = Gateway.from_env()
    repo = IrisRepository(settings.model_copy(update={"fhir_base_url": None}), retry_seconds=None)
    try:
        print(f"{load_codes(codes, repo, gateway)} MKN-10 codes loaded")
    finally:
        repo.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
