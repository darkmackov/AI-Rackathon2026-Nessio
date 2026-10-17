"""Finding verbatim quotes in document text (D-2). Only what `match_text` normalizes may differ:
whitespace, Unicode composition, line-break hyphens, typographic quotes and dashes (Q-C13)."""

from __future__ import annotations

import re
from functools import lru_cache

from onko_contracts import Evidence, MatchText, ParsedDocument, match_text

_WS = re.compile(r"\s+")
_TOKENS = re.compile(r"\s+|\S+")


@lru_cache(maxsize=64)
def _normalized(text: str) -> MatchText:
    """A document is searched for many quotes in a row: normalize it once."""
    return match_text(text)


def locate(quote: str, text: str, start: int = 0) -> tuple[int, int] | None:
    """Char span of `quote` in `text` at or after `start`, both compared as `match_text`. A quote
    that keeps a line-break hyphen the normalizer joins (`pan- creatu`) still matches the way it
    did before, on whitespace alone."""
    return _find(match_text(quote).text, _normalized(text), start) or _find(
        _WS.sub(" ", quote).strip(), _whitespace_only(text), start)


def _find(needle: str, hay: MatchText, start: int) -> tuple[int, int] | None:
    if not needle:
        return None
    pos = 0
    while (found := hay.text.find(needle, pos)) != -1:
        begin, end = hay.span(found, found + len(needle))
        if begin >= start:
            return begin, end
        pos = found + 1
    return None


@lru_cache(maxsize=64)
def _whitespace_only(text: str) -> MatchText:
    """Every whitespace run as one space, nothing else changed (the matching before Q-C13)."""
    out: list[str] = []
    offsets: list[int] = []
    ends: list[int] = []
    for m in _TOKENS.finditer(text):
        if m.group().isspace():
            out.append(" ")
            offsets.append(m.start())
            ends.append(m.end())
        else:
            out.append(m.group())
            offsets.extend(range(m.start(), m.end()))
            ends.extend(range(m.start() + 1, m.end() + 1))
    return MatchText("".join(out), tuple(offsets) + (len(text),), tuple(ends))


def evidence(quote: str, doc: ParsedDocument) -> Evidence | None:
    """`Evidence` for `quote` in `doc`, or None when the quote is not in the text verbatim."""
    span = locate(quote, doc.text)
    if span is None:
        return None
    return Evidence(
        document_id=doc.meta.id,
        quote=doc.text[span[0] : span[1]],
        document_date=doc.meta.document_date,
        start=span[0],
        end=span[1],
    )


def section(start_quote: str, end_quote: str, doc: ParsedDocument) -> tuple[str, Evidence] | None:
    """Verbatim text from `start_quote` through `end_quote`, so full-text fields are copies of the
    source by construction (Q-C8, Q-F15)."""
    first = locate(start_quote, doc.text)
    if first is None:
        return None
    last = locate(end_quote, doc.text, first[0])
    if last is None:
        return None
    text = doc.text[first[0] : last[1]]
    return text, Evidence(
        document_id=doc.meta.id,
        quote=text,
        document_date=doc.meta.document_date,
        start=first[0],
        end=last[1],
    )
