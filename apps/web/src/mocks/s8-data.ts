import type { Case, DocumentMeta, Evidence, Finding, Handover } from '../client/types.gen'
import { ct, histology, lab } from './s8-source-texts'

// An explicitly labelled S8 variant using canonical reference-2 source text. No canonical
// patient or existing S0–S6 fixture is changed; only this variant deliberately omits its code.
export const s8Case: Case = {
  id: 'demo-s8', patient_name: 'Miroslav Havlíček (demo S8)', diagnosis_label: 'Adenokarcinom rekta – ukázka S8',
  koc_id: 'koc2-lipova', coordinator_id: 'koordinator', referring_doctor_id: 'pl-novakova',
  state: 'v_triage', queue: 'novy', priority: 'normal', created_at: '2026-10-01T10:00:00',
  on_move: 'koordinator', next_step: 'Zkontrolovat podklady a doplnit MKN-10', milestones: { referred_at: '2026-10-01T10:00:00' },
}

export const s8Documents: DocumentMeta[] = [
  { id: 'demo-s8-ct', case_id: s8Case.id, filename: '07_CT_KOC_2026-10-09.md', title: 'CT hrudníku a břicha (demo S8)', doc_type: 'imaging', document_date: '2026-10-09', received_at: '2026-10-09T15:00:00', mime_type: 'text/markdown' },
  { id: 'demo-s8-histology', case_id: s8Case.id, filename: '05_Histologie_2026-09-21.md', title: 'Bioptický nález (demo S8)', doc_type: 'histology', document_date: '2026-09-21', received_at: '2026-10-01T10:00:00', mime_type: 'text/markdown' },
  { id: 'demo-s8-lab', case_id: s8Case.id, filename: '08_Laborator_KOC_2026-10-14.md', title: 'Laboratorní výsledky (demo S8)', doc_type: 'lab', document_date: '2026-10-14', received_at: '2026-10-14T13:00:00', mime_type: 'text/markdown' },
]
export const s8Texts: Record<string, string> = { 'demo-s8-ct': ct.replace(/\r\n/g, '\n'), 'demo-s8-histology': histology.replace(/\r\n/g, '\n'), 'demo-s8-lab': lab.replace(/\r\n/g, '\n') }

export function demoEvidence(documentId: string, text: string, quote: string): Evidence {
  const position = text.indexOf(quote)
  if (position < 0) throw new Error('Demo quote must exist verbatim in its source')
  const start = Array.from(text.slice(0, position)).length
  return { document_id: documentId, quote, start, end: start + Array.from(quote).length }
}
const diagnosis = 'Adenokarcinom rekta, středně diferencovaný (G2), MMR proficientní (pMMR).'
const diagnosisEvidence = demoEvidence('demo-s8-histology', s8Texts['demo-s8-histology'], diagnosis)
const identity = demoEvidence('demo-s8-ct', s8Texts['demo-s8-ct'], 'Pacient: Miroslav Havlíček')
export const s8Handover: Handover = {
  case_id: s8Case.id, as_of: '2026-10-21',
  patient: {
    first_name: { value: 'Miroslav', status: 'found', origin: 'ai', evidence: [identity] },
    last_name: { value: 'Havlíček', status: 'found', origin: 'ai', evidence: [identity] },
  },
  diagnosis: { value: diagnosis, status: 'found', origin: 'ai', evidence: [diagnosisEvidence] },
  diagnosis_code: { value: null, status: 'missing', origin: 'ai', evidence: [], note: 'Fiktivní varianta S8: kód je záměrně ponechán k ručnímu výběru.' },
  histology: { value: diagnosis, status: 'found', origin: 'ai', evidence: [diagnosisEvidence] },
}
export const s8Findings: Finding[] = [
  { id: 'demo-s8-code', kind: 'missing', severity: 'warning', fields: ['diagnosis_code'], message_cs: 'Ukázka S8: u diagnózy chybí kód MKN-10.', suggested_action: 'fill_in', resolved: false },
  { id: 'demo-s8-quote', kind: 'unverified_quote', severity: 'warning', message_cs: 'Ukázka S8: původní AI citaci nebylo možné ověřit.', evidence: [diagnosisEvidence], suggested_action: 'review', resolved: false },
]
