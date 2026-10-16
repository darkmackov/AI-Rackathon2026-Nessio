"""Finding verbatim quotes in document text (D-2). Only whitespace may differ."""

from __future__ import annotations

import re

from onko_contracts import Evidence, ParsedDocument

_WS = re.compile(r"\s+")


def _squash(text: str) -> tuple[str, list[int]]:
    """Text with every whitespace run turned into one space, plus the original index of each char."""
    out: list[str] = []
    index: list[int] = []
    for m in re.finditer(r"\s+|\S+", text):
        if m.group().isspace():
            out.append(" ")
            index.append(m.start())
        else:
            out.append(m.group())
            index.extend(range(m.start(), m.end()))
    return "".join(out), index


def locate(quote: str, text: str, start: int = 0) -> tuple[int, int] | None:
    """Char span of `quote` in `text` at or after `start`, ignoring whitespace differences."""
    needle = _WS.sub(" ", quote).strip()
    if not needle:
        return None
    hay, index = _squash(text)
    pos = 0
    while (found := hay.find(needle, pos)) != -1:
        begin = index[found]
        if begin >= start:
            return begin, index[found + len(needle) - 1] + 1
        pos = found + 1
    return None


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
