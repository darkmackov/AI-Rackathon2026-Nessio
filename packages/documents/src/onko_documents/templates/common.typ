// Shared page setup and value helpers for the output documents (Q-K13).
// Data comes in as JSON (`sys.inputs.data`), so user text is never parsed as Typst markup.

#let missing = "neuvedeno"

// Brand colours from the web theme (apps/web/src/theme.ts): `nessie` greens, `gray` borders.
#let ink = rgb("#23342B")
#let brand = rgb("#25634B")
#let tint = rgb("#E9F0E1")
#let paper = rgb("#F4F7F2")
#let rule = rgb("#dee2e6")
#let dimmed = rgb("#59636b")

// A4 with the Nessio header (logo as in the app header, templates/nessio-logo.svg = the web
// favicon) and a page footer; bundled DejaVu Sans so Czech text needs no system fonts.
#let doc(title, body) = {
  set document(title: title, author: "Nessio", date: none)
  set page(
    paper: "a4",
    margin: (x: 15mm, top: 26mm, bottom: 18mm),
    header: block(width: 100%, stroke: (bottom: 1.5pt + brand), inset: (bottom: 2.5mm))[
      #grid(
        columns: (auto, 1fr),
        column-gutter: 2mm,
        align: horizon,
        image("nessio-logo.svg", height: 9mm),
        text(size: 13pt, weight: "bold", fill: ink)[Nessio],
      )
    ],
    footer: context {
      set text(size: 8pt, fill: dimmed)
      grid(
        columns: (1fr, auto),
        [Nessio · #title],
        [Strana #counter(page).display() / #counter(page).final().first()],
      )
    },
  )
  // No kerning: pypdf reads kerned pairs as spaces ("T omáš"), and our PDFs are parsed again.
  set text(font: "DejaVu Sans", size: 10pt, lang: "cs", kerning: false, fill: ink)
  set list(marker: text(fill: brand)[•])
  set enum(numbering: n => text(fill: brand, weight: "bold")[#n.])
  show heading: set text(weight: "bold", fill: brand)
  show heading.where(level: 1): set text(size: 16pt)
  show heading.where(level: 1): set block(above: 1mm, below: 5mm)
  show heading.where(level: 2): set text(size: 12pt)
  show heading.where(level: 2): set block(above: 7mm, below: 3mm)
  show heading.where(level: 3): set text(size: 10pt, fill: ink)
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

// Label/value rows: the label on the pale brand background, as in the app's field lists.
#let fields(..rows) = table(
  columns: (30%, 70%),
  stroke: (x, y) => (top: if y > 0 { 0.5pt + rule }, rest: none),
  inset: 6pt,
  fill: (x, y) => if x == 0 { paper },
  ..rows.pos().map(row => (text(fill: dimmed, row.at(0)), row.at(1))).flatten(),
)

// A table with a header row (repeated on every page); `rows` are arrays of cells.
#let grid-table(header, widths, rows) = table(
  columns: widths,
  stroke: (x, y) => (top: if y > 0 { 0.5pt + rule }, rest: none),
  inset: 6pt,
  fill: (x, y) => if y == 0 { tint },
  table.header(..header.map(h => text(weight: "bold", fill: brand, h))),
  ..rows.flatten(),
)
