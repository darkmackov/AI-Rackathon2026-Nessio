// `MDT_zaver`: the conclusion's own fields, with the patient, members and comorbidities restated
// from the MDT record (not the earlier examinations). Input: `title`, `header` (KOC and board lines), `conclusion` (MdtConclusion)
// and `record` (MdtRecord or none).

#import "common.typ": *

#let data = json(bytes(sys.inputs.data))
#let conclusion = data.conclusion
#let record = data.record
#let held = if conclusion.date != none { conclusion.date } else if record != none { record.mdt_date }

#show: doc.with(data.title)

#if data.header.len() > 0 [#block(width: 100%, fill: paper, inset: 3mm, radius: 2mm, below: 6mm)[
  #for (i, line) in data.header.enumerate() {
    if i == 0 { strong(line) } else { linebreak() + line }
  }
]]

= #data.title

== Základní údaje

*Datum MDT:* #date(held)

#if record != none [
  *Pacient:* #lines(joined(
    record.patient_name,
    record.patient_address,
    if present(record.insurance_code) { "ZP " + record.insurance_code },
  ))

  *Referující lékař:* #or-missing(record.referring_doctor_name)
]

*Případ prezentoval:* #or-missing(conclusion.presented_by)

#if record != none [
  == Členové MDT

  #items(record.members.map(m => m.name + " – " + m.specialty))
]

== Diagnóza

*Název a kód:* #or-missing(joined(conclusion.diagnosis_code, conclusion.diagnosis_name, sep: " – "))

#if record != none [
  *Komorbidity:* #or-missing(record.comorbidities.join(", "))
]

*Klinické zhodnocení:* #or-missing(conclusion.clinical_assessment)

== Závěr MDT

#or-missing(conclusion.conclusion)

== Doporučení MDT

#items(conclusion.recommendations, ordered: true)

#if present(conclusion.place) [#conclusion.place, ]#date(held)

#if present(conclusion.chair) [
  #conclusion.chair \
  předsedající MDT
]

#if conclusion.copy_to.len() > 0 [
  *Kopie:* #lines(..conclusion.copy_to)
]
