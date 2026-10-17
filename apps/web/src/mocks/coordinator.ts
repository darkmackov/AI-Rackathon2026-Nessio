import { http, HttpResponse } from 'msw'
import type { Actor, Case, DueNotice, Priority, Task, TaskSet, TaskTemplate } from '../client/types.gen'
import { localDateTime } from '../time'
import { actors, boards, organizations } from './directory'
import { auditDate, changed, directoryNames, quoted, resolutions, transition, withNote } from './audit-text'
import type { createDemoState } from './handlers'
import { transitions } from './coordinator-state'
import { BodyReader, fail, object, readBody, validateGraph } from './coordinator-validation'
import { validationResponse } from './validation'

const priorities = ['normal', 'high', 'urgent'] as const
const statuses = ['planned', 'booked', 'done', 'cancelled'] as const
const editableStates = ['v_triage', 'ceka_na_podklady', 'kompletni']

export function createCoordinatorHandlers(state: ReturnType<typeof createDemoState>) {
  const store = state.coordinator
  const now = () => state.clock().now
  const caseById = (id: string): Case => store.cases().find((item) => item.id === id) ?? fail(404, 'case not found')
  function actor(request: Request): Actor {
    const id = request.headers.get('X-Actor-Id')
    if (id === null) throw validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
    const user = actors.find((item) => item.id === id) ?? fail(404, 'actor not found')
    if (user.role !== 'coordinator') fail(403, 'only a coordinator can do this')
    return user
  }
  function access(request: Request, item: Case) {
    const user = actor(request)
    if (user.organization_id !== item.koc_id) fail(403, 'wrong KOC')
    return user
  }
  function editable(item: Case) { if (!editableStates.includes(item.state ?? '')) fail(409, 'case is not editable before MDT') }
  function owner(id: string | null | undefined, peopleOnly = false): string {
    if (!id || !actors.some((item) => item.id === id) && (peopleOnly || !organizations.some((item) => item.id === id))) fail(400, 'unknown owner')
    return id
  }
  const record = (item: Case, user: Actor, action: string, detail?: string | null) => store.record(item.id, user.id, now(), action, detail ?? undefined)
  // Names for the ids an audit detail mentions, like the backend: the directory plus the case's tasks and documents.
  const names = (caseId: string) => directoryNames(Object.fromEntries([...store.tasks(caseId).map((task): [string, string] => [task.id, task.title]),
    ...state.documents.list(caseId).map((document): [string, string] => [document.id, document.filename])]))
  const finding = (id: string, key: string) => state.documents.result(id)?.findings.find((item) => item.id === key) ?? fail(404, 'finding not found')
  const result = (id: string) => state.documents.result(id) ?? fail(404, 'no handover yet')
  const route = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, action: (request: Request, params: Record<string, string | readonly string[] | undefined>) => Response | Promise<Response>) =>
    http[method](`*/api${path}`, async ({ request, params }) => {
      try { return await action(request, params) } catch (error) { if (error instanceof Response) return error; throw error }
    })
  function save(item: Case, user: Actor, action: string, detail?: string | null) {
    store.saveCase(item); store.sync(item.id); record(item, user, action, detail)
    return HttpResponse.json(caseById(item.id))
  }
  return [
    route('post', '/cases/:caseId/take-over', (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item)
      if (item.state !== 'odeslano') fail(409, 'only a sent case can be taken over')
      return save({ ...item, state: 'v_triage', coordinator_id: user.id }, user, 'case_taken_over', transition(item.state, 'v_triage'))
    }),
    route('patch', '/cases/:caseId', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const body = await readBody(request, ['priority', 'coordinator_id', 'mdt_board_id', 'mdt_date'])
      const priority = body.pick('priority', priorities, item.priority ?? 'normal')
      const coordinator = body.text('coordinator_id'), board = body.text('mdt_board_id'), date = body.date('mdt_date'); body.done()
      if (coordinator != null && !actors.some((person) => person.id === coordinator && person.role === 'coordinator' && person.organization_id === item.koc_id)) fail(400, 'unknown coordinator at this KOC')
      if (board != null && !boards.some((entry) => entry.id === board && entry.organization_id === item.koc_id)) fail(400, 'unknown MDT board at this KOC')
      return save({ ...item, priority, ...(coordinator !== undefined ? { coordinator_id: coordinator } : {}), ...(board !== undefined ? { mdt_board_id: board } : {}), ...(date !== undefined ? { mdt_date: date } : {}) }, user, 'case_updated', changed(body.value, ['priority', 'coordinator_id', 'mdt_board_id', 'mdt_date'], names(item.id)))
    }),
    route('post', '/cases/:caseId/transition', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item)
      const body = await readBody(request, ['to', 'note'])
      body.text('to', true)
      const to = body.pick('to', ['ceka_na_podklady', 'kompletni'] as const, 'ceka_na_podklady'); body.text('note'); body.done()
      if (!item.state || !transitions[item.state]?.includes(to)) fail(409, 'transition is not allowed')
      return save({ ...item, state: to }, user, 'case_transitioned', withNote(transition(item.state, to), typeof body.value.note === 'string' ? body.value.note : null))
    }),
    route('post', '/cases/:caseId/return', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const body = await readBody(request, ['note', 'finding_id']), note = body.text('note', true), key = body.text('finding_id'); body.done()
      if (key) finding(item.id, key)
      store.saveMessage({ id: store.id('message'), case_id: item.id, kind: 'case_returned', channel: 'in_app', sender_id: user.id,
        recipient_ids: [item.referring_doctor_id], subject: 'Předávka vrácena k doplnění', body: note ?? '', finding_id: key, sent_at: now() })
      return save({ ...item, state: 'vraceno_lekari' }, user, 'case_returned', note)
    }),
    route('put', '/cases/:caseId/hold', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const body = await readBody(request, ['reason', 'until']), reason = body.text('reason', true), until = body.date('until'); body.done()
      return save({ ...item, on_hold: { reason: reason ?? '', until, set_by: user.id, set_at: now() } }, user, 'hold_set', (reason ?? '') + (until ? ` (obnovit od ${auditDate(until)})` : ''))
    }),
    route('delete', '/cases/:caseId/hold', (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      return save({ ...item, on_hold: null }, user, 'hold_cleared', item.on_hold?.reason)
    }),
    route('patch', '/cases/:caseId/milestones', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item)
      const body = await readBody(request, ['symptom_onset', 'treatment_start'])
      const onset = body.date('symptom_onset'), start = body.date('treatment_start'); body.done()
      return save({ ...item, milestones: { ...item.milestones, ...(onset !== undefined ? { symptom_onset: onset } : {}), ...(start !== undefined ? { treatment_start: start } : {}) } }, user, 'milestones_updated', changed(body.value, ['symptom_onset', 'treatment_start']))
    }),
    route('get', '/cases/:caseId/audit', (request, params) => {
      const item = caseById(String(params.caseId)); access(request, item)
      return HttpResponse.json(store.audit(item.id))
    }),
    route('post', '/cases/:caseId/findings/:findingId/resolve', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const issue = finding(item.id, String(params.findingId))
      if (issue.resolved) fail(409, 'finding is already resolved')
      const body = await readBody(request, ['kind', 'note']); body.text('kind', true)
      const kind = body.pick('kind', ['resolved', 'overridden', 'dismissed'] as const, 'resolved'), note = body.text('note'); body.done()
      if (kind === 'overridden' && (issue.overridable === false || !note)) fail(400, 'override requires an overridable finding and a note')
      const updated = { ...issue, resolved: true, resolution: { kind, note, by: user.id, at: now() } }
      const current = result(item.id)
      state.documents.saveResult(item.id, { ...current, findings: current.findings.map((entry) => entry.id === issue.id ? updated : entry) })
      record(item, user, 'finding_resolved', withNote(`${quoted(issue.message_cs)}: ${resolutions[kind]}`, note))
      return HttpResponse.json(updated)
    }),
    route('post', '/cases/:caseId/findings/:findingId/request', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const issue = finding(item.id, String(params.findingId))
      if (issue.resolved) fail(409, 'finding is already resolved')
      const body = await readBody(request, ['owner_id', 'title', 'due', 'priority', 'note'])
      const id = body.text('owner_id', true), title = body.text('title'), due = body.date('due', true), priority = body.pick('priority', priorities, 'normal'), note = body.text('note'); body.done()
      const task: Task = { id: store.id('task'), case_id: item.id, title: title || issue.message_cs, kind: 'request_documents', owner: owner(id), due, priority, status: 'planned', finding_id: issue.id, depends_on: [] }
      store.saveTask(task); record(item, user, 'finding_requested', withNote(`${quoted(issue.message_cs)} → ${names(item.id)[task.owner] ?? task.owner}`, note))
      return HttpResponse.json(task, { status: 201 })
    }),
    route('post', '/cases/:caseId/tasks', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const body = await readBody(request, ['title', 'kind', 'owner_id', 'location', 'due', 'priority', 'depends_on', 'external'])
      const task = taskBody(body, { id: store.id('task'), case_id: item.id, title: '', kind: '', owner: '' }, false)
      body.done(); owner(task.owner); validateGraph([...store.tasks(item.id), task].map((entry) => ({ key: entry.id, depends_on: entry.depends_on })))
      store.saveTask(task); record(item, user, 'task_created', task.title)
      return HttpResponse.json(task, { status: 201 })
    }),
    route('patch', '/tasks/:taskId', async (request, params) => {
      const task = store.task(String(params.taskId)) ?? fail(404, 'task not found'), item = caseById(task.case_id), user = access(request, item)
      const body = await readBody(request, ['title', 'status', 'owner_id', 'location', 'due', 'priority', 'depends_on', 'external', 'result_document_id'])
      const updated = taskBody(body, task, true); body.done(); owner(updated.owner)
      if (updated.result_document_id && state.documents.get(updated.result_document_id)?.case_id !== item.id) fail(400, 'result document must belong to this case')
      validateGraph(store.tasks(item.id).map((entry) => ({ key: entry.id, depends_on: entry.id === task.id ? updated.depends_on : entry.depends_on })))
      // Like the backend: the changed fields in TaskUpdate's order, the owner last.
      const changes = Object.fromEntries(Object.entries(body.value).map(([key, entry]): [string, unknown] => [key === 'owner_id' ? 'owner' : key, entry]))
      store.saveTask(updated); record(item, user, 'task_updated', `${updated.title}: ${changed(changes, ['title', 'status', 'location', 'due', 'priority', 'depends_on', 'external', 'result_document_id', 'owner'], names(item.id))}`)
      return HttpResponse.json(updated)
    }),
    route('get', '/task-sets', (request) => {
      const code = new URL(request.url).searchParams.get('diagnosis_code')
      return HttpResponse.json(store.sets().filter((set) => !code || set.diagnosis_codes?.some((prefix) => code.startsWith(prefix))))
    }),
    ...(['post', 'put'] as const).map((method) => route(method, method === 'post' ? '/task-sets' : '/task-sets/:setId', async (request, params) => {
      const user = actor(request), old = method === 'put' ? store.sets().find((set) => set.id === params.setId) ?? fail(404, 'task set not found') : undefined
      const body = await readBody(request, ['name', 'diagnosis_codes', 'steps']), name = body.text('name', true), codes = body.list('diagnosis_codes')
      const raw = body.value.steps
      const steps: TaskTemplate[] = []
      if (!Array.isArray(raw) || !raw.length) body.bad('steps', 'At least one step is required')
      else for (const value of raw) {
        if (!object(value)) { body.bad('steps'); continue }
        const step = new BodyReader(value, ['key', 'title', 'kind', 'owner_role', 'due_offset_days', 'depends_on'])
        const key = step.text('key', true), title = step.text('title', true), kind = step.text('kind', true), role = step.text('owner_role', true), dependencies = step.list('depends_on'), offset = value.due_offset_days
        if (offset != null && (typeof offset !== 'number' || !Number.isInteger(offset))) step.bad('due_offset_days')
        step.done()
        steps.push({ key: key ?? '', title: title ?? '', kind: kind ?? '', owner_role: role ?? '', depends_on: dependencies, due_offset_days: typeof offset === 'number' ? offset : null })
      }
      body.done(); validateGraph(steps)
      const set: TaskSet = { id: old?.id ?? store.id('set'), name: name ?? '', diagnosis_codes: codes, steps, created_by: old?.created_by ?? user.id }
      return HttpResponse.json(store.saveSet(set), { status: method === 'post' ? 201 : 200 })
    })),
    route('post', '/cases/:caseId/task-sets/start', async (request, params) => {
      const item = caseById(String(params.caseId)), user = access(request, item); editable(item)
      const body = await readBody(request, ['task_set_id', 'owners', 'start']), id = body.text('task_set_id', true), start = body.date('start', true)
      const owners = body.value.owners ?? {}; if (!object(owners)) body.bad('owners'); body.done()
      const set = store.sets().find((entry) => entry.id === id) ?? fail(404, 'task set not found')
      if (store.hasRun(item.id, set.id)) fail(409, 'task set already started for this case')
      const assignments = new Map<string, string>()
      if (object(owners)) for (const step of set.steps) {
        const assigned = owners[step.owner_role]
        assignments.set(step.owner_role, owner(typeof assigned === 'string' ? assigned : undefined, true))
      }
      const ids = Object.fromEntries(set.steps.map((step) => [step.key, store.id('task')]))
      const tasks: Task[] = set.steps.map((step) => {
        const due = new Date(start || now()); due.setDate(due.getDate() + (step.due_offset_days ?? 0))
        return { id: ids[step.key], case_id: item.id, title: step.title, kind: step.kind, owner: assignments.get(step.owner_role) ?? fail(400, 'missing role assignment'), status: 'planned', priority: 'normal',
          due: step.due_offset_days == null ? null : localDateTime(due), depends_on: (step.depends_on ?? []).map((key) => ids[key]) }
      })
      for (const task of tasks) store.saveTask(task)
      store.markRun(item.id, set.id); record(item, user, 'task_set_started', set.name)
      return HttpResponse.json(tasks, { status: 201 })
    }),
    route('get', '/notifications', (request) => {
      const user = actor(request), raw = new URL(request.url).searchParams.get('within_days'), days = raw === null ? 2 : Number(raw)
      if (!Number.isInteger(days) || days < 0) throw validationResponse([{ loc: ['query', 'within_days'], type: 'greater_than_equal', msg: 'Non-negative integer required' }])
      const current = new Date(now()).getTime(), limit = new Date(now()); limit.setDate(limit.getDate() + days)
      const notices: DueNotice[] = store.cases().filter((item) => item.koc_id === user.organization_id).flatMap((item) => store.tasks(item.id))
        .filter((task) => task.owner === user.id && task.status !== 'done' && task.status !== 'cancelled' && !!task.due && new Date(task.due).getTime() <= limit.getTime())
        .map((task) => ({ task_id: task.id, case_id: task.case_id, title: task.title, due: task.due ?? '', overdue: new Date(task.due ?? '').getTime() < current }))
        .sort((a, b) => a.due.localeCompare(b.due))
      return HttpResponse.json(notices)
    }),
  ]
}

function taskBody(body: BodyReader, old: Task, update: boolean): Task {
  const title = body.text('title', !update), kind = update ? old.kind : body.text('kind', true), person = body.text('owner_id', !update)
  const location = body.text('location'), due = body.date('due', true), priority: Priority = body.pick('priority', priorities, old.priority ?? 'normal')
  const task: Task = { ...old, title: title ?? old.title, kind: kind ?? old.kind, owner: person ?? old.owner, location: location === undefined ? old.location : location,
    due: due === undefined ? old.due : due, priority, status: body.pick('status', statuses, old.status ?? 'planned'),
    depends_on: 'depends_on' in body.value ? body.list('depends_on') : old.depends_on ?? [], external: body.flag('external', old.external ?? false) }
  if (update && 'result_document_id' in body.value) task.result_document_id = body.text('result_document_id')
  return task
}
