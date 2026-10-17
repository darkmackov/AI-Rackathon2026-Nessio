import { http, HttpResponse } from 'msw'
import type { Actor, Case, DraftKind, DraftResult, Handover, Job, MdtConclusion, MdtConclusionUpsert, MdtMember, MdtRecordUpdate, MdtResultRow, UploadResult } from '../client/types.gen'
import { supportedFile } from '../components/documents/document-utils'
import { actors, organizations } from './directory'
import type { createDemoState } from './handlers'
import { fail, object, readBody, BodyReader } from './coordinator-validation'
import { conclusionPrefill, lateDocuments, mdtRecord, resultRows, snapshotOf } from './mdt-state'
import { demoMdtPdf } from './mdt-pdf'
import { auditDate, conclusionSources, fields, mdtRecordLabels, transition } from './audit-text'

export const demoDraftText = 'FIKTIVNÍ NÁVRH AI – nejde o analýzu dokumentace. Text před použitím zkontrolujte a upravte.'
export const demoResultLine = 'FIKTIVNÍ JEDNOŘÁDKOVÝ VÝSLEDEK AI – zkontrolujte proti plnému textu.'
const conclusionStrings = ['presented_by', 'diagnosis_name', 'diagnosis_code', 'clinical_assessment', 'conclusion', 'place', 'chair'] as const
const recordDrafts: DraftKind[] = ['mdt_results', 'mdt_conclusion']

function members(value: unknown): MdtMember[] {
  if (!Array.isArray(value)) fail(422, 'invalid members')
  return value.map((row) => {
    if (!object(row) || typeof row.name !== 'string' || typeof row.specialty !== 'string' || row.actor_id != null && typeof row.actor_id !== 'string') fail(422, 'invalid member')
    return { name: row.name, specialty: row.specialty, actor_id: row.actor_id ?? null }
  })
}
function results(value: unknown): MdtResultRow[] {
  if (!Array.isArray(value)) fail(422, 'invalid results')
  return value.map((row) => {
    if (!object(row) || typeof row.date !== 'string' || typeof row.examination !== 'string' || typeof row.result !== 'string') fail(422, 'invalid result')
    const body = new BodyReader(row, ['date', 'examination', 'result']); body.date('date'); body.done()
    return { date: row.date, examination: row.examination, result: row.result }
  })
}

// Mirrors the backend's S5 rules (Q-F34–Q-F40) and its audit action names (api.md).
export function createMdtHandlers(state: ReturnType<typeof createDemoState>) {
  const store = state.mdt, now = () => state.clock().now
  const getCase = (id: string) => state.getCases().find((item) => item.id === id) ?? fail(404, 'case not found')
  function user(request: Request): Actor {
    const actor = actors.find((entry) => entry.id === request.headers.get('X-Actor-Id')) ?? fail(404, 'actor not found')
    if (actor.role !== 'coordinator') fail(403, 'only a coordinator of the case\'s KOC')
    return actor
  }
  function write(request: Request, item: Case) { const actor = user(request); if (actor.organization_id !== item.koc_id) fail(403, 'only a coordinator of the case\'s KOC'); return actor }
  // The record is edited only before the meeting; the conclusion until the feedback is sent (Q-F34).
  function recordWindow(item: Case) { if (item.state !== 'pripraveno_k_mdt') fail(409, `the MDT record can't be changed in state ${item.state}`) }
  function conclusionWindow(item: Case) { if (item.state !== 'pripraveno_k_mdt' && item.state !== 'zaver_mdt') fail(409, `the MDT conclusion can't be changed in state ${item.state}`) }
  const record = (id: string) => store.record(id) ?? fail(404, 'no MDT record yet')
  const conclusion = (id: string) => store.conclusion(id) ?? fail(404, 'no MDT conclusion yet')
  function audit(item: Case, actor: Actor, action: string, detail?: string) { state.coordinator.record(item.id, actor.id, now(), action, detail) }
  const pdf = (bytes: BodyInit, filename: string) => new HttpResponse(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` } })
  const route = (method: 'get' | 'post' | 'patch' | 'put', path: string, action: (request: Request, id: string) => Response | Promise<Response>) =>
    http[method](`*/api${path}`, async ({ request, params }) => { try { return await action(request, String(params.caseId ?? params.boardId)) } catch (error) { if (error instanceof Response) return error; throw error } })
  function draftFor(item: Case, kind: DraftKind): DraftResult {
    if (kind === 'mdt_conclusion') {
      const referrer = actors.find((actor) => actor.id === item.referring_doctor_id)
      return { kind, text: null, rows: [], fields: conclusionPrefill(record(item.id), organizations.find((org) => org.id === item.koc_id), referrer, organizations.find((org) => org.id === referrer?.organization_id)) }
    }
    if (kind === 'mdt_results') {
      const snapshot = store.snapshot(item.id) ?? fail(404, 'no snapshot')
      return { kind, text: null, rows: resultRows(snapshot).map((row) => ({ ...row, result: demoResultLine })), fields: null }
    }
    return { kind, text: demoDraftText, rows: [], fields: null }
  }
  return [
    http.get('*/api/mdt-boards', () => HttpResponse.json(store.boards())),
    route('get', '/mdt-boards/:boardId', (_request, id) => HttpResponse.json(store.boards().find((board) => board.id === id) ?? fail(404, 'MDT board not found'))),
    route('put', '/mdt-boards/:boardId/members', async (request, id) => {
      const board = store.boards().find((board) => board.id === id) ?? fail(404, 'MDT board not found'), actor = user(request)
      if (actor.organization_id !== board.organization_id) fail(403, 'only a coordinator of the board\'s KOC')
      const body = await readBody(request, ['members']); const value = members(body.value.members); body.done()
      const updated = { ...board, members: value }; store.saveBoard(updated); return HttpResponse.json(updated)
    }),
    route('get', '/cases/:caseId/mdt/record', (_request, id) => { getCase(id); return HttpResponse.json(record(id)) }),
    route('post', '/cases/:caseId/mdt/snapshot', async (request, id) => {
      const item = getCase(id), actor = write(request, item)
      const body = await readBody(request, ['board_id', 'mdt_date']), boardId = body.text('board_id', true), date = body.date('mdt_date'); if (!date) body.bad('mdt_date'); body.done()
      if (!date) fail(422, 'MDT date required')
      const board = store.boards().find((entry) => entry.id === boardId) ?? fail(400, 'unknown MDT board')
      if (item.state !== 'kompletni') fail(409, `the MDT input is prepared from kompletni, not ${item.state}`)
      if (board.organization_id !== item.koc_id) fail(400, 'not an MDT board of the case\'s KOC')
      const live = state.documents.result(id) ?? fail(404, 'no handover yet')
      const pending = state.documents.listJobs(id, now()).filter((job) => job.kind === 'ingest_document' && (job.status === 'queued' || job.status === 'running'))
      if (pending.length) fail(409, `documents still processing: ${pending.map((job) => job.id).join(', ')}`)
      const blockers = live.findings.filter((finding) => finding.severity === 'blocker' && !finding.resolved)
      if (blockers.length) fail(409, `unresolved blockers: ${blockers.map((finding) => finding.id).join(', ')}`)
      const late = lateDocuments(live.handover, state.documents.list(id), date)
      if (late.length) fail(409, `the handover uses documents received after ${date}: ${late.join(', ')}`)
      const stamp = { by: actor.id, at: now() }
      const frozen = snapshotOf(live.handover, date, stamp)
      const value = mdtRecord(frozen, board, actors.find((entry) => entry.id === item.referring_doctor_id), stamp, item.patient_name)
      store.saveSnapshot(frozen); store.saveRecord(value)
      state.saveCase({ ...item, state: 'pripraveno_k_mdt', mdt_board_id: board.id, mdt_date: date }); state.coordinator.sync(id)
      audit(item, actor, 'mdt_snapshot_created', `${transition(item.state, 'pripraveno_k_mdt')}, MDT ${auditDate(date)} (${board.name})`)
      return HttpResponse.json(value, { status: 201 })
    }),
    route('patch', '/cases/:caseId/mdt/record', async (request, id) => {
      const item = getCase(id), actor = write(request, item), original = record(id); recordWindow(item)
      const body = await readBody(request, ['members', 'results', 'mdt_question', 'diagnosis_name', 'diagnosis_code', 'comorbidities'])
      const patch: MdtRecordUpdate = {}
      for (const key of ['mdt_question', 'diagnosis_name', 'diagnosis_code'] as const) if (key in body.value) patch[key] = body.text(key)
      if ('members' in body.value) patch.members = members(body.value.members)
      if ('results' in body.value) patch.results = results(body.value.results)
      if ('comorbidities' in body.value) patch.comorbidities = body.list('comorbidities')
      body.done()
      const updated = { ...original, ...patch, members: patch.members ?? original.members, results: patch.results ?? original.results, comorbidities: patch.comorbidities ?? original.comorbidities }
      store.saveRecord(updated); audit(item, actor, 'mdt_record_updated', fields(['members', 'results', 'mdt_question', 'diagnosis_name', 'diagnosis_code', 'comorbidities'].filter((key) => key in patch), mdtRecordLabels)); return HttpResponse.json(updated)
    }),
    route('get', '/cases/:caseId/mdt/conclusion', (_request, id) => { getCase(id); return HttpResponse.json(conclusion(id)) }),
    route('get', '/cases/:caseId/mdt/record.pdf', (_request, id) => { getCase(id); record(id); return pdf(demoMdtPdf(), `mdt-zapis-${id}.pdf`) }),
    route('get', '/cases/:caseId/mdt/conclusion.pdf', async (_request, id) => {
      getCase(id); const value = conclusion(id)
      // An uploaded PDF report is served as it is, like the backend; anything else is the labelled fixture.
      if (value.source === 'uploaded' && value.document_id) {
        const original = await state.documents.original(value.document_id)
        if (original && original.type === 'application/pdf') return pdf(await original.arrayBuffer(), original.name)
      }
      return pdf(demoMdtPdf(), `mdt-zaver-${id}.pdf`)
    }),
    route('put', '/cases/:caseId/mdt/conclusion', async (request, id) => {
      const item = getCase(id), actor = write(request, item); conclusionWindow(item)
      const body = await readBody(request, [...conclusionStrings, 'date', 'recommendations', 'copy_to', 'ai_draft_used']), patch: MdtConclusionUpsert = {}
      for (const key of conclusionStrings) if (key in body.value) patch[key] = body.text(key)
      patch.date = body.date('date'); patch.recommendations = body.list('recommendations'); patch.copy_to = body.list('copy_to'); patch.ai_draft_used = body.flag('ai_draft_used'); body.done()
      // An uploaded report stays the source; its fields are typed in from it (Q-F38). Any change needs a new confirmation.
      const existing = store.conclusion(id), uploaded = existing?.source === 'uploaded'
      const updated: MdtConclusion = { case_id: id, ...patch, source: uploaded ? 'uploaded' : 'written', document_id: uploaded ? existing.document_id ?? null : null, confirmed: null }
      store.saveConclusion(updated)
      audit(item, actor, 'mdt_conclusion_saved', conclusionSources[updated.source ?? 'written'] + (existing?.confirmed ? ', potvrzení zrušeno' : ''))
      return HttpResponse.json(updated)
    }),
    route('post', '/cases/:caseId/mdt/conclusion/confirm', (request, id) => {
      const item = getCase(id), actor = write(request, item), current = conclusion(id); conclusionWindow(item)
      if (current.source === 'uploaded' ? !current.document_id : !current.conclusion?.trim()) fail(409, current.source === 'uploaded' ? 'the uploaded MDT report is missing' : 'the conclusion has no text')
      const stamp = { by: actor.id, at: now() }, value: MdtConclusion = { ...current, confirmed: stamp }
      store.saveConclusion(value)
      // The definitive diagnosis goes into the live handover as a manual value; findings are resolved explicitly (Q-F36).
      const live = state.documents.result(id)
      if (live) {
        const manual = (text: string): NonNullable<Handover['diagnosis']> => ({ status: 'found', origin: 'manual', value: text, evidence: [], entered: stamp, note: 'Definitivní kód ze závěru MDT' })
        state.documents.saveResult(id, { ...live, handover: { ...live.handover,
          ...(value.diagnosis_name ? { diagnosis: manual(value.diagnosis_name) } : {}), ...(value.diagnosis_code ? { diagnosis_code: manual(value.diagnosis_code) } : {}) } })
      }
      const held = value.date ?? item.mdt_date ?? now().slice(0, 10)
      state.saveCase({ ...item, state: 'zaver_mdt', diagnosis_label: value.diagnosis_name ?? item.diagnosis_label, milestones: { ...item.milestones, mdt_held: held } }); state.coordinator.sync(id)
      audit(item, actor, 'mdt_conclusion_confirmed', transition(item.state, 'zaver_mdt') + (value.diagnosis_code ? `, definitivní kód ${value.diagnosis_code}` : ''))
      return HttpResponse.json(value)
    }),
    route('post', '/cases/:caseId/drafts', async (request, id) => {
      const item = getCase(id); write(request, item)
      const body = await readBody(request, ['kind']); body.text('kind', true)
      const kinds: DraftKind[] = ['epicrisis_summary', 'mdt_question', 'mdt_results', 'mdt_conclusion'], kind = body.pick('kind', kinds, 'epicrisis_summary'); body.done()
      if (recordDrafts.includes(kind) && !store.record(id)) fail(409, 'no MDT record yet: prepare the MDT input first')
      // Drafts change nothing on the case and are not audited (Q-F37).
      const job: Job = { id: state.coordinator.id('draft'), case_id: id, kind: 'draft', params: { kind }, status: 'queued', created_at: now() }
      return HttpResponse.json(store.addJob(job, { draft: draftFor(item, kind) }), { status: 202 })
    }),
    route('post', '/cases/:caseId/mdt/conclusion/upload', async (request, id) => {
      const item = getCase(id), actor = write(request, item); conclusionWindow(item)
      const form = await request.formData(), file = form.get('file'), received = form.get('received_at')
      if (!file || typeof file === 'string' || !supportedFile(file)) fail(415, 'supported files: .docx, .pptx, .pdf')
      const body = new BodyReader({ received_at: received }, ['received_at']), receivedAt = body.date('received_at', true); body.done()
      // A case document like any upload, with the normal ingest job; the conclusion keeps its typed fields (Q-F38).
      const upload = state.documents.upload(id, file, actor.id, receivedAt ?? now(), now())
      const document = state.documents.update(upload.document.id, { doc_type: 'mdt_conclusion' }) ?? upload.document
      const existing = store.conclusion(id)
      store.saveConclusion({ ...existing, case_id: id, source: 'uploaded', document_id: document.id, confirmed: null })
      audit(item, actor, 'document_uploaded', document.filename); audit(item, actor, 'mdt_conclusion_uploaded', document.filename)
      return HttpResponse.json<UploadResult>({ document, job: upload.job }, { status: 201 })
    }),
    http.get('*/api/jobs/:jobId', ({ params }) => { const value = store.job(String(params.jobId), now()); return value && HttpResponse.json(value) }),
    route('get', '/cases/:caseId/jobs', (_request, id) => { getCase(id); return HttpResponse.json([...state.documents.listJobs(id, now()), ...store.jobs(id)]) }),
    http.get('*/api/cases/:caseId/handover', ({ request, params }) => {
      const snapshot = new URL(request.url).searchParams.get('snapshot')
      if (snapshot !== 'true') return undefined
      const value = store.snapshot(String(params.caseId)); return value ? HttpResponse.json<Handover>(value) : HttpResponse.json({ detail: 'no handover yet' }, { status: 404 })
    }),
  ]
}
