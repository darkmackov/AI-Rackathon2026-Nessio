import { http, HttpResponse } from 'msw'
import type { Case, CaseAnswer, CodeCandidate, Handover, Job } from '../client/types.gen'
import { actors } from './directory'
import { fail, readBody } from './coordinator-validation'
import type { createDemoState } from './handlers'
import { demoEvidence } from './s8-data'
import { validationResponse } from './validation'

/** Simulated asynchronous questions only; no model, embeddings or clinical inference. */
export function createS8State(readNow: () => number) {
  const jobs = new Map<string, { job: Job; started: number; answer: CaseAnswer }>()
  let sequence = 0
  function read(id: string, now: string): Job | undefined {
    const entry = jobs.get(id)
    if (!entry) return undefined
    const elapsed = readNow() - entry.started
    if (elapsed >= 1000 && entry.job.status === 'queued') entry.job = { ...entry.job, status: 'running', started_at: now }
    if (elapsed >= 3000 && entry.job.status === 'running') entry.job = { ...entry.job, status: 'done', finished_at: now, answer: entry.answer }
    return structuredClone(entry.job)
  }
  return {
    reset: () => jobs.clear(),
    create: (caseId: string, question: string, answer: CaseAnswer, now: string): Job => {
      const job: Job = { id: `demo-s8-job-${++sequence}`, case_id: caseId, kind: 'ask_case', status: 'queued', created_at: now, params: { question } }
      jobs.set(job.id, { job, started: readNow(), answer: structuredClone(answer) })
      return structuredClone(job)
    },
    read,
    list: (caseId: string, now: string) => [...jobs.keys()].map((id) => read(id, now)).filter((job): job is Job => !!job && job.case_id === caseId),
  }
}

export function createS8Handlers(state: ReturnType<typeof createDemoState>) {
  const now = () => state.clock().now
  const getCase = (id: string) => state.getCases().find((item) => item.id === id) ?? fail(404, 'case not found')
  const handover = (id: string) => state.documents.result(id)?.handover ?? fail(404, 'no handover yet')
  function editor(request: Request, item: Case) {
    const id = request.headers.get('X-Actor-Id')
    if (id === null) throw validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
    const actor = actors.find((person) => person.id === id) ?? fail(404, 'actor not found')
    if (actor.role === 'coordinator' && actor.organization_id === item.koc_id) {
      if (!['v_triage', 'ceka_na_podklady', 'kompletni'].includes(item.state ?? '')) fail(409, 'handover is not editable')
    } else if (actor.role === 'referring_doctor' && actor.id === item.referring_doctor_id) {
      if (!['koncept', 'vraceno_lekari'].includes(item.state ?? '')) fail(409, 'handover is not editable')
    } else fail(403, 'wrong role')
    return actor
  }
  function candidates(value: Handover): CodeCandidate[] {
    if (value.diagnosis?.value == null) fail(409, 'the handover has no diagnosis')
    if (value.diagnosis_code?.value != null) fail(409, 'the diagnosis already has a code')
    // Fixed demo candidates, deliberately not a browser implementation of a coding service.
    if (value.case_id === 'demo-s8' && value.diagnosis.value.startsWith('Adenokarcinom rekta')) return [{ code: 'C20', title_cs: 'Zhoubný novotvar konečníku' }]
    return []
  }
  function answer(caseId: string, question: string, asOf: string): CaseAnswer {
    const normalized = question.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    const topic = /\bct\b/.test(normalized) ? 'ct' : /histol|biop/.test(normalized) ? 'histology' : /labor|onkomarker|markery/.test(normalized) ? 'lab' : null
    const docs = state.documents.list(caseId).filter((document) => !!document.received_at && document.received_at <= asOf)
    const source = docs.filter((document) => topic === 'ct' ? /\bCT\b|_CT_/.test(document.title ?? document.filename) : topic !== null && document.doc_type === topic)
      .sort((a, b) => (b.document_date ?? '').localeCompare(a.document_date ?? ''))[0]
    if (!source) return { question, found: false, quotes: [] }
    const text = state.documents.text(source.id)
    // These three prepared topics show a clinical section verbatim, never a generated answer.
    const section = topic === 'lab' ? text.split('NÁDOROVÉ MARKERY\n')[1] : text.split(/\nZÁVĚR\n+/)[1]
    const quote = section?.split(/\n\n(?:Datum:|Vydáno:|MUDr\.|Ing\.)/)[0].trim()
    return quote ? { question, found: true, quotes: [demoEvidence(source.id, text, quote)] } : { question, found: false, quotes: [] }
  }
  const route = (method: 'get' | 'post', path: string, action: (request: Request, id: string) => Response | Promise<Response>) =>
    http[method](`*/api${path}`, async ({ request, params }) => { try { return await action(request, String(params.caseId)) } catch (error) { if (error instanceof Response) return error; throw error } })
  return [
    route('post', '/cases/:caseId/ask', async (request, id) => {
      getCase(id)
      if (!request.headers.has('X-Actor-Id')) throw validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
      const body = await readBody(request, ['question']), question = body.text('question', true); body.done()
      const value = question ?? ''
      return HttpResponse.json<Job>(state.s8.create(id, value, answer(id, value, now()), now()), { status: 202 })
    }),
    route('get', '/cases/:caseId/handover/code-candidates', (_request, id) => { getCase(id); return HttpResponse.json<CodeCandidate[]>(candidates(handover(id))) }),
    route('post', '/cases/:caseId/handover/diagnosis-code', async (request, id) => {
      const item = getCase(id), actor = editor(request, item), value = handover(id)
      const body = await readBody(request, ['code']), code = body.text('code', true); body.done()
      const choices = candidates(value), picked = choices.find((choice) => choice.code === code) ?? fail(400, 'not one of the suggested codes')
      const updated: Handover = { ...value, diagnosis_code: { value: picked.code, status: 'found', origin: 'manual', entered: { by: actor.id, at: now() }, evidence: [], note: null } }
      state.documents.saveHandover(updated)
      state.saveCase({ ...item, diagnosis_label: `${picked.code} ${value.diagnosis?.value ?? ''}` })
      state.coordinator.record(id, actor.id, now(), 'diagnosis_code_from_ai', `Kód MKN-10 ${picked.code} (${picked.title_cs}) vybrán z návrhů AI: ${choices.map((choice) => choice.code).join(', ')}`)
      return HttpResponse.json<Handover>(updated)
    }),
    http.get('*/api/jobs/:jobId', ({ params }) => {
      const job = state.s8.read(String(params.jobId), now())
      return job ? HttpResponse.json<Job>(job) : undefined
    }),
    route('get', '/cases/:caseId/jobs', (_request, id) => {
      getCase(id)
      return HttpResponse.json<Job[]>([...state.documents.listJobs(id, now()), ...state.mdt.jobs(id), ...state.s8.list(id, now())])
    }),
  ]
}
