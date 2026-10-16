import type { Evidence, Handover, SourcedDate, SourcedFloat, SourcedInt, SourcedListStr, SourcedStr } from '../../client/types.gen'

export type SourcedValue = SourcedDate | SourcedFloat | SourcedInt | SourcedListStr | SourcedStr
// UI selection addresses Query data; it never copies a clinical response into local state.
export type SourceSelection = { documentId: string } | { kind: 'field'; path: string; index: number } | { kind: 'examination'; row: number; index: number } | { kind: 'lab'; row: number; index: number } | { kind: 'finding'; id: string; index: number }

export const patientFields = { first_name: 'firstName', last_name: 'lastName', birth_number: 'birthNumber', birth_date: 'birthDate', age: 'age', sex: 'sex', insurance_code: 'insurer', address: 'address' } satisfies Record<keyof NonNullable<Handover['patient']>, string>
export const contactFields = { patient_phone: 'patientPhone', patient_email: 'patientEmail', contact_person: 'contactPerson', contact_person_phone: 'contactPhone' } satisfies Record<keyof NonNullable<Handover['contacts']>, string>
export const historyFields = { comorbidities: 'comorbidities', medications: 'medications', allergies: 'allergies', performance_status: 'performance', weight_kg: 'weight', height_cm: 'height', symptoms: 'symptoms' }

export function handoverFields(handover: Handover): Record<string, SourcedValue | undefined> {
  return {
    ...Object.fromEntries(Object.entries(handover.patient ?? {}).map(([key, value]) => [`patient.${key}`, value])),
    ...Object.fromEntries(Object.entries(handover.contacts ?? {}).map(([key, value]) => [`contacts.${key}`, value])),
    diagnosis: handover.diagnosis, diagnosis_code: handover.diagnosis_code, epicrisis_source: handover.epicrisis_source, epicrisis: handover.epicrisis, mdt_question: handover.mdt_question,
    comorbidities: handover.comorbidities, medications: handover.medications, allergies: handover.allergies, performance_status: handover.performance_status,
    weight_kg: handover.weight_kg, height_cm: handover.height_cm, symptoms: handover.symptoms, histology: handover.histology, other: handover.other
  }
}

export type HandoverSection = { key: string; fields: [path: string, label: string][] }
// Examinations and labs are lists without a Sourced status, so they carry no fields here.
export const handoverSections: HandoverSection[] = [
  { key: 'patient', fields: Object.entries(patientFields).map(([key, label]) => [`patient.${key}`, label]) },
  { key: 'contacts', fields: Object.entries(contactFields).map(([key, label]) => [`contacts.${key}`, label]) },
  { key: 'diagnosis', fields: [['diagnosis', 'diagnosis'], ['diagnosis_code', 'diagnosisCode']] },
  { key: 'epicrisis', fields: [['epicrisis_source', 'epicrisisSource'], ['epicrisis', 'epicrisis']] },
  { key: 'mdtQuestion', fields: [['mdt_question', 'mdtQuestion']] },
  { key: 'history', fields: Object.entries(historyFields) },
  { key: 'examinations', fields: [] },
  { key: 'labs', fields: [] },
  { key: 'histology', fields: [['histology', 'histology']] },
  { key: 'other', fields: [['other', 'other']] },
]

export function sectionOf(path: string) {
  return handoverSections.find((section) => section.fields.some(([field]) => field === path))
}

export function problemCount(fields: Record<string, SourcedValue | undefined>, section: HandoverSection) {
  return section.fields.filter(([path]) => (fields[path]?.status ?? 'missing') !== 'found').length
}

export function problemSections(handover: Handover) {
  const fields = handoverFields(handover)
  return handoverSections.filter((section) => problemCount(fields, section) > 0).map((section) => section.key)
}

export function displayValue(value: SourcedValue['value']) {
  return Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value)
}

export function quoteSegments(text: string, evidence?: Evidence): { text: string; highlight: boolean }[] {
  if (!evidence?.quote) return [{ text, highlight: false }]
  const characters = Array.from(text)
  const { start, end, quote } = evidence
  const exactOffset = start != null && end != null && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= characters.length && characters.slice(start, end).join('') === quote
  if (exactOffset) return [
    { text: characters.slice(0, start).join(''), highlight: false },
    { text: quote, highlight: true },
    { text: characters.slice(end).join(''), highlight: false },
  ]
  const parts: { text: string; highlight: boolean }[] = []
  let cursor = 0
  let index = text.indexOf(quote)
  while (index !== -1) {
    parts.push({ text: text.slice(cursor, index), highlight: false }, { text: quote, highlight: true })
    cursor = index + quote.length
    index = text.indexOf(quote, cursor)
  }
  parts.push({ text: text.slice(cursor), highlight: false })
  return parts
}
