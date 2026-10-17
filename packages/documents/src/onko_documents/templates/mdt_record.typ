// `MDT_zapis`: sections 1–7 of the MDT record. Input: `title`, `record` (MdtRecord) and
// `conclusion` (a confirmed MdtConclusion or none; sections 6–7 come from it).

#import "common.typ": *

#let data = json(bytes(sys.inputs.data))
#let record = data.record
#let conclusion = data.conclusion
#let after-meeting = [Doplní se po jednání MDT.]

#show: doc.with(data.title)

= #data.title

== 1 Základní údaje

#fields(
  ([Datum MDT], date(record.mdt_date)),
  ([Pacient], lines(
    record.patient_name,
    if present(record.insurance_code) { "Pojišťovna: " + record.insurance_code },
    joined(record.patient_phone, record.patient_email),
    record.patient_address,
    joined(number(record.weight_kg, "kg"), number(record.height_cm, "cm")),
  )),
  ([Referující lékař], lines(
    record.referring_doctor_name,
    joined(record.referring_doctor_phone, record.referring_doctor_email),
  )),
)

== 2 Členové MDT

#if record.members.len() == 0 { missing } else {
  grid-table(
    ([Jméno a příjmení], [Odbornost]),
    (60%, 40%),
    record.members.map(m => (m.name, m.specialty)),
  )
}

== 3 Diagnóza

#fields(
  ([Název diagnózy], or-missing(record.diagnosis_name)),
  ([Kód diagnózy (MKN-10)], or-missing(record.diagnosis_code)),
)

== 4 Komorbidity

#items(record.comorbidities)

== 5 Výsledky stávajících vyšetření

#result-list(record.results)

=== Požadavek / otázka na MDT

#or-missing(record.mdt_question)

== 6 Závěr MDT

#if conclusion == none { after-meeting } else { or-missing(conclusion.conclusion) }

== 7 Doporučení MDT

#if conclusion == none { after-meeting } else { items(conclusion.recommendations, ordered: true) }
