// `MDT_zapis`: the board's brief before the meeting, sections 1–5 (the outcome is the separate
// `MDT_zaver`). Input: `title`, `record` (MdtRecord) and `handover` (the frozen snapshot's other
// values, see `render_mdt_record`, or none: then only the record's fields are shown).

#import "common.typ": *

#let data = json(bytes(sys.inputs.data))
#let record = data.record
#let snap = data.handover
#let has-snap = snap != none
#let v(key) = if has-snap { snap.at(key, default: none) }
// Rows shown only with the snapshot.
#let with-snap(..rows) = if has-snap { rows.pos() } else { () }

#show: doc.with(data.title)

= #data.title

== 1 Základní údaje

#fields(
  ([Datum MDT], date(record.mdt_date)),
  ([Pacient], lines(
    record.patient_name,
    joined(if v("age") != none { "věk " + str(v("age")) }, v("sex")),
    if present(record.insurance_code) { "Pojišťovna: " + record.insurance_code },
    joined(record.patient_phone, record.patient_email),
    record.patient_address,
    joined(number(record.weight_kg, "kg"), number(record.height_cm, "cm")),
  )),
  ..with-snap(
    ([Kontaktní osoba], lines(v("contact_person"), v("contact_person_phone"))),
  ),
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
  ..with-snap(
    ([Epikríza], or-missing(v("epicrisis"))),
    ([Histologie], or-missing(v("histology"))),
    ([Stav výkonnosti (PS)], or-missing(v("performance_status"))),
    ([Symptomy a jejich počátek], or-missing(v("symptoms"))),
  ),
)

== 4 Komorbidity

#items(record.comorbidities)

#if has-snap {
  fields(
    ([Léková anamnéza (FA)], items(v("medications"))),
    ([Alergie (AA)], or-missing(v("allergies"))),
  )
}

== 5 Výsledky stávajících vyšetření

#result-list(record.results)

=== Požadavek / otázka na MDT

#or-missing(record.mdt_question)

#if has-snap [
  === Jiná sdělení

  #or-missing(v("other"))
]
