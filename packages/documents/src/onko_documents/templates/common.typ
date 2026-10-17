// Shared page setup and value helpers for the output documents (Q-K13).
// Data comes in as JSON (`sys.inputs.data`), so user text is never parsed as Typst markup.

#let missing = "neuvedeno"

// A4, black on white, bundled DejaVu Sans so Czech text needs no system fonts.
#let doc(title, body) = {
  set document(title: title, author: "Onko-koordinace", date: none)
  set page(paper: "a4", margin: 15mm)
  // No kerning: pypdf reads kerned pairs as spaces ("T omáš"), and our PDFs are parsed again.
  set text(font: "DejaVu Sans", size: 10pt, lang: "cs", kerning: false)
  show heading: set text(weight: "bold")
  show heading.where(level: 1): set text(size: 15pt)
  show heading.where(level: 1): set block(above: 2mm, below: 4mm)
  show heading.where(level: 2): set text(size: 12pt)
  show heading.where(level: 2): set block(above: 6mm, below: 3mm)
  show heading.where(level: 3): set text(size: 10pt)
  show heading.where(level: 3): set block(above: 4mm, below: 2mm)
  body
}

#let present(value) = value != none and value != ""

// The value, or 'neuvedeno' when it is missing (MdtRecord docstring).
#let or-missing(value) = if present(value) { value } else { missing }

// ISO date (`2026-10-21`) as `21. 10. 2026`.
#let date(iso) = {
  if not present(iso) { return missing }
  let (year, month, day) = iso.split("-").map(int)
  str(day) + ". " + str(month) + ". " + str(year)
}

// `65.5, "kg"` as `65,5 kg`; none stays none.
#let number(value, unit) = if value != none { str(value).replace(".", ",") + " " + unit }

#let joined(..values, sep: ", ") = {
  let kept = values.pos().filter(present)
  if kept.len() > 0 { kept.join(sep) }
}

// Present values one per line, or 'neuvedeno'.
#let lines(..values) = or-missing(joined(..values, sep: "\n"))

#let items(values, ordered: false) = {
  if values.len() == 0 { missing } else if ordered { enum(..values) } else { list(..values) }
}

// Label/value rows.
#let fields(..rows) = table(
  columns: (30%, 70%),
  stroke: 0.5pt,
  inset: 5pt,
  ..rows.pos().flatten(),
)

// A table with a header row; `rows` are arrays of cells.
#let grid-table(header, widths, rows) = table(
  columns: widths,
  stroke: 0.5pt,
  inset: 5pt,
  table.header(..header.map(strong)),
  ..rows.flatten(),
)
