import { http, HttpResponse } from 'msw'
import type { Case, DemoClock, DemoScenario, Message, ValidationError } from '../client/types.gen'
import { localDateTime } from '../time'
import { actors, boards, organizations } from './directory'
import { referenceCases } from './reference'
import { referenceTasks } from './reference-tasks'
import { treatmentTime } from './treatment-time'
import { createDocumentDemoState, createDocumentHandlers } from './documents'
import { createReferralHandlers } from './referrals'
import { caseStates, enumError, extraFields, isApiDateTime, objectBody, organizationKinds, queryValue, queueColumns, validateEnumQuery, validationResponse } from './validation'

// Mutable simulated server state is private to this tab (Q-W6, Q-W10).
export function createDemoState(readNow: () => number = Date.now) {
  let cases: Case[] = []
  let messages: Message[] = []
  let simulatedAt: number | null = null
  let anchoredAt = readNow()
  const documents = createDocumentDemoState(readNow)

  const setTime = (value: string | null) => {
    simulatedAt = value === null ? null : new Date(value).getTime()
    anchoredAt = readNow()
  }
  const reset = (scenario: DemoScenario) => {
    messages = []
    documents.reset(scenario !== 'empty')
    cases = scenario === 'empty' ? [] : structuredClone(referenceCases)
    setTime(scenario === 'empty' ? '2026-10-02T14:00:00' : '2026-10-21T09:00:00')
    return structuredClone(cases)
  }
  reset('reference_at_mdt')
  return {
    documents,
    reset,
    setTime,
    getCases: () => structuredClone(cases),
    saveCase: (item: Case) => { cases = [...cases.filter((entry) => entry.id !== item.id), structuredClone(item)] },
    getMessages: () => structuredClone(messages),
    saveMessage: (message: Message) => { messages = [...messages.filter((entry) => entry.id !== message.id), structuredClone(message)] },
    clock: (): DemoClock => ({
      now: localDateTime(new Date(simulatedAt === null ? readNow() : simulatedAt + readNow() - anchoredAt)),
      simulated: simulatedAt !== null,
    }),
  }
}

export function createHandlers(state = createDemoState()) {
  const notFound = () => HttpResponse.json({ detail: 'not found' }, { status: 404 })
  return [
    ...createDocumentHandlers(state),
    ...createReferralHandlers(state),
    http.get('*/api/me', ({ request }) => {
      const id = request.headers.get('X-Actor-Id')
      if (id === null) return validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required', input: null }])
      const actor = actors.find((item) => item.id === id)
      if (!actor) return HttpResponse.json({ detail: 'actor not found' }, { status: 404 })
      if (!['referring_doctor', 'coordinator'].includes(actor.role)) {
        return HttpResponse.json({ detail: 'wrong role' }, { status: 403 })
      }
      return HttpResponse.json(actor)
    }),
    http.get('*/api/directory/actors', ({ request }) => {
      const query = new URL(request.url).searchParams
      return HttpResponse.json(actors.filter((actor) =>
        (!query.has('role') || actor.role === queryValue(query, 'role')) &&
        (!query.has('organization_id') || actor.organization_id === queryValue(query, 'organization_id'))))
    }),
    http.get('*/api/directory/organizations', ({ request }) => {
      const query = new URL(request.url).searchParams
      const errors = validateEnumQuery(query, 'kind', organizationKinds)
      if (errors.length) return validationResponse(errors)
      const kind = queryValue(query, 'kind')
      return HttpResponse.json(organizations.filter((item) => kind === null || item.kind === kind))
    }),
    http.get('*/api/mdt-boards', () => HttpResponse.json(boards)),
    http.get('*/api/mdt-boards/:id', ({ params }) => {
      const board = boards.find((item) => item.id === params.id)
      return board ? HttpResponse.json(board) : HttpResponse.json({ detail: 'board not found' }, { status: 404 })
    }),
    http.get('*/api/cases', ({ request }) => {
      const query = new URL(request.url).searchParams
      const errors = [...validateEnumQuery(query, 'state', caseStates), ...validateEnumQuery(query, 'queue', queueColumns)]
      if (errors.length) return validationResponse(errors)
      return HttpResponse.json(state.getCases().filter((item) =>
        (query.has('referring_doctor_id') || item.state !== 'koncept') &&
        (!query.has('referring_doctor_id') || item.referring_doctor_id === queryValue(query, 'referring_doctor_id')) &&
        (!query.has('koc_id') || item.koc_id === queryValue(query, 'koc_id')) &&
        (!query.has('state') || item.state === queryValue(query, 'state')) &&
        (!query.has('queue') || item.queue === queryValue(query, 'queue'))))
    }),
    http.get('*/api/cases/:id', ({ params }) => {
      const item = state.getCases().find((item) => item.id === params.id)
      return item ? HttpResponse.json(item) : notFound()
    }),
    http.get('*/api/cases/:id/tasks', ({ params }) => state.getCases().some((item) => item.id === params.id) ? HttpResponse.json(referenceTasks.filter((task) => task.case_id === params.id)) : HttpResponse.json({ detail: 'case not found' }, { status: 404 })),
    http.get('*/api/cases/:id/time-to-treatment', ({ params }) => {
      const item = state.getCases().find((item) => item.id === params.id)
      return item ? HttpResponse.json(treatmentTime(item, state.clock().now)) : notFound()
    }),
    http.get('*/api/demo/clock', () => HttpResponse.json(state.clock())),
    http.put('*/api/demo/clock', async ({ request }) => {
      const parsed = await objectBody(request)
      if (!parsed.value) return validationResponse(parsed.errors)
      const body = parsed.value
      const errors: ValidationError[] = []
      if (body.now !== undefined && body.now !== null && (typeof body.now !== 'string' || !isApiDateTime(body.now))) {
        errors.push({ loc: ['body', 'now'], type: typeof body.now === 'string' ? 'datetime_from_date_parsing' : 'datetime_type', msg: 'Input should be a valid datetime', input: body.now })
      }
      errors.push(...extraFields(body, ['now']))
      if (errors.length) return validationResponse(errors)
      state.setTime(typeof body.now === 'string' ? body.now : null)
      return HttpResponse.json(state.clock())
    }),
    http.post('*/api/demo/reset', async ({ request }) => {
      const parsed = await objectBody(request)
      if (!parsed.value) return validationResponse(parsed.errors)
      const body = parsed.value
      const errors: ValidationError[] = []
      if (!('scenario' in body)) errors.push({ loc: ['body', 'scenario'], type: 'missing', msg: 'Field required', input: body })
      else if (body.scenario !== 'empty' && body.scenario !== 'reference_at_mdt') errors.push(enumError(body.scenario, ['empty', 'reference_at_mdt'], ['body', 'scenario']))
      errors.push(...extraFields(body, ['scenario']))
      if (errors.length === 0 && (body.scenario === 'empty' || body.scenario === 'reference_at_mdt')) {
        return HttpResponse.json(state.reset(body.scenario))
      }
      return validationResponse(errors)
    }),
    http.all('*/api/*', () => HttpResponse.json({ detail: 'Not implemented yet' }, { status: 501 })),
  ]
}
