import type { Actor, ConclusionPrefill, DocumentMeta, Handover, Job, MdtBoard, MdtConclusion, MdtRecord, MdtResultRow, Organization, Stamp } from '../client/types.gen'
import { boards } from './directory'
import type { SourcedValue } from '../components/handover/clinical'

// S5 demo server only. It mirrors the backend rules (onko_cases.mdt, Q-F34–Q-F40); no extraction,
// clinical inference or AI runs in screens.

/** The frozen copy of the live handover (Q-F39): nothing is filtered or re-extracted. */
export function snapshotOf(handover: Handover, date: string, confirmed: Stamp): Handover {
  return { ...structuredClone(handover), as_of: date, confirmed_by_coordinator: confirmed }
}

function quotedDocuments(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => quotedDocuments(item, found))
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'evidence' && Array.isArray(value)) value.forEach((source) => { if (source && typeof source === 'object' && 'document_id' in source) found.add(String(source.document_id)) })
      else quotedDocuments(value, found)
    }
  }
  return found
}

/** Documents received after `date` that the handover quotes; any of them stops the snapshot. */
export function lateDocuments(handover: Handover, documents: DocumentMeta[], date: string): string[] {
  const quoted = quotedDocuments(handover)
  return documents.filter((document) => document.received_at && document.received_at.slice(0, 10) > date && quoted.has(document.id)).map((document) => document.id).sort()
}

/** Section 5 before any one-liners (Q-F35): examinations verbatim, lab panels as printed, oldest first. */
export function resultRows(handover: Handover): MdtResultRow[] {
  const rows = [
    ...(handover.examinations ?? []).map((row) => ({ date: row.date, examination: row.type, result: row.result_full_text })),
    ...(handover.labs ?? []).map((panel) => ({ date: panel.date, examination: `Laboratoř, ${panel.place}`,
      result: panel.values.map((value) => { const text = [value.name, value.value, value.unit].filter(Boolean).join(' '); return value.flag ? `${text} (${value.flag})` : text }).join('; ') })),
  ]
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export function mdtRecord(handover: Handover, board: MdtBoard, referrer: Actor | undefined, stamp: Stamp, casePatientName: string): MdtRecord {
  const p = handover.patient, c = handover.contacts
  function found<T extends SourcedValue>(field: T | undefined): T['value'] | null { return field?.status === 'found' ? field.value ?? null : null }
  return { case_id: handover.case_id, mdt_date: handover.as_of, board_id: board.id, members: structuredClone(board.members ?? []), created: stamp,
    patient_name: [found(p?.first_name), found(p?.last_name)].filter(Boolean).join(' ') || casePatientName || null,
    insurance_code: found(p?.insurance_code), patient_phone: found(c?.patient_phone), patient_email: found(c?.patient_email), patient_address: found(p?.address),
    weight_kg: found(handover.weight_kg), height_cm: found(handover.height_cm),
    referring_doctor_name: referrer?.name ?? null, referring_doctor_phone: referrer?.phone ?? null, referring_doctor_email: referrer?.email ?? null,
    diagnosis_name: found(handover.diagnosis), diagnosis_code: found(handover.diagnosis_code), comorbidities: found(handover.comorbidities) ?? [],
    results: resultRows(handover), mdt_question: found(handover.mdt_question),
  }
}

/** The town after the postcode of a Czech address, like `onko_cases.town`. */
export function town(address: string | null | undefined): string | null {
  const last = address?.split(',').at(-1)?.trim()
  return last?.match(/\b\d{3}\s?\d{2}\s+(.+)$/)?.[1].trim() ?? null
}

/** The `mdt_conclusion` draft (Q-F37): not AI, only what restates the record. */
export function conclusionPrefill(record: MdtRecord, koc: Organization | undefined, referrer: Actor | undefined, practice: Organization | undefined): ConclusionPrefill {
  return { diagnosis_name: record.diagnosis_name ?? null, diagnosis_code: record.diagnosis_code ?? null, date: record.mdt_date, place: town(koc?.address),
    copy_to: referrer ? [[referrer.name, practice?.address].filter(Boolean).join(', ')] : [] }
}

export function createMdtState(readNow: () => number) {
  const records = new Map<string, MdtRecord>(), snapshots = new Map<string, Handover>(), conclusions = new Map<string, MdtConclusion>(), teams = new Map<string, MdtBoard>()
  const jobs = new Map<string, { job: Job; done: Partial<Job>; start: number }>()
  return {
    reset: () => { records.clear(); snapshots.clear(); conclusions.clear(); teams.clear(); jobs.clear(); for (const board of boards) teams.set(board.id, structuredClone(board)) },
    record: (id: string) => { const item = records.get(id); return item && structuredClone(item) },
    saveRecord: (item: MdtRecord) => records.set(item.case_id, structuredClone(item)),
    snapshot: (id: string) => { const item = snapshots.get(id); return item && structuredClone(item) },
    saveSnapshot: (item: Handover) => snapshots.set(item.case_id, structuredClone(item)),
    conclusion: (id: string) => { const item = conclusions.get(id); return item && structuredClone(item) },
    saveConclusion: (item: MdtConclusion) => conclusions.set(item.case_id, structuredClone(item)),
    boards: () => structuredClone([...teams.values()]),
    saveBoard: (item: MdtBoard) => teams.set(item.id, structuredClone(item)),
    /** A draft job: queued, running after 1 s, done after 3 s with `done` (e.g. its `draft`). */
    addJob: (job: Job, done: Partial<Job>) => { jobs.set(job.id, { job: structuredClone(job), done: structuredClone(done), start: readNow() }); return structuredClone(job) },
    job: (id: string, now: string) => {
      const entry = jobs.get(id)
      if (!entry) return undefined
      const elapsed = readNow() - entry.start
      if (entry.job.status === 'queued' && elapsed >= 1000) entry.job = { ...entry.job, status: 'running', started_at: now }
      if (entry.job.status === 'running' && elapsed >= 3000) entry.job = { ...entry.job, ...entry.done, status: 'done', finished_at: now }
      return structuredClone(entry.job)
    },
    jobs: (caseId: string) => structuredClone([...jobs.values()].map((entry) => entry.job).filter((job) => job.case_id === caseId)),
  }
}
