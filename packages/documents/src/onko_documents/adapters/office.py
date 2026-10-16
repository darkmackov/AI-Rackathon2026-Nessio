"""Office (.docx / .pptx) to Markdown, stdlib only. Word tables become Markdown tables."""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def _run_text(el: ET.Element) -> str:
    parts: list[str] = []
    for node in el.iter():
        if node.tag == f"{W}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag in (f"{W}br", f"{W}cr"):
            parts.append("\n")
    return "".join(parts)


def _table_md(tbl: ET.Element) -> str:
    rows: list[list[str]] = []
    for tr in tbl.findall(f"{W}tr"):
        cells = []
        for tc in tr.findall(f"{W}tc"):
            text = " ".join(_run_text(p).strip() for p in tc.findall(f"{W}p")).strip()
            cells.append(text.replace("|", "\\|"))
        if any(cells):
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _zip(source: Path | bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(source) if isinstance(source, bytes) else source)


def docx_to_md(source: Path | bytes) -> str:
    with _zip(source) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(f"{W}body")
    blocks: list[str] = []
    for child in body if body is not None else []:
        if child.tag == f"{W}p":
            text = _run_text(child).strip()
            if text:
                blocks.append(text)
        elif child.tag == f"{W}tbl":
            md = _table_md(child)
            if md:
                blocks.append(md)
    return "\n\n".join(blocks) + "\n"


def pptx_to_md(source: Path | bytes) -> str:
    with _zip(source) as z:
        slides = sorted(
            (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)),
        )
        out: list[str] = []
        for i, name in enumerate(slides, 1):
            root = ET.fromstring(z.read(name))
            paras = []
            for p in root.iter(f"{A}p"):
                text = "".join(t.text or "" for t in p.iter(f"{A}t")).strip()
                if text:
                    paras.append(text)
            out.append(f"## Slide {i}\n\n" + "\n\n".join(paras))
    return "\n\n".join(out) + "\n"


CONVERTERS = {".docx": docx_to_md, ".pptx": pptx_to_md}
