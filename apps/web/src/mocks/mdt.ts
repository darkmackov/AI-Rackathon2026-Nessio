import { http, HttpResponse } from 'msw'
import type { Actor, Case, DraftKind, Handover, MdtConclusion, MdtConclusionUpsert, MdtMember, MdtRecordUpdate, MdtResultRow, UploadResult } from '../client/types.gen'
import { supportedFile } from '../components/documents/document-utils'
import { actors } from './directory'
import type { createDemoState } from './handlers'
import { fail, object, readBody, BodyReader } from './coordinator-validation'
import { handoverAt, mdtRecord } from './mdt-state'
import { demoMdtPdf } from './mdt-pdf'

export const demoDraftText = 'FIKTIVNÍ NÁVRH AI – nejde o analýzu dokumentace. Text před použitím zkontrolujte a upravte.'
const conclusionStrings = ['presented_by', 'diagnosis_name', 'diagnosis_code', 'clinical_assessment', 'conclusion', 'place', 'chair'] as const

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

export function createMdtHandlers(state: ReturnType<typeof createDemoState>) {
  const store = state.mdt, now = () => state.clock().now
  const getCase = (id: string) => state.getCases().find((item) => item.id === id) ?? fail(404, 'case not found')
  function user(request: Request): Actor {
    const actor = actors.find((entry) => entry.id === request.headers.get('X-Actor-Id')) ?? fail(403, 'unknown actor')
    if (actor.role !== 'coordinator') fail(403, 'coordinator only')
    return actor
  }
  function write(request: Request, item: Case) { const actor = user(request); if (actor.organization_id !== item.koc_id) fail(403, 'wrong KOC'); return actor }
  function prepared(item: Case) { if (item.state !== 'pripraveno_k_mdt') fail(409, 'MDT is not editable') }
  const record = (id: string) => store.record(id) ?? fail(404, 'no MDT record')
  const conclusion = (id: string) => store.conclusion(id) ?? fail(404, 'no MDT conclusion')
  function audit(item: Case, actor: Actor, action: string) { state.coordinator.record(item.id, actor.id, now(), action) }
  const route = (method: 'get' | 'post' | 'patch' | 'put', path: string, action: (request: Request, id: string) => Response | Promise<Response>) =>
    http[method](`*/api${path}`, async ({ request, params }) => { try { return await action(request, String(params.caseId ?? params.boardId)) } catch (error) { if (error instanceof Response) return error; throw error } })
  return [
    http.get('*/api/mdt-boards', () => HttpResponse.json(store.boards())),
    route('get', '/mdt-boards/:boardId', (_request, id) => HttpResponse.json(store.boards().find((board) => board.id === id) ?? fail(404, 'board not found'))),
    route('put', '/mdt-boards/:boardId/members', async (request, id) => {
      const actor = user(request), board = store.boards().find((board) => board.id === id) ?? fail(404, 'board not found')
      if (actor.organization_id !== board.organization_id) fail(403, 'wrong KOC')
      const body = await readBody(request, ['members']); const value = members(body.value.members); body.done()
      const updated = { ...board, members: value }; store.saveBoard(updated); return HttpResponse.json(updated)
    }),
    route('get', '/cases/:caseId/mdt/record', (_request, id) => { getCase(id); return HttpResponse.json(record(id)) }),
    route('post', '/cases/:caseId/mdt/snapshot', async (request, id) => {
      const item = getCase(id), actor = write(request, item)
      if (item.state !== 'kompletni' || store.record(id)) fail(409, 'snapshot requires a complete case')
      const body = await readBody(request, ['board_id', 'mdt_date']), boardId = body.text('board_id', true), date = body.date('mdt_date'); if (!date) body.bad('mdt_date'); body.done()
      if (!date) fail(422, 'MDT date required')
      const board = store.boards().find((entry) => entry.id === boardId && entry.organization_id === item.koc_id) ?? fail(400, 'board not in this KOC')
      const live = state.documents.result(id) ?? fail(404, 'no handover')
      if (live.findings.some((finding) => finding.severity === 'blocker' && !finding.resolved && finding.resolution?.kind !== 'overridden')) fail(409, 'unresolved blockers')
      if (state.documents.listJobs(id, now()).some((job) => job.status === 'queued' || job.status === 'running')) fail(409, 'processing documents')
      const stamp = { by: actor.id, at: now() }
      const frozen = handoverAt(live.handover, state.documents.list(id), date, stamp)
      const value = mdtRecord(frozen, board, actors.find((entry) => entry.id === item.referring_doctor_id), stamp)
      store.saveSnapshot(frozen); store.saveRecord(value)
      state.documents.saveHandover({ ...live.handover, confirmed_by_coordinator: stamp })
      state.saveCase({ ...item, state: 'pripraveno_k_mdt', mdt_board_id: board.id, mdt_date: date }); state.coordinator.sync(id); audit(item, actor, 'mdt_snapshot')
      return HttpResponse.json(value, { status: 201 })
    }),
    route('patch', '/cases/:caseId/mdt/record', async (request, id) => {
      const item = getCase(id), actor = write(request, item); prepared(item)
      const original = record(id), body = await readBody(request, ['members', 'results', 'mdt_question', 'diagnosis_name', 'diagnosis_code', 'comorbidities'])
      const patch: MdtRecordUpdate = {}
      for (const key of ['mdt_question', 'diagnosis_name', 'diagnosis_code'] as const) if (key in body.value) patch[key] = body.text(key)
      if ('members' in body.value) patch.members = members(body.value.members)
      if ('results' in body.value) patch.results = results(body.value.results)
      if ('comorbidities' in body.value) patch.comorbidities = body.list('comorbidities')
      body.done()
      const updated = { ...original, ...patch, members: patch.members ?? original.members, results: patch.results ?? original.results, comorbidities: patch.comorbidities ?? original.comorbidities }
      store.saveRecord(updated); audit(item, actor, 'mdt_record_update'); return HttpResponse.json(updated)
    }),
    route('get', '/cases/:caseId/mdt/conclusion', (_request, id) => { getCase(id); return HttpResponse.json(conclusion(id)) }),
    route('get', '/cases/:caseId/mdt/record.pdf', (_request, id) => { getCase(id); record(id); return new HttpResponse(demoMdtPdf(), { headers: { 'Content-Type': 'application/pdf' } }) }),
    route('get', '/cases/:caseId/mdt/conclusion.pdf', (_request, id) => { getCase(id); conclusion(id); return new HttpResponse(demoMdtPdf(), { headers: { 'Content-Type': 'application/pdf' } }) }),
    route('put', '/cases/:caseId/mdt/conclusion', async (request, id) => {
      const item = getCase(id), actor = write(request, item); prepared(item); record(id)
      const body = await readBody(request, [...conclusionStrings, 'date', 'recommendations', 'copy_to', 'ai_draft_used']), patch: MdtConclusionUpsert = {}
      for (const key of conclusionStrings) if (key in body.value) patch[key] = body.text(key)
      patch.date = body.date('date'); patch.recommendations = body.list('recommendations'); patch.copy_to = body.list('copy_to'); patch.ai_draft_used = body.flag('ai_draft_used'); body.done()
      const updated: MdtConclusion = { case_id: id, source: 'written', ...patch, confirmed: null }
      store.saveConclusion(updated); audit(item, actor, 'mdt_conclusion_update'); return HttpResponse.json(updated)
    }),
    route('post', '/cases/:caseId/mdt/conclusion/confirm', (request, id) => {
      const item = getCase(id), actor = write(request, item); prepared(item)
      const value = { ...conclusion(id), confirmed: { by: actor.id, at: now() } }
      if (store.jobs(id).some((job) => job.status === 'queued' || job.status === 'running')) fail(409, 'processing documents')
      store.saveConclusion(value)
      if (value.diagnosis_code) {
        const live = state.documents.result(id)
        if (live) state.documents.saveResult(id, { handover: { ...live.handover, diagnosis_code: { status: 'found', origin: 'manual', value: value.diagnosis_code, entered: value.confirmed } },
          findings: live.findings.map((finding) => !finding.resolved && finding.kind === 'missing' && finding.suggested_action === 'review' && finding.fields?.includes('diagnosis_code')
            ? { ...finding, resolved: true, resolution: { kind: 'resolved', ...value.confirmed } } : finding) })
      }
      state.saveCase({ ...item, state: 'zaver_mdt', milestones: { ...item.milestones, mdt_held: record(id).mdt_date } }); state.coordinator.sync(id)
      audit(item, actor, 'mdt_conclusion_confirm'); return HttpResponse.json(value)
    }),
    route('post', '/cases/:caseId/drafts', async (request, id) => {
      const item = getCase(id), actor = write(request, item)
      if (!['v_triage', 'ceka_na_podklady', 'kompletni', 'pripraveno_k_mdt'].includes(item.state ?? '')) fail(409, 'MDT is not editable')
      const body = await readBody(request, ['kind']); body.text('kind', true)
      const kinds: DraftKind[] = ['epicrisis_summary', 'mdt_question', 'mdt_results', 'mdt_conclusion'], kind = body.pick('kind', kinds, 'epicrisis_summary'); body.done()
      const job = store.addJob({ id: state.coordinator.id('draft'), case_id: id, kind: 'draft', params: { kind }, status: 'queued', created_at: now(), result: { text: demoDraftText } })
      audit(item, actor, 'mdt_draft'); return HttpResponse.json(job, { status: 202 })
    }),
    route('post', '/cases/:caseId/mdt/conclusion/upload', async (request, id) => {
      const item = getCase(id), actor = write(request, item); prepared(item); record(id)
      const form = await request.formData(), file = form.get('file'), received = form.get('received_at')
      if (!file || typeof file === 'string' || !supportedFile(file)) fail(415, 'unsupported file')
      const body = new BodyReader({ received_at: received }, ['received_at']), receivedAt = body.date('received_at', true); body.done()
      // Preserve original bytes through the existing document storage. The S5 job owns the simulated result.
      const upload = state.documents.upload(id, file, actor.id, receivedAt ?? now(), now())
      state.documents.detachJob(upload.job.id)
      const job = store.addJob(upload.job, () => {
        store.saveConclusion({ case_id: id, source: 'uploaded', document_id: upload.document.id, confirmed: null })
        audit(item, actor, 'mdt_conclusion_upload')
      })
      return HttpResponse.json<UploadResult>({ document: upload.document, job }, { status: 201 })
    }),
    http.get('*/api/jobs/:jobId', ({ params }) => { const value = store.job(String(params.jobId), now()); return value && HttpResponse.json(value) }),
    route('get', '/cases/:caseId/jobs', (_request, id) => { getCase(id); return HttpResponse.json([...state.documents.listJobs(id, now()), ...store.jobs(id)]) }),
    http.get('*/api/cases/:caseId/handover', ({ request, params }) => {
      const snapshot = new URL(request.url).searchParams.get('snapshot')
      if (snapshot !== 'true') return undefined
      const value = store.snapshot(String(params.caseId)); return value ? HttpResponse.json<Handover>(value) : HttpResponse.json({ detail: 'no snapshot' }, { status: 404 })
    }),
  ]
}
