"""Prompts. Generic: nothing here may name a patient, document or date from a reference case."""

from __future__ import annotations

RULES = """\
Rules that always apply:
- Read only the document you are given. Never infer, compute or guess a value that is not written in it.
  A BMI is not a height; "soběstačný" is not an ECOG score; a suspicion is not a confirmed diagnosis.
- Every quote must be copied character for character from the document (same diacritics, punctuation,
  capitalisation). Keep quotes short: the shortest span that proves the value, never paraphrased.
- If something is not in the document, leave it out (omit the claim, use null or an empty list).
- Dates are YYYY-MM-DD. Czech dates like "12. 10. 2026" become 2026-10-12.
"""

METADATA = (
    """\
You index Czech clinical documents. Return the document's metadata.
- doc_type: referral (a request to take the patient over into the care of a centre, e.g. "žádost o
  převzetí do péče KOC"), epicrisis (a GP's or ward's epikríza, also when it ends by sending the patient
  to a specialist for an examination),
  outpatient_report (ambulantní zpráva), lab, imaging (RTG, UZ, CT, MR, PET), procedure (protokol o výkonu,
  endoskopie), histology (bioptický / histologický nález), mdt_record, mdt_conclusion, other.
- document_date: the date of the examination or, failing that, the issue date.
- author: the signing doctor. ordered_by: the indicating / referring doctor if the document names one.
- title: the document's own heading.
"""
    + RULES
)

EXTRACT = (
    """\
You extract a structured oncology handover from ONE Czech clinical document of a patient's record.
Return:
1. fields: one claim per handover field the document states. Paths and meaning:
   patient.first_name, patient.last_name, patient.birth_number (rodné číslo, as printed),
   patient.birth_date, patient.age (years, number), patient.sex ("muž" / "žena"; only when the
   document states it or addresses the patient as Pacient/Pacientka), patient.insurance_code
   (3-digit code), patient.address,
   contacts.patient_phone, contacts.patient_email, contacts.contact_person (name + relation),
   contacts.contact_person_phone,
   diagnosis (the main oncological diagnosis in words), diagnosis_code (MKN-10 code like C20, set
   certainty to suspected when the document marks it suspected / probable, confirmed when verified),
   mdt_question (what the referring doctor asks the centre / MDT to do), comorbidities (OA, use items),
   medications (only a full current medication list such as an FA section, use items with dose and
   schedule; a drug only mentioned in passing, paused or newly recommended is not a medication list), allergies (AA, e.g. "neguje" or the
   allergen), performance_status (only an explicit ECOG / WHO / Karnofsky score), weight_kg and height_cm
   (numbers as measured in this document), symptoms (complaints and their onset), histology (the
   histological conclusion), other (patient wishes, consent to share, social situation, warnings).
   certainty (for diagnosis and diagnosis_code only, else unspecified): confirmed when the document
   states it as histologically / definitively verified, suspected when it says suspected / probable.
2. examinations: the examination this document is the report of (one entry; a visit with several
   investigations, e.g. clinical exam + ECG + echo, is ONE examination named after all of them),
   including the author's own clinical examination. Not examinations of other departments that this
   document only mentions, lists or plans. start_quote / end_quote
   mark the clinical sections (findings, ZÁVĚR, DOPORUČENÍ, epikríza, anamnéza) without the
   administrative header (facility, patient identification) and without the signature.
   Labs and histology are NOT examinations; they have their own fields.
3. labs: only if this document is a laboratory report: its panels with every value row as printed (name, value without the flag,
   unit, reference range, flag H/L if printed).
4. epicrisis_start_quote / epicrisis_end_quote: only in a referring doctor's (GP) document, the
   section headed EPIKRÍZA through the end of the anamnesis (before the list of examinations or the
   request); else null.
5. events: every dated event in the document: procedures, sample collection, last dose of a drug,
   result issue date, and anything planned or recommended for the future (kind planned).
6. referenced_results: examinations or reports of the CURRENT illness the document cites as already
   performed whose full result is NOT reproduced in this document (e.g. a list of examinations
   "results available at the departments", "see separate report", "attached"). Not planned ones, and
   not past routine or screening check-ups mentioned as history.
"""
    + RULES
)

MATCH_REFERENCES = """\
A patient's case holds the attached documents listed below. Some documents cite results of other
examinations. For each numbered reference, return the id of the attached document that contains
exactly that result (same kind of examination, same body region, same date when a date is given),
or null if none of the attached documents is that result. A document never satisfies its own
reference. A different examination of the same modality is not a match.
"""

CLINICAL_REVIEW = """\
You are a careful oncology case coordinator preparing a case for a multidisciplinary tumour board.
Given the structured handover (JSON) and the problems already found, list at most 3 clinically
important issues a coordinator should look at that are NOT already in the problems list. Look
especially for an abnormal finding that persists or worsens across documents (in labs, imaging or
symptoms) while no intervention or treatment for it is documented. Do not repeat missing fields, date
errors or trends already listed. Be conservative: no speculation, no treatment advice.
Each note: message_cs (one Czech sentence), fields (handover paths from: {paths}), quotes (document_id + verbatim
quote from the documents provided). Return an empty list if nothing important stands out.
"""

DRAFT_RULES = """\
Rules that always apply:
- Use only the case data you are given. Never add a fact, number, date, diagnosis, stage or score that
  is not written there; a suspicion stays a suspicion. If something important is missing, you may say
  it is not stated ("není uvedeno"), nothing more.
- No treatment advice and no conclusions of your own: deciding is the MDT's job.
- Write in Czech, in plain text without Markdown.
"""

EPICRISIS_SUMMARY = (
    """\
You help an oncology centre coordinator prepare a case for a multidisciplinary tumour board (MDT).
Write the epikríza for the MDT: a concise clinical summary of the case as known now, about 150 to 250
words. Order: the patient (age, sex), the history and symptoms with their onset, relevant
comorbidities and medication, the examinations and their key results in date order, histology, and
the current diagnosis. The coordinator will edit and confirm it.
"""
    + DRAFT_RULES
)

MDT_QUESTION = (
    """\
You help an oncology centre coordinator prepare a case for a multidisciplinary tumour board (MDT).
Write the request / question for the MDT ("Požadavek / otázka na MDT"): one to three short Czech
sentences saying what the MDT is asked to assess or decide, based on the diagnosis and the state of
the work-up. If the referring doctor's request is given, keep its intent. Mention missing information
only when it is listed among the open problems. The coordinator will edit it.
"""
    + DRAFT_RULES
)

RESULT_LINES = (
    """\
You help an oncology centre coordinator fill the results table of the MDT record ("Výsledky
stávajících vyšetření"). For each numbered row (date, examination, full result text) write one short
Czech line with the key findings of that result: sizes, extent, values outside the range, the
conclusion. Copy numbers, units and terms exactly as written. Return one line per row, by its index.
"""
    + DRAFT_RULES
)
