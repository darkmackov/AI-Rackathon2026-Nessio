import { describe, expect, it } from 'vitest'
import type { UseMutationOptions } from '@tanstack/react-query'
import { client } from '../client/client.gen'
import { actorHeaders, createQueryClient } from '../api'
import * as api from '../client/@tanstack/react-query.gen'
import { s4CaseId } from '../mocks/coordinator-state'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { demoState, server } from './setup'
import { expectApiResponse } from './api-contract'

const headers = actorHeaders('koordinator'), path = { case_id: s4CaseId }, scoped = { path, headers }
function mutation<T, E, V>(options: UseMutationOptions<T, E, V>, variables: V) {
  const client = createQueryClient()
  return client.getMutationCache().build(client, options).execute(variables)
}
const take = () => mutation(api.takeOverCaseMutation(), scoped)
const query = () => createQueryClient()

async function createTask(title: string, depends_on: string[] = []) {
  return mutation(api.createTaskMutation(), { ...scoped, body: { title, kind: 'other', owner_id: 'koordinator', due: '2026-10-21T14:00:00', depends_on } })
}

describe('S4 HTTP workflow', () => {
  it('takes over, updates the case and milestones, transitions, holds and resumes without automatic resumption', async () => {
    const client = query()
    const taken = await take()
    expectApiResponse('take_over_case', 200, taken)
    expect(taken).toMatchObject({ state: 'v_triage', coordinator_id: 'koordinator', on_move: 'koordinator' })
    const updated = await mutation(api.updateCaseMutation(), { ...scoped, body: { priority: 'urgent', mdt_board_id: 'mdt-git-lipova', mdt_date: '2026-10-25' } })
    expectApiResponse('update_case', 200, updated)
    const milestones = await mutation(api.updateMilestonesMutation(), { ...scoped, body: { symptom_onset: '2026-10-01', treatment_start: null } })
    expectApiResponse('update_milestones', 200, milestones)
    const waiting = await mutation(api.transitionCaseMutation(), { ...scoped, body: { to: 'ceka_na_podklady' } })
    expectApiResponse('transition_case', 200, waiting)
    const held = await mutation(api.setHoldMutation(), { ...scoped, body: { reason: 'Čeká na CT', until: '2026-10-22' } })
    expectApiResponse('set_hold', 200, held); expect(held.queue).toBe('odlozeny')
    demoState.setTime('2026-10-25T09:00:00')
    expect((await client.fetchQuery(api.getCaseOptions(scoped))).on_hold?.reason).toBe('Čeká na CT')
    const resumed = await mutation(api.clearHoldMutation(), scoped)
    expectApiResponse('clear_hold', 200, resumed); expect(resumed.queue).toBe('aktivni')
    await expect(mutation(api.transitionCaseMutation(), { ...scoped, body: { to: 'pripraveno_k_mdt' } })).rejects.toMatchObject({ status: 422 })
    const complete = await mutation(api.transitionCaseMutation(), { ...scoped, body: { to: 'kompletni' } })
    expect(complete.state).toBe('kompletni')
    const audit = await client.fetchQuery(api.listAuditOptions(scoped))
    expectApiResponse('list_audit', 200, audit)
    expect(audit.map((event) => event.action)).toEqual(['take_over', 'update_case', 'milestones', 'transition', 'hold', 'resume', 'transition'])
    expect(audit.every((event) => event.actor_id === 'koordinator')).toBe(true)
  })

  it('creates a linked request, manually fills a field, and resolves findings only on explicit actions', async () => {
    await take()
    const client = query(), finding = { case_id: s4CaseId, finding_id: `${s4CaseId}-demo-missing` }
    const requested = await mutation(api.requestFromFindingMutation(), { path: finding, headers, body: { owner_id: 'pl-reznicek', title: 'Doplnit ECOG', priority: 'high', note: 'Prosím o zprávu.' } })
    expectApiResponse('request_from_finding', 201, requested)
    expect(requested).toMatchObject({ finding_id: finding.finding_id, owner: 'pl-reznicek', kind: 'request_documents' })
    const handover = await mutation(api.updateHandoverFieldMutation(), { ...scoped, body: { path: 'performance_status', value: 'ECOG 1' } })
    expectApiResponse('update_handover_field', 200, handover)
    expect(handover.performance_status).toMatchObject({ value: 'ECOG 1', status: 'found', origin: 'manual', entered: { by: 'koordinator' } })
    expect((await client.fetchQuery(api.listFindingsOptions(scoped))).find((entry) => entry.id === finding.finding_id)?.resolved).toBe(false)
    await expect(mutation(api.resolveFindingMutation(), { path: finding, headers, body: { kind: 'overridden', note: '  ' } })).rejects.toMatchObject({ status: 400 })
    const resolved = await mutation(api.resolveFindingMutation(), { path: finding, headers, body: { kind: 'overridden', note: 'Posouzeno koordinátorem.' } })
    expectApiResponse('resolve_finding', 200, resolved)
    expect(resolved.resolution).toMatchObject({ kind: 'overridden', by: 'koordinator' })
    await mutation(api.reextractCaseMutation(), scoped)
    expect((await client.fetchQuery(api.getHandoverOptions(scoped))).performance_status?.value).toBe('ECOG 1')
  })

  it('preserves task dependencies but permits completing a successor first, rejects cycles and foreign documents', async () => {
    await take()
    const first = await createTask('CT'), second = await createTask('Biopsie', [first.id])
    expectApiResponse('create_task', 201, first)
    const completed = await mutation(api.updateTaskMutation(), { path: { task_id: second.id }, headers, body: { status: 'done', result_document_id: `${s4CaseId}-document` } })
    expectApiResponse('update_task', 200, completed); expect(completed.status).toBe('done')
    await expect(mutation(api.updateTaskMutation(), { path: { task_id: first.id }, headers, body: { depends_on: [second.id] } })).rejects.toMatchObject({ status: 400 })
    await expect(mutation(api.updateTaskMutation(), { path: { task_id: first.id }, headers, body: { result_document_id: '07' } })).rejects.toMatchObject({ status: 400 })
    await expect(createTask('Neplatná závislost', ['missing'])).rejects.toMatchObject({ status: 400 })
    expect(demoState.coordinator.tasks(s4CaseId)).toHaveLength(2)
  })

  it('creates and edits a task set, starts it once and preserves already created tasks when its template changes', async () => {
    await take()
    const original = await mutation(api.createTaskSetMutation(), { headers, body: { name: 'Ukázková sada', diagnosis_codes: ['C50'], steps: [{ key: 'ct', title: 'CT', kind: 'imaging', owner_role: 'coordinator', due_offset_days: 2 }] } })
    expectApiResponse('create_task_set', 201, original)
    const tasks = await mutation(api.startTaskSetMutation(), { ...scoped, body: { task_set_id: original.id, owners: { coordinator: 'koordinator' }, start: '2026-10-21T09:00:00' } })
    expectApiResponse('start_task_set', 201, tasks); expect(tasks[0].due).toBe('2026-10-23T09:00:00')
    await expect(mutation(api.startTaskSetMutation(), { ...scoped, body: { task_set_id: original.id, owners: { coordinator: 'koordinator' } } })).rejects.toMatchObject({ status: 409 })
    const edited = await mutation(api.updateTaskSetMutation(), { headers, path: { task_set_id: original.id }, body: { name: 'Upravená sada', steps: [{ key: 'ct', title: 'Nové CT', kind: 'imaging', owner_role: 'coordinator' }] } })
    expectApiResponse('update_task_set', 200, edited)
    expect(demoState.coordinator.tasks(s4CaseId)[0].title).toBe('CT')
    expectApiResponse('list_task_sets', 200, await query().fetchQuery(api.listTaskSetsOptions()))
  })

  it('returns a referral with a linked message, keeps the GP responsible, and checks invalid state and roles', async () => {
    await take()
    const returned = await mutation(api.returnCaseMutation(), { ...scoped, body: { note: 'Prosím o doplnění.', finding_id: `${s4CaseId}-request` } })
    expectApiResponse('return_case', 200, returned)
    expect(returned).toMatchObject({ state: 'vraceno_lekari', on_move: 'pl-reznicek' })
    expect(demoState.coordinator.messages(s4CaseId)[0]).toMatchObject({ kind: 'case_returned', body: 'Prosím o doplnění.', recipient_ids: ['pl-reznicek'] })
    await expect(take()).rejects.toMatchObject({ status: 409 })
    await expect(mutation(api.updateCaseMutation(), { ...scoped, headers: actorHeaders('pl-reznicek'), body: { priority: 'high' } })).rejects.toMatchObject({ status: 403 })
    const other = demoState.coordinator.cases().find((item) => item.id === s4CaseId)!
    demoState.coordinator.saveCase({ ...other, koc_id: 'koc1-severni' })
    await expect(mutation(api.setHoldMutation(), { ...scoped, body: { reason: 'Čekání' } })).rejects.toMatchObject({ status: 403 })
  })

  it('derives only the current actor’s open deadline notices from the demo clock', async () => {
    await take(); const personal = await createTask('Osobní termín')
    await mutation(api.createTaskMutation(), { ...scoped, body: { title: 'Cizí termín', kind: 'other', owner_id: 'pl-reznicek', due: '2026-10-20T08:00:00' } })
    demoState.setTime('2026-10-22T09:00:00')
    const notices = await query().fetchQuery(api.listNotificationsOptions({ headers }))
    expectApiResponse('list_notifications', 200, notices)
    expect(notices.some((notice) => notice.task_id === personal.id && notice.overdue)).toBe(true)
    expect(notices.some((notice) => notice.title === 'Cizí termín')).toBe(false)
    await mutation(api.updateTaskMutation(), { headers, path: { task_id: personal.id }, body: { status: 'cancelled' } })
    expect((await query().fetchQuery(api.listNotificationsOptions({ headers }))).some((notice) => notice.task_id === personal.id)).toBe(false)
  })

  it('rejects invalid dates, missing parents, bad references and extra fields without audit changes', async () => {
    await take(); const count = demoState.coordinator.audit(s4CaseId).length
    await expect(mutation(api.setHoldMutation(), { ...scoped, body: { reason: 'Čekání', until: '2026-02-30' } })).rejects.toMatchObject({ status: 422 })
    await expect(mutation(api.takeOverCaseMutation(), { path: { case_id: 'missing' }, headers })).rejects.toMatchObject({ status: 404 })
    await expect(mutation(api.returnCaseMutation(), { ...scoped, body: { note: 'Zpráva', finding_id: 'foreign' } })).rejects.toMatchObject({ status: 404 })
    await expect(mutation(api.updateTaskSetMutation(), { headers, path: { task_set_id: 'missing' }, body: { name: 'Sada', steps: [] } })).rejects.toMatchObject({ status: 404 })
    expect(demoState.coordinator.audit(s4CaseId)).toHaveLength(count)
    // S5 is simulated now; a case still in triage must not create a snapshot.
    await expect(mutation(api.createMdtSnapshotMutation(), { ...scoped, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-25' } })).rejects.toMatchObject({ status: 409 })
  })

  it('validates HTTP bodies, unknown identities, non-overridable findings and cyclic templates', async () => {
    await take()
    const intercept = async (body: string, run: () => Promise<unknown>) => {
      const interceptor = client.interceptors.request.use((request) => new Request(request, { body }))
      try { await expect(run()).rejects.toMatchObject({ status: 422 }) }
      finally { client.interceptors.request.eject(interceptor) }
    }
    await intercept('{"reason":"Wait","extra":true}', () => mutation(api.setHoldMutation(), { ...scoped, body: { reason: 'Wait' } }))
    await intercept('{', () => mutation(api.setHoldMutation(), { ...scoped, body: { reason: 'Wait' } }))
    await intercept('{"priority":"invalid"}', () => mutation(api.updateCaseMutation(), { ...scoped, body: { priority: 'normal' } }))
    await expect(mutation(api.takeOverCaseMutation(), { path, headers: actorHeaders('unknown') })).rejects.toMatchObject({ status: 404 })
    await expect(mutation(api.createTaskSetMutation(), { headers, body: { name: 'Cycle', steps: [
      { key: 'a', title: 'A', kind: 'other', owner_role: 'coordinator', depends_on: ['b'] },
      { key: 'b', title: 'B', kind: 'other', owner_role: 'coordinator', depends_on: ['a'] },
    ] } })).rejects.toMatchObject({ status: 400 })
    const result = demoState.documents.result(s4CaseId)!
    demoState.documents.saveResult(s4CaseId, { ...result, findings: result.findings.map((item) => ({ ...item, overridable: false })) })
    await expect(mutation(api.resolveFindingMutation(), { headers, path: { ...path, finding_id: `${s4CaseId}-demo-missing` }, body: { kind: 'overridden', note: 'Reason' } })).rejects.toMatchObject({ status: 400 })
    expect(demoState.coordinator.audit(s4CaseId)).toHaveLength(1)
  })

  it('resets all mutable S4 data and isolates independent demo tabs', async () => {
    await take(); await createTask('Úkol')
    const isolated = createDemoState(); server.use(...createHandlers(isolated))
    expect((await query().fetchQuery(api.getCaseOptions(scoped))).state).toBe('odeslano')
    demoState.reset('empty')
    expect(demoState.coordinator.cases()).toEqual([]); expect(demoState.coordinator.audit(s4CaseId)).toEqual([])
    expect(demoState.coordinator.tasks(s4CaseId)).toEqual([])
    demoState.reset('reference_at_mdt'); expect(demoState.coordinator.cases()).toHaveLength(2)
    expect(demoState.documents.result(s4CaseId)?.handover.performance_status?.status).toBe('missing')
  })
})
