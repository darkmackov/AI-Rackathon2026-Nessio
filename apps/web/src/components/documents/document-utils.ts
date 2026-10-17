import type { DocumentType, DraftResult, Job } from '../../client/types.gen'

// These MIME types are registered in onko_documents.service.PARSERS.
export const documentFormats = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
export const documentAccept = Object.entries(documentFormats).flatMap(([extension, mime]) => [`.${extension}`, mime]).join(',')

export const documentTypes = {
  referral: true, epicrisis: true, outpatient_report: true, lab: true, imaging: true,
  procedure: true, histology: true, mdt_record: true, mdt_conclusion: true, other: true,
} satisfies Record<DocumentType, true>

export function documentType(value: string): DocumentType | null {
  return Object.keys(documentTypes).find((key): key is DocumentType => key === value) ?? null
}

export function uploadMime(file: File) {
  return Object.entries(documentFormats).find(([extension]) => file.name.toLowerCase().endsWith(`.${extension}`))?.[1]
}

export function supportedFile(file: File) {
  const mime = uploadMime(file)
  return !!mime && (!file.type || file.type === 'application/octet-stream' || file.type === mime)
}

export function terminalJob(job: Job) {
  return job.status === 'done' || job.status === 'failed'
}

export function usableDraft(draft: DraftResult | null | undefined, kind: unknown): draft is DraftResult {
  if (!draft || draft.kind !== kind) return false
  if (draft.kind === 'mdt_conclusion') return !!draft.fields
  if (draft.kind === 'mdt_results') return true
  return typeof draft.text === 'string' && draft.text.length > 0
}

export function validDocumentDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1 && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value
}
