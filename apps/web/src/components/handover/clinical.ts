import type { Evidence, Handover, SourcedDate, SourcedFloat, SourcedInt, SourcedListStr, SourcedStr } from '../../client/types.gen'

export type SourcedValue = SourcedDate | SourcedFloat | SourcedInt | SourcedListStr | SourcedStr
// UI selection addresses Query data; it never copies a clinical response into local state.
export type SourceSelection = { documentId: string } | { kind: 'field'; path: string; index: number } | { kind: 'examination'; row: number; index: number } | { kind: 'lab'; row: number; index: number } | { kind: 'finding'; id: string; index: number }

export function sameSelection(a: SourceSelection | null, b: SourceSelection) {
  return !!a && JSON.stringify(a) === JSON.stringify(b)
}

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

// Display counts for the attention strip; the statuses come from the API as they are (WEB-6).
export function fieldStatusCounts(handover: Handover) {
  const fields = handoverFields(handover)
  const statuses = handoverSections.flatMap((section) => section.fields.map(([path]) => fields[path]?.status ?? 'missing'))
  return { missing: statuses.filter((status) => status === 'missing').length, conflict: statuses.filter((status) => status === 'conflict').length }
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

export type TextPiece = { text: string; highlight: boolean }
export type TextBlock = { kind: 'text'; pieces: TextPiece[] } | { kind: 'table'; header: TextPiece[][]; rows: TextPiece[][][] }

// Splits highlighted pieces wherever `separator` matches; each part keeps its highlight.
function splitPieces(pieces: TextPiece[], separator: RegExp): TextPiece[][] {
  const parts: TextPiece[][] = [[]]
  for (const piece of pieces) piece.text.split(separator).forEach((chunk, index) => {
    if (index > 0) parts.push([])
    if (chunk) parts[parts.length - 1].push({ text: chunk, highlight: piece.highlight })
  })
  return parts
}

const plain = (pieces: TextPiece[]) => pieces.map((piece) => piece.text).join('')
const tableRow = /^\s*\|.*\|\s*$/
const tableRule = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/
// Converters prepend `<!-- source: file -->`; it is metadata, not document text.
const htmlComment = /^\s*<!--.*-->\s*$/

// Strips `pattern` characters from both ends of the joined text, across piece boundaries.
function trimPieces(pieces: TextPiece[], pattern: RegExp): TextPiece[] {
  const leading = new RegExp(`^${pattern.source}+`)
  const trailing = new RegExp(`${pattern.source}+$`)
  const result = pieces.filter((piece) => piece.text)
  while (result.length && !(result[0] = { ...result[0], text: result[0].text.replace(leading, '') }).text) result.shift()
  while (result.length && !(result[result.length - 1] = { ...result[result.length - 1], text: result[result.length - 1].text.replace(trailing, '') }).text) result.pop()
  return result
}

function tableCells(line: TextPiece[]): TextPiece[][] {
  return splitPieces(line, /(?<!\\)\|/).slice(1, -1).map((cell) => trimPieces(cell.map((piece) => ({ ...piece, text: piece.text.replace(/\\\|/g, '|') })), /\s/))
}

// Document text keeps Word tables as Markdown tables (onko_documents); this turns them back into rows and cells and hides comment lines.
export function documentBlocks(segments: TextPiece[]): TextBlock[] {
  const lines = splitPieces(segments, /\n/)
  const blocks: TextBlock[] = []
  let text: TextPiece[][] = []
  const flush = () => {
    const pieces = trimPieces(text.flatMap((line, index) => index === 0 ? line : [{ text: '\n', highlight: false }, ...line]), /\n/)
    if (pieces.length) blocks.push({ kind: 'text', pieces })
    text = []
  }
  for (let index = 0; index < lines.length; index++) {
    if (htmlComment.test(plain(lines[index]))) continue
    if (!tableRow.test(plain(lines[index])) || !tableRule.test(plain(lines[index + 1] ?? []))) { text.push(lines[index]); continue }
    flush()
    const header = tableCells(lines[index])
    const rows: TextPiece[][][] = []
    for (index += 2; index < lines.length && tableRow.test(plain(lines[index])); index++) {
      const cells = tableCells(lines[index])
      rows.push([...cells, ...Array.from({ length: header.length - cells.length }, () => [])])
    }
    index--
    blocks.push({ kind: 'table', header, rows })
  }
  flush()
  return blocks
}
