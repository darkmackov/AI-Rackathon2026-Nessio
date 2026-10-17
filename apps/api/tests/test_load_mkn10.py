"""Reading the MKN-10 code list for `scripts/load_mkn10.py` (S8, Q-C12)."""

from __future__ import annotations

import datetime as dt
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).parents[3] / "scripts" / "load_mkn10.py"
TODAY = dt.date(2026, 10, 17)

HEADER = '"kod","kod_tecka","nazev","platnost_od","platnost_do"\n'


def _read_codes():
    spec = importlib.util.spec_from_file_location("load_mkn10", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.read_codes


def test_only_codes_valid_today_are_read(tmp_path):
    path = tmp_path / "mkn10.csv"
    path.write_text(
        HEADER
        + 'C250,C25.0,"Zhoubný novotvar – hlava slinivky břišní","1994-01-01",""\n'
        + 'U070,U07.0,"Starý kód","2010-01-01","2011-12-31"\n'
        + 'U071,U07.1,"Platný do konce roku","2020-01-01","2026-12-31"\n',
        encoding="utf-8",
    )

    codes = _read_codes()(path, "kod_tecka", "nazev", today=TODAY)

    assert [(c.code, c.title_cs) for c in codes] == [
        ("C25.0", "Zhoubný novotvar – hlava slinivky břišní"),
        ("U07.1", "Platný do konce roku"),
    ]


def test_without_column_names_the_first_two_columns_are_read(tmp_path):
    path = tmp_path / "mkn10.csv"
    path.write_text("C20;Zhoubný novotvar konečníku\nC20;duplicate\n", encoding="cp1250")

    codes = _read_codes()(path, today=TODAY)

    assert [(c.code, c.title_cs) for c in codes] == [("C20", "Zhoubný novotvar konečníku")]
