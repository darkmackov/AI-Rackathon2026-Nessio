import { describe, expect, it } from 'vitest'
import { ApiError, actorHeaders, createQueryClient } from '../api'
import { client } from '../client/client.gen'
import {
  documentTextOptions, getCaseOptions, getDemoClockOptions, getHandoverOptions, getMdtBoardOptions, getTimeToTreatmentOptions, listActorsOptions, listCasesOptions,
  listDocumentsOptions, listFindingsOptions, listMdtBoardsOptions, listOrganizationsOptions, listTasksOptions, meOptions, resetDemoMutation, setDemoClockMutation,
} from '../client/@tanstack/react-query.gen'
import { demoDocumentText, demoExtraction } from '../mocks/documents'
import { expectApiResponse } from './api-contract'

async function interceptRequest(transform: (request: Request) => Request, action: () => Promise<unknown>) {
  const interceptor = client.interceptors.request.use(transform)
  try { return await action() }
  finally { client.interceptors.request.eject(interceptor) }
}

async function validationError(operationId: string, action: () => Promise<unknown>) {
  try { await action() }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw error
    expect(error.status).toBe(422)
    expectApiResponse(operationId, 422, error.detail)
    return error.detail
  }
  throw new Error('Expected a validation error')
}

describe('implemented demo responses against backend OpenAPI', () => {
  it('validates every implemented successful response, including both reset scenarios', async () => {
    const query = createQueryClient()
    const actors = await query.fetchQuery(listActorsOptions())
    expectApiResponse('list_actors', 200, actors)
    const users = actors.filter((actor) => actor.role === 'coordinator' || actor.role === 'referring_doctor')
    expect(users).toHaveLength(10)
    for (const user of users) {
      const identity = await query.fetchQuery(meOptions({ headers: actorHeaders(user.id) }))
      expect(identity).toMatchObject({ id: user.id, role: user.role, organization_id: user.organization_id })
      expectApiResponse('me', 200, identity)
    }
    expectApiResponse('list_organizations', 200, await query.fetchQuery(listOrganizationsOptions()))
    expectApiResponse('list_mdt_boards', 200, await query.fetchQuery(listMdtBoardsOptions()))
    expectApiResponse('get_mdt_board', 200, await query.fetchQuery(getMdtBoardOptions({ path: { board_id: 'mdt-git-lipova' } })))
    expectApiResponse('list_cases', 200, await query.fetchQuery(listCasesOptions()))
    expectApiResponse('get_demo_clock', 200, await query.fetchQuery(getDemoClockOptions()))
    const clock = query.getMutationCache().build(query, setDemoClockMutation())
    expectApiResponse('set_demo_clock', 200, await clock.execute({ body: { now: '2026-10-21T09:30:00+02:00' } }))
    expectApiResponse('set_demo_clock', 200, await clock.execute({ body: {} }))
    const reset = query.getMutationCache().build(query, resetDemoMutation())
    expectApiResponse('reset_demo', 200, await reset.execute({ body: { scenario: 'empty' } }))
    expectApiResponse('reset_demo', 200, await reset.execute({ body: { scenario: 'reference_at_mdt' } }))
  })

  it.each(['kind', 'state', 'queue'])('rejects an invalid %s query enum with a documented 422 body', async (name) => {
    const query = createQueryClient()
    const operationId = name === 'kind' ? 'list_organizations' : 'list_cases'
    const detail = await validationError(operationId, () => interceptRequest((request) => {
      const url = new URL(request.url)
      url.searchParams.set(name, 'not-an-enum-value')
      return new Request(url, request)
    }, () => name === 'kind' ? query.fetchQuery(listOrganizationsOptions()) : query.fetchQuery(listCasesOptions())))
    expect(detail).toMatchObject({ detail: [{ type: 'enum', loc: ['query', name] }] })
  })

  it('distinguishes a missing actor header from a present but unknown actor', async () => {
    const query = createQueryClient()
    const detail = await validationError('me', () => interceptRequest((request) => {
      request.headers.delete('X-Actor-Id')
      return request
    }, () => query.fetchQuery(meOptions({ headers: actorHeaders('pl-reznicek') }))))
    expect(detail).toMatchObject({ detail: [{ type: 'missing', loc: ['header', 'X-Actor-Id'] }] })
    await expect(query.fetchQuery(meOptions({ headers: actorHeaders('') }))).rejects.toMatchObject({ status: 404 })
  })

  it.each([
    ['{}', 'missing', ['body', 'scenario']],
    ['{"scenario":"invalid"}', 'enum', ['body', 'scenario']],
    ['{"scenario":"empty","extra":true}', 'extra_forbidden', ['body', 'extra']],
    ['{', 'json_invalid', ['body', 0]],
    ['[]', 'model_attributes_type', ['body']],
    ['', 'missing', ['body']],
  ])('validates reset request %s without changing the scenario', async (body, type, loc) => {
    const query = createQueryClient()
    const reset = query.getMutationCache().build(query, resetDemoMutation())
    const detail = await validationError('reset_demo', () => interceptRequest((request) => new Request(request, { body }),
      () => reset.execute({ body: { scenario: 'empty' } })))
    expect(detail).toMatchObject({ detail: [{ type, loc }] })
    expect(await query.fetchQuery(listCasesOptions())).toHaveLength(2)
  })

  it('validates clock input and forbidden fields using the documented error model', async () => {
    const query = createQueryClient()
    const clock = query.getMutationCache().build(query, setDemoClockMutation())
    const detail = await validationError('set_demo_clock', () => interceptRequest((request) =>
      new Request(request, { body: '{"now":"2026-02-30T10:00:00","extra":true}' }),
    () => clock.execute({ body: { now: null } })))
    expect(detail).toMatchObject({ detail: [
      { loc: ['body', 'now'] }, { loc: ['body', 'extra'], type: 'extra_forbidden' },
    ] })
  })

  it('serves the case detail read operations with their OpenAPI response models', async () => {
    const query = createQueryClient()
    const options = { path: { case_id: 'vzp-prochazkova' }, headers: actorHeaders('koordinator') }
    expectApiResponse('get_case', 200, await query.fetchQuery(getCaseOptions(options)))
    expectApiResponse('get_handover', 200, await query.fetchQuery(getHandoverOptions(options)))
    expectApiResponse('list_findings', 200, await query.fetchQuery(listFindingsOptions(options)))
    expectApiResponse('list_tasks', 200, await query.fetchQuery(listTasksOptions(options)))
    expectApiResponse('list_documents', 200, await query.fetchQuery(listDocumentsOptions(options)))
    expectApiResponse('get_time_to_treatment', 200, await query.fetchQuery(getTimeToTreatmentOptions(options)))
    expectApiResponse('document_text', 200, await query.fetchQuery(documentTextOptions({ path: { document_id: '07' } })))
  })

  it('keeps synthetic extraction fixtures within the OpenAPI models, including missing and conflicting values', () => {
    const result = demoExtraction('any-case', 'any-document', '2026-10-16T09:00:00')
    expectApiResponse('get_handover', 200, result.handover)
    expectApiResponse('list_findings', 200, result.findings)
    expect(result.handover.performance_status?.value).toBeNull()
    expect(result.handover.weight_kg?.status).toBe('conflict')
    expect(result.handover.weight_kg?.evidence?.every((item) => demoDocumentText.includes(item.quote))).toBe(true)
    expect(result.handover.validated_by_referrer).toBeNull()
  })
})