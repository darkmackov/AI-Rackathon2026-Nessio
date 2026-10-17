"""Text normalized for matching (Q-C13 part 1, Q-K12): the one normalizer the quote check,
chunking and the duplicate check share.

It lives in contracts because `ai` and `documents` both need it and neither may depend on the
other (Q-K12). It is a pure function over a string: no I/O, no domain logic (DM-10). The original
text is never changed; `MatchText.offsets` maps every normalized character back into it, so
evidence offsets keep pointing into the original.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

# Typographic quotes and dashes -> their ASCII form
_FOLD = str.maketrans({
    "„": '"', "“": '"', "”": '"', "‟": '"', "«": '"', "»": '"', "″": '"',
    "‚": "'", "‘": "'", "’": "'", "‛": "'", "‹": "'", "›": "'", "′": "'",
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
})


@dataclass(frozen=True)
class MatchText:
    """`text` normalized for matching. `text[i]` came from `original[offsets[i]:ends[i]]` (more
    than one character for a composed letter or a whitespace run); `offsets[len(text)]` is the
    original's length."""

    text: str
    offsets: tuple[int, ...]
    ends: tuple[int, ...]

    def span(self, start: int, end: int) -> tuple[int, int]:
        """The original span of the normalized `text[start:end]` (`end` > `start`)."""
        return self.offsets[start], self.ends[end - 1]


def match_text(text: str) -> MatchText:
    """Unicode NFC; every whitespace run (incl. non-breaking spaces) as one space; a hyphen that
    breaks a word at a line end (PDF) removed; typographic quotes and dashes as ASCII."""
    out: list[str] = []
    offsets: list[int] = []
    ends: list[int] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "-" or unicodedata.category(c) == "Pd":
            j = i + 1
            while j < n and text[j] in " \t\r":
                j += 1
            if j < n and text[j] == "\n" and out and out[-1].isalpha():
                k = j + 1
                while k < n and text[k].isspace():
                    k += 1
                if k < n and text[k].isalpha():  # "pan-\ncreas" -> "pancreas"
                    i = k
                    continue
        if c.isspace():
            j = i
            while j < n and text[j].isspace():
                j += 1
            if out and out[-1] != " ":  # leading whitespace is dropped
                out.append(" ")
                offsets.append(i)
                ends.append(j)
            i = j
            continue
        # A base character with its combining marks, composed together (NFC)
        j = i + 1
        while j < n and unicodedata.combining(text[j]):
            j += 1
        for ch in unicodedata.normalize("NFC", text[i:j]).translate(_FOLD):
            out.append(ch)
            offsets.append(i)
            ends.append(j)
        i = j
    if out and out[-1] == " ":
        out.pop()
        offsets.pop()
        ends.pop()
    offsets.append(n)
    return MatchText("".join(out), tuple(offsets), tuple(ends))
