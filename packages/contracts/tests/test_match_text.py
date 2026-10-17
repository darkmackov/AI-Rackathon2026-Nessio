"""`match_text` (Q-C13 part 1, Q-K12): the normalized text and its offsets into the original."""

from __future__ import annotations

from onko_contracts import match_text


def _back(original: str, normalized: str) -> str:
    """The original text a normalized substring came from."""
    m = match_text(original)
    start = m.text.index(normalized)
    a, b = m.span(start, start + len(normalized))
    return original[a:b]


def test_whitespace_runs_and_non_breaking_spaces_become_one_space():
    assert match_text("  ECOG\u00a0 1\n\n\tstav ").text == "ECOG 1 stav"


def test_decomposed_letters_are_composed():
    decomposed = "Ve\u030cra"  # V, e, combining caron, r, a
    assert match_text(decomposed).text == "Věra"
    assert _back(decomposed, "ě") == "e\u030c"


def test_a_hyphen_breaking_a_word_at_a_line_end_is_removed():
    assert match_text("karcinom pan-\ncreatu").text == "karcinom pancreatu"
    assert match_text("CA 19-9 a CEA").text == "CA 19-9 a CEA"  # not at a line end
    assert match_text("pacient -\n bez potíží").text == "pacient - bez potíží"  # not inside a word


def test_typographic_quotes_and_dashes_are_ascii():
    assert match_text("„suspektní“ – ‚možná‘ — 5−3").text == "\"suspektní\" - 'možná' - 5-3"


def test_offsets_point_into_the_original_text():
    original = "Závěr:\u00a0\u00a0tumor  hlavy\npankreatu"
    assert _back(original, "tumor hlavy pankreatu") == "tumor  hlavy\npankreatu"
    m = match_text(original)
    assert len(m.offsets) == len(m.text) + 1 and m.offsets[-1] == len(original)


def test_empty_and_blank_text():
    assert match_text("").text == ""
    assert match_text(" \n ").text == ""
