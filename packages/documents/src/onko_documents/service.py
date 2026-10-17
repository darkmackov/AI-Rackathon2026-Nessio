"""Parse uploads by MIME type; render output documents (MDT record, MDT conclusion)."""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Iterable
from html import escape

from onko_contracts import MdtConclusion, MdtRecord

from .adapters.office import docx_to_md, pptx_to_md
from .adapters.pdf import pdf_to_text
from .adapters.render import html_to_pdf

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF = "application/pdf"

PARSERS: dict[str, Callable[[bytes], str]] = {
    DOCX: docx_to_md,
    PPTX: pptx_to_md,
    PDF: pdf_to_text,
}

# Output documents and their PDF titles.
RENDER_KINDS = {
    "mdt_record": "Zápis k jednání multidisciplinárního týmu (MDT)",
    "mdt_conclusion": "Zápis z jednání multidisciplinárního týmu (MDT)",
}
MISSING = "neuvedeno"
TABLE = '<table border="1" width="100%" cellpadding="1.5">'


def parse(data: bytes, mime_type: str) -> str:
    """Return plain text / Markdown for a document. Register new formats in PARSERS."""
    try:
        return PARSERS[mime_type](data)
    except KeyError:
        raise ValueError(f"No parser for {mime_type}") from None


def render_pdf(kind: str, html: str) -> bytes:
    """Render an output document (`mdt_record`, `mdt_conclusion`) from simple HTML to PDF."""
    if kind not in RENDER_KINDS:
        raise ValueError(f"No layout for {kind}")
    return html_to_pdf(RENDER_KINDS[kind], html)


def render_mdt_record(record: MdtRecord, conclusion: MdtConclusion | None = None) -> bytes:
    """The MDT record PDF in the `MDT_zapis` layout."""
    return render_pdf("mdt_record", mdt_record_html(record, conclusion))


def render_mdt_conclusion(
    conclusion: MdtConclusion, record: MdtRecord | None = None, *, header: Iterable[str] = ()
) -> bytes:
    """The MDT conclusion PDF in the `MDT_zaver` layout; `header` = KOC and board lines."""
    return render_pdf("mdt_conclusion", mdt_conclusion_html(conclusion, record, header=header))


# --- layouts -----------------------------------------------------------------------------------


def _date(value: dt.date | None) -> str:
    return f"{value.day}. {value.month}. {value.year}" if value else MISSING


def _number(value: float | None, unit: str) -> str | None:
    if value is None:
        return None
    return f"{value:g}".replace(".", ",") + f" {unit}"


def _text(value: str | None) -> str:
    """Escaped paragraph text with its line breaks kept; 'neuvedeno' when missing (MdtRecord
    docstring)."""
    if not value:
        return MISSING
    return "<br>".join(escape(line) for line in value.splitlines())


def _lines(*values: str | None) -> str:
    present = [v for v in values if v]
    return "<br>".join(escape(v) for v in present) if present else MISSING


def _cell(*values: str | None) -> str:
    """Table cell text: fpdf2 allows no tags inside a cell, but keeps its newlines."""
    present = [v for v in values if v]
    return escape("\n".join(present)) if present else MISSING


def _joined(*values: str | None) -> str | None:
    return ", ".join(v for v in values if v) or None


def _row(label: str, value: str, *, first: bool = False) -> str:
    """A label/value row; the first row of a table sets the column widths (fpdf2)."""
    widths = (' width="30%"', ' width="70%"') if first else ("", "")
    return (f'<tr><td align="left"{widths[0]}>{escape(label)}</td>'
            f'<td align="left"{widths[1]}>{value}</td></tr>')


def _table(header: list[str], rows: list[str], widths: list[int]) -> str:
    head = "".join(f'<th width="{w}%">{escape(h)}</th>' for h, w in zip(header, widths, strict=True))
    return (f'{TABLE}<thead><tr>{head}</tr></thead>'
            f"<tbody>{''.join(rows)}</tbody></table>")


def _cells(*values: str) -> str:
    return "<tr>" + "".join(f'<td align="left">{v}</td>' for v in values) + "</tr>"


def _list(items: list[str], *, ordered: bool = False) -> str:
    if not items:
        return f"<p>{MISSING}</p>"
    tag = "ol" if ordered else "ul"
    return f"<{tag}>{''.join(f'<li>{escape(i)}</li>' for i in items)}</{tag}>"


def mdt_record_html(record: MdtRecord, conclusion: MdtConclusion | None = None) -> str:
    """Sections 1–7 of `MDT_zapis`. Sections 6–7 come from a confirmed conclusion only."""
    patient = _cell(
        record.patient_name,
        f"Pojišťovna: {record.insurance_code}" if record.insurance_code else None,
        _joined(record.patient_phone, record.patient_email),
        record.patient_address,
        _joined(_number(record.weight_kg, "kg"), _number(record.height_cm, "cm")),
    )
    referrer = _cell(
        record.referring_doctor_name,
        _joined(record.referring_doctor_phone, record.referring_doctor_email),
    )
    members = [_cells(escape(m.name), escape(m.specialty)) for m in record.members]
    results = [_cells(_date(r.date), _cell(r.examination), _cell(r.result)) for r in record.results]
    confirmed = conclusion if conclusion is not None and conclusion.confirmed else None
    after_meeting = "<p>Doplní se po jednání MDT.</p>"
    return "".join([
        f"<h1>{escape(RENDER_KINDS['mdt_record'])}</h1>",
        "<h2>1 Základní údaje</h2>",
        f"{TABLE}<tbody>",
        _row("Datum MDT", _date(record.mdt_date), first=True),
        _row("Pacient", patient),
        _row("Referující lékař", referrer),
        "</tbody></table>",
        "<h2>2 Členové MDT</h2>",
        _table(["Jméno a příjmení", "Odbornost"], members, [60, 40]) if members
        else f"<p>{MISSING}</p>",
        "<h2>3 Diagnóza</h2>",
        f"{TABLE}<tbody>",
        _row("Název diagnózy", _cell(record.diagnosis_name), first=True),
        _row("Kód diagnózy (MKN-10)", _cell(record.diagnosis_code)),
        "</tbody></table>",
        "<h2>4 Komorbidity</h2>",
        _list(record.comorbidities),
        "<h2>5 Výsledky stávajících vyšetření</h2>",
        _table(["Datum", "Vyšetření", "Výsledek"], results, [16, 26, 58]) if results
        else f"<p>{MISSING}</p>",
        "<h3>Požadavek / otázka na MDT</h3>",
        f"<p>{_text(record.mdt_question)}</p>",
        "<h2>6 Závěr MDT</h2>",
        f"<p>{_text(confirmed.conclusion)}</p>" if confirmed else after_meeting,
        "<h2>7 Doporučení MDT</h2>",
        _list(confirmed.recommendations, ordered=True) if confirmed else after_meeting,
    ])


def mdt_conclusion_html(
    conclusion: MdtConclusion, record: MdtRecord | None = None, *, header: Iterable[str] = ()
) -> str:
    """The `MDT_zaver` layout: the conclusion's own fields, with the patient, members and results
    restated from the MDT record."""
    held = conclusion.date or (record.mdt_date if record else None)
    parts = [f"<p><b>{escape(line)}</b></p>" for line in header if line]
    parts += [
        f"<h1>{escape(RENDER_KINDS['mdt_conclusion'])}</h1>",
        "<h2>Základní údaje</h2>",
        f"<p><b>Datum MDT:</b> {_date(held)}</p>",
    ]
    if record is not None:
        patient = _joined(record.patient_name, record.patient_address,
                          f"ZP {record.insurance_code}" if record.insurance_code else None)
        parts += [
            f"<p><b>Pacient:</b> {_text(patient)}</p>",
            f"<p><b>Referující lékař:</b> {_text(record.referring_doctor_name)}</p>",
        ]
    parts.append(f"<p><b>Případ prezentoval:</b> {_text(conclusion.presented_by)}</p>")
    if record is not None:
        parts += ["<h2>Členové MDT</h2>",
                  _list([f"{m.name} – {m.specialty}" for m in record.members])]
    code_and_name = " – ".join(v for v in (conclusion.diagnosis_code, conclusion.diagnosis_name) if v)
    parts += [
        "<h2>Diagnóza</h2>",
        f"<p><b>Název a kód:</b> {_text(code_and_name)}</p>",
        f"<p><b>Klinické zhodnocení:</b> {_text(conclusion.clinical_assessment)}</p>",
    ]
    if record is not None:
        parts.append("<h2>Výsledky stávajících vyšetření</h2>")
        parts += [f"<p><b>{escape(r.examination)} ({_date(r.date)}):</b> {_text(r.result)}</p>"
                  for r in record.results] or [f"<p>{MISSING}</p>"]
        parts.append(f"<p><b>Komorbidity:</b> {_text(', '.join(record.comorbidities))}</p>")
    parts += [
        "<h2>Závěr MDT</h2>",
        f"<p>{_text(conclusion.conclusion)}</p>",
        "<h2>Doporučení MDT</h2>",
        _list(conclusion.recommendations, ordered=True),
        f"<p>{escape(conclusion.place) + ', ' if conclusion.place else ''}{_date(held)}</p>",
    ]
    if conclusion.chair:
        parts.append(f"<p>{escape(conclusion.chair)}<br>předsedající MDT</p>")
    if conclusion.copy_to:
        parts.append(f"<p><b>Kopie:</b> {_lines(*conclusion.copy_to)}</p>")
    return "".join(parts)
