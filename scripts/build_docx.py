"""Build .docx originals from Markdown reports (stdlib only); the inverse of extract_sources.py.

Each blank-line separated block becomes a Word paragraph, Markdown tables become real Word
tables, and an all-caps line becomes a bold heading. The leading `<!-- source: … -->` line is
skipped. Output is byte-for-byte reproducible (fixed zip timestamps).

Usage:
    uv run python scripts/build_docx.py <reports dir> <output dir>

Example (regenerates the synthetic reference case 2 originals):
    uv run python scripts/build_docx.py data/reference-2/reports data/reference-2/originals
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" \
ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" \
Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" \
Target="word/document.xml"/>
</Relationships>
"""

TABLE_PROPS = (
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
    + "".join(
        f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>'
        for side in ("top", "left", "bottom", "right", "insideH", "insideV")
    )
    + "</w:tblBorders></w:tblPr>"
)


def _run(text: str, bold: bool = False) -> str:
    props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _paragraph(text: str) -> str:
    letters = re.sub(r"[^\w]", "", text)
    heading = bool(letters) and text.upper() == text and not letters.isdigit()
    return f"<w:p>{_run(text, bold=heading)}</w:p>"


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _table(lines: list[str]) -> str:
    rows = [_cells(line) for line in lines if not re.fullmatch(r"\|[\s\-:|]+\|", line.strip())]
    out = [f"<w:tbl>{TABLE_PROPS}"]
    for i, row in enumerate(rows):
        out.append("<w:tr>")
        out += [f"<w:tc><w:p>{_run(cell, bold=i == 0)}</w:p></w:tc>" for cell in row]
        out.append("</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def markdown_to_document_xml(markdown: str) -> str:
    """Word `document.xml` for a report written as blank-line separated Markdown blocks."""
    lines = markdown.splitlines()
    if lines and lines[0].startswith("<!--"):
        lines = lines[1:]
    blocks = [b.strip() for b in "\n".join(lines).split("\n\n") if b.strip()]
    body = []
    for block in blocks:
        block_lines = block.splitlines()
        if all(line.lstrip().startswith("|") for line in block_lines):
            body.append(_table(block_lines))
        else:
            body += [_paragraph(line.strip()) for line in block_lines if line.strip()]
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:document xmlns:w="{W_NS}"><w:body>{"".join(body)}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
        'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>\n'
    )


def write_docx(markdown: str, target: Path) -> None:
    parts = {
        "[Content_Types].xml": CONTENT_TYPES,
        "_rels/.rels": RELS,
        "word/document.xml": markdown_to_document_xml(markdown),
    }
    with zipfile.ZipFile(target, "w") as z:
        for name, content in parts.items():
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, content.encode("utf-8"))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    src, out_dir = Path(argv[1]), Path(argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    reports = sorted(src.glob("*.md"))
    for report in reports:
        write_docx(report.read_text(encoding="utf-8"), out_dir / (report.stem + ".docx"))
    print(f"wrote {len(reports)} file(s) to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
