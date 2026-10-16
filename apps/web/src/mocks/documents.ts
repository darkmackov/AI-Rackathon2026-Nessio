import { delay, http, HttpResponse } from 'msw'
import type { Case, DemoClock, DocumentMeta, DocumentMetaUpdate, Finding, Handover, Job, UploadResult } from '../client/types.gen'
import { documentType, supportedFile, validDocumentDate } from '../components/documents/document-utils'
import { actors } from './directory'
import { referenceDocuments, referenceFindings, referenceHandover, referenceTexts } from './reference-data'
import { extraFields, isApiDateTime, objectBody, queryValue, validationResponse } from './validation'

// Explicitly synthetic content. Uploaded bytes are retained only for original-file downloads;
// no parser, clinical inference or AI runs in the browser. The user authorized S2 HTTP fixtures.
// The reference scenario seeds the canonical S1 documents, texts and extraction result.
export const demoDocumentText = 'FIKTIVNÍ UKÁZKA – nejde o text nahraného souboru.\nV ukázkové zprávě je uvedena únava.\nHmotnost v podkladu A: 65 kg.\nHmotnost v podkladu B: 67 kg.\nECOG v ukázce není uvedeno.'

export function demoExtraction(caseId: string, documentId: string, asOf: string): { handover: Handover; findings: Finding[] } {
  const evidence = (quote: string) => ({ document_id: documentId, quote, start: demoDocumentText.indexOf(quote), end: demoDocumentText.indexOf(quote) + quote.length })
  const missing = { status: 'missing', origin: 'ai', value: null } satisfies NonNullable<Handover['diagnosis']>
  const weights = [evidence('Hmotnost v podkladu A: 65 kg.'), evidence('Hmotnost v podkladu B: 67 kg.')]
  return {
    handover: {
      case_id: caseId, as_of: asOf.slice(0, 10),
      patient: { first_name: missing, last_name: missing, birth_number: missing, birth_date: missing, age: missing, sex: missing, insurance_code: missing, address: missing },
      contacts: { patient_phone: missing, patient_email: missing, contact_person: missing, contact_person_phone: missing },
      diagnosis: missing, diagnosis_code: missing, epicrisis_source: missing, epicrisis: missing, mdt_question: missing,
      comorbidities: missing, medications: missing, allergies: missing, performance_status: missing,
      weight_kg: { status: 'conflict', origin: 'ai', value: null, evidence: weights, note: 'Fiktivní ukázka rozporu: 65 kg a 67 kg. Správnou hodnotu musí posoudit člověk.' },
      height_cm: missing,
      symptoms: { status: 'found', origin: 'ai', value: 'V ukázkové zprávě je uvedena únava.', evidence: [evidence('V ukázkové zprávě je uvedena únava.')] },
      histology: missing, other: missing, examinations: [], labs: [], validated_by_referrer: null, confirmed_by_coordinator: null,
    },
    findings: [
      { id: `${caseId}-demo-missing`, kind: 'missing', severity: 'blocker', fields: ['performance_status'], message_cs: 'Fiktivní ukázka: chybí ECOG / Karnofsky.', evidence: [evidence('ECOG v ukázce není uvedeno.')], overridable: true, suggested_action: 'fill_in', advisory: false, resolved: false },
      { id: `${caseId}-demo-conflict`, kind: 'conflict', severity: 'warning', fields: ['weight_kg'], message_cs: 'Fiktivní ukázka: podklady uvádějí rozdílnou hmotnost. Zkontrolujte oba zdroje.', evidence: weights, suggested_action: 'review', advisory: false, resolved: false },
    ],
  }
}

export function createDocumentDemoState(readNow: () => number = Date.now) {
  const documents = new Map<string, DocumentMeta>()
  const originals = new Map<string, File>()
  const jobs = new Map<string, { job: Job; started: number }>()
  const results = new Map<string, ReturnType<typeof demoExtraction>>()
  const texts = new Map<string, string>()
  let sequence = 0

  function createJob(caseId: string, now: string, documentId?: string): Job {
    const job: Job = { id: `demo-job-${++sequence}`, kind: 'ingest_document', case_id: caseId, document_id: documentId ?? null, status: 'queued', created_at: now }
    jobs.set(job.id, { job, started: readNow() })
    return structuredClone(job)
  }

  function readJob(id: string, now: string) {
    const entry = jobs.get(id)
    if (!entry) return undefined
    const elapsed = readNow() - entry.started
    if (entry.job.status === 'queued' && elapsed >= 1000) entry.job = { ...entry.job, status: 'running', started_at: now }
    if (entry.job.status === 'running' && elapsed >= 3000) {
      entry.job = { ...entry.job, status: 'done', finished_at: now }
      const source = entry.job.document_id ?? Array.from(documents.values()).findLast((item) => item.case_id === entry.job.case_id)?.id
      // A synthetic result never replaces one the case already has (such as the reference extraction).
      if (source && !results.has(entry.job.case_id)) {
        results.set(entry.job.case_id, demoExtraction(entry.job.case_id, source, now))
        const document = documents.get(source)
        if (document && !document.title) documents.set(source, { ...document, title: 'Fiktivní ukázka dokumentu', doc_type: 'other' })
      }
    }
    return structuredClone(entry.job)
  }

  return {
    reset: (withReference: boolean) => {
      documents.clear(); originals.clear(); jobs.clear(); results.clear(); texts.clear()
      if (!withReference) return
      for (const document of referenceDocuments) {
        documents.set(document.id, structuredClone(document))
        texts.set(document.id, referenceTexts[document.id])
      }
      results.set(referenceHandover.case_id, { handover: structuredClone(referenceHandover), findings: structuredClone(referenceFindings) })
    },
    upload: (caseId: string, file: File, actorId: string, receivedAt: string, now: string): UploadResult => {
      const document: DocumentMeta = { id: `demo-document-${++sequence}`, case_id: caseId, filename: file.name, mime_type: file.type, received_at: receivedAt, uploaded_by: actorId }
      documents.set(document.id, document)
      originals.set(document.id, file)
      return { document: structuredClone(document), job: createJob(caseId, now, document.id) }
    },
    createJob,
    readJob,
    listJobs: (caseId: string, now: string) => Array.from(jobs.keys()).map((id) => readJob(id, now)).filter((job): job is Job => !!job && job.case_id === caseId),
    list: (caseId: string) => structuredClone(Array.from(documents.values()).filter((item) => item.case_id === caseId)),
    get: (id: string) => { const document = documents.get(id); return document ? structuredClone(document) : undefined },
    update: (id: string, body: DocumentMetaUpdate) => {
      const document = documents.get(id)
      if (!document) return undefined
      const updated: DocumentMeta = { ...document, ...body, doc_type: body.doc_type ?? document.doc_type }
      documents.set(id, updated)
      return structuredClone(updated)
    },
    text: (id: string) => texts.get(id) ?? demoDocumentText,
    original: async (id: string): Promise<File | undefined> => {
      const uploaded = originals.get(id)
      const reference = referenceDocuments.find((item) => item.id === id)
      if (uploaded || !reference || !documents.has(id)) return uploaded
      const { originalFiles } = await import('./document-files')
      const bytes = Uint8Array.from(atob(originalFiles[id]), (character) => character.charCodeAt(0))
      return new File([bytes], reference.filename, { type: 'application/octet-stream' })
    },
    result: (caseId: string) => { const value = results.get(caseId); return value ? structuredClone(value) : undefined },
  }
}

type DemoState = { getCases: () => Case[]; clock: () => DemoClock; documents: ReturnType<typeof createDocumentDemoState> }

function access(request: Request, item: Case | undefined, write = false) {
  if (!item) return HttpResponse.json({ detail: 'case not found' }, { status: 404 })
  const id = request.headers.get('X-Actor-Id')
  if (!id && !write) return null
  if (id === null) return validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
  const actor = actors.find((entry) => entry.id === id)
  if (!actor) return HttpResponse.json({ detail: 'actor not found' }, { status: 404 })
  if (!(actor.role === 'coordinator' && actor.organization_id === item.koc_id) && !(actor.role === 'referring_doctor' && actor.id === item.referring_doctor_id)) return HttpResponse.json({ detail: 'wrong role' }, { status: 403 })
  if (write && actor.role === 'referring_doctor' && item.state !== 'koncept' && item.state !== 'vraceno_lekari') return HttpResponse.json({ detail: 'referral is not editable' }, { status: 409 })
  return null
}

export function createDocumentHandlers(state: DemoState) {
  const findCase = (id: string) => state.getCases().find((item) => item.id === id)
  const findDocumentCase = (id: string) => findCase(state.documents.get(id)?.case_id ?? '')
  return [
    http.get('*/api/cases/:caseId/documents', ({ request, params }) => {
      const id = String(params.caseId)
      state.documents.listJobs(id, state.clock().now)
      // Like the API, a list for an unknown case is empty rather than missing.
      if (!findCase(id)) return HttpResponse.json<DocumentMeta[]>([])
      return access(request, findCase(id)) ?? HttpResponse.json<DocumentMeta[]>(state.documents.list(id))
    }),
    http.post('*/api/cases/:caseId/documents', async ({ request, params }) => {
      const id = String(params.caseId)
      const error = access(request, findCase(id), true)
      if (error) return error
      let form: FormData
      try { form = await request.formData() } catch { return HttpResponse.json({ detail: 'invalid multipart' }, { status: 400 }) }
      const file = form.get('file')
      const receivedAt = form.get('received_at')
      if (file === null || typeof file === 'string') return validationResponse([{ loc: ['body', 'file'], type: 'missing', msg: 'File required' }])
      if (!supportedFile(file)) return HttpResponse.json({ detail: 'unsupported document format' }, { status: 400 })
      if (receivedAt !== null && (typeof receivedAt !== 'string' || !isApiDateTime(receivedAt))) return validationResponse([{ loc: ['body', 'received_at'], type: 'datetime_parsing', msg: 'Invalid datetime' }])
      await delay(150)
      const now = state.clock().now
      return HttpResponse.json<UploadResult>(state.documents.upload(id, file, request.headers.get('X-Actor-Id') ?? '', typeof receivedAt === 'string' ? receivedAt : now, now), { status: 201 })
    }),
    http.get('*/api/cases/:caseId/jobs', ({ request, params }) => {
      const id = String(params.caseId)
      return access(request, findCase(id)) ?? HttpResponse.json<Job[]>(state.documents.listJobs(id, state.clock().now))
    }),
    http.get('*/api/jobs/:jobId', ({ request, params }) => {
      const job = state.documents.readJob(String(params.jobId), state.clock().now)
      return access(request, job ? findCase(job.case_id) : undefined) ?? HttpResponse.json<Job>(job!)
    }),
    http.post('*/api/cases/:caseId/extract', ({ request, params }) => {
      const id = String(params.caseId)
      const error = access(request, findCase(id), true)
      if (error) return error
      if (!state.documents.list(id).length) return HttpResponse.json({ detail: 'no documents' }, { status: 409 })
      return HttpResponse.json<Job>(state.documents.createJob(id, state.clock().now), { status: 202 })
    }),
    http.patch('*/api/documents/:documentId', async ({ request, params }) => {
      const id = String(params.documentId)
      const error = access(request, findDocumentCase(id), true)
      if (error) return error
      const parsed = await objectBody(request)
      if (!parsed.value) return validationResponse(parsed.errors)
      const value = parsed.value
      const fields = ['title', 'document_date', 'facility', 'department', 'author', 'ordered_by'] satisfies Array<keyof DocumentMetaUpdate>
      const errors = extraFields(value, [...fields, 'doc_type'])
      const body: DocumentMetaUpdate = {}
      for (const key of fields) {
        if (!(key in value)) continue
        const field = value[key]
        if (typeof field === 'string' || field === null) body[key] = field
        else errors.push({ loc: ['body', key], type: 'string_type', msg: 'Input should be a valid string' })
      }
      if (body.document_date && !validDocumentDate(body.document_date)) errors.push({ loc: ['body', 'document_date'], type: 'date_parsing', msg: 'Invalid date' })
      if ('doc_type' in value) {
        const type = typeof value.doc_type === 'string' ? documentType(value.doc_type) : null
        if (value.doc_type === null || type) body.doc_type = type
        else errors.push({ loc: ['body', 'doc_type'], type: 'enum', msg: 'Invalid document type' })
      }
      if (errors.length) return validationResponse(errors)
      return HttpResponse.json<DocumentMeta>(state.documents.update(id, body)!)
    }),
    http.get('*/api/documents/:documentId/text', ({ request, params }) => {
      const id = String(params.documentId)
      return access(request, findDocumentCase(id)) ?? HttpResponse.json({ id, text: state.documents.text(id) })
    }),
    http.get('*/api/documents/:documentId/file', async ({ request, params }) => {
      const id = String(params.documentId)
      const error = access(request, findDocumentCase(id))
      if (error) return error
      const file = await state.documents.original(id)
      if (!file) return HttpResponse.json({ detail: 'file not found' }, { status: 404 })
      return new HttpResponse(await file.arrayBuffer(), { headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    }),
    http.get('*/api/cases/:caseId/handover', ({ request, params }) => {
      const id = String(params.caseId)
      const snapshot = queryValue(new URL(request.url).searchParams, 'snapshot')
      if (snapshot !== null && !['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(snapshot.toLowerCase())) {
        return validationResponse([{ loc: ['query', 'snapshot'], type: 'bool_parsing', msg: 'Input should be a valid boolean', input: snapshot }])
      }
      const error = access(request, findCase(id))
      if (error) return error
      state.documents.listJobs(id, state.clock().now)
      // MDT snapshots are not simulated, so a snapshot request finds none.
      const result = ['true', '1', 'yes', 'on'].includes(snapshot?.toLowerCase() ?? '') ? undefined : state.documents.result(id)
      return result ? HttpResponse.json<Handover>(result.handover) : HttpResponse.json({ detail: 'no handover yet' }, { status: 404 })
    }),
    http.get('*/api/cases/:caseId/findings', ({ request, params }) => {
      const id = String(params.caseId)
      state.documents.listJobs(id, state.clock().now)
      if (!findCase(id)) return HttpResponse.json<Finding[]>([])
      return access(request, findCase(id)) ?? HttpResponse.json<Finding[]>(state.documents.result(id)?.findings ?? [])
    }),
  ]
}
