import type { Actor, DocumentMeta, Handover, Job, MdtBoard, MdtConclusion, MdtRecord, Stamp } from '../client/types.gen'
import { boards } from './directory'
import type { SourcedValue } from '../components/handover/clinical'

// S5 demo server only. No extraction, snapshot building or clinical inference runs in screens.
export function handoverAt(handover: Handover, documents: DocumentMeta[], date: string, confirmed: Stamp): Handover {
  const included = new Set(documents.filter((document) => document.received_at && document.received_at.slice(0, 10) <= date).map((document) => document.id))
  function at<T extends { evidence?: { document_id: string }[]; entered?: Stamp | null }>(value: T | undefined): T | undefined {
    return value && (!value.entered || value.entered.at.slice(0, 10) <= date) && (value.evidence ?? []).every((source) => included.has(source.document_id)) ? value : undefined
  }
  const p = handover.patient, c = handover.contacts
  return { ...handover, as_of: date, confirmed_by_coordinator: confirmed,
    patient: { first_name: at(p?.first_name), last_name: at(p?.last_name), birth_number: at(p?.birth_number), birth_date: at(p?.birth_date), age: at(p?.age), sex: at(p?.sex), insurance_code: at(p?.insurance_code), address: at(p?.address) },
    contacts: { patient_phone: at(c?.patient_phone), patient_email: at(c?.patient_email), contact_person: at(c?.contact_person), contact_person_phone: at(c?.contact_person_phone) },
    diagnosis: at(handover.diagnosis), diagnosis_code: at(handover.diagnosis_code), epicrisis_source: at(handover.epicrisis_source), epicrisis: at(handover.epicrisis), mdt_question: at(handover.mdt_question),
    comorbidities: at(handover.comorbidities), medications: at(handover.medications), allergies: at(handover.allergies), performance_status: at(handover.performance_status),
    weight_kg: at(handover.weight_kg), height_cm: at(handover.height_cm), symptoms: at(handover.symptoms), histology: at(handover.histology), other: at(handover.other),
    examinations: handover.examinations?.filter((row) => row.date <= date && at(row)), labs: handover.labs?.filter((row) => row.date <= date && at(row)),
  }
}

export function mdtRecord(handover: Handover, board: MdtBoard, referrer: Actor | undefined, stamp: Stamp): MdtRecord {
  const p = handover.patient, c = handover.contacts
  function found<T extends SourcedValue>(field: T | undefined): T['value'] | null { return field?.status === 'found' ? field.value ?? null : null }
  return { case_id: handover.case_id, mdt_date: handover.as_of, board_id: board.id, members: structuredClone(board.members ?? []), created: stamp,
    patient_name: [found(p?.first_name), found(p?.last_name)].filter(Boolean).join(' ') || null,
    insurance_code: found(p?.insurance_code), patient_phone: found(c?.patient_phone), patient_email: found(c?.patient_email), patient_address: found(p?.address),
    weight_kg: found(handover.weight_kg), height_cm: found(handover.height_cm),
    referring_doctor_name: referrer?.name, referring_doctor_phone: referrer?.phone, referring_doctor_email: referrer?.email,
    diagnosis_name: found(handover.diagnosis), diagnosis_code: found(handover.diagnosis_code), comorbidities: found(handover.comorbidities) ?? [],
    results: (handover.examinations ?? []).map((row) => ({ date: row.date, examination: row.type, result: row.result_full_text })), mdt_question: found(handover.mdt_question),
  }
}

export function createMdtState(readNow: () => number) {
  const records = new Map<string, MdtRecord>(), snapshots = new Map<string, Handover>(), conclusions = new Map<string, MdtConclusion>(), teams = new Map<string, MdtBoard>()
  const jobs = new Map<string, { job: Job; output: Job['result']; start: number; finish: () => void }>()
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
    addJob: (job: Job, finish: () => void = () => {}) => { const queued = { ...job, result: null }; jobs.set(job.id, { job: structuredClone(queued), output: job.result, start: readNow(), finish }); return queued },
    job: (id: string, now: string) => {
      const entry = jobs.get(id)
      if (!entry) return undefined
      const elapsed = readNow() - entry.start
      if (entry.job.status === 'queued' && elapsed >= 1000) entry.job = { ...entry.job, status: 'running', started_at: now }
      if (entry.job.status === 'running' && elapsed >= 3000) { entry.finish(); entry.job = { ...entry.job, status: 'done', result: entry.output, finished_at: now } }
      return structuredClone(entry.job)
    },
    jobs: (caseId: string) => structuredClone([...jobs.values()].map((entry) => entry.job).filter((job) => job.case_id === caseId)),
  }
}
