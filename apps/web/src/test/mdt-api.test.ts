import { describe, expect, it } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import * as api from '../client/@tanstack/react-query.gen'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { demoDraftText } from '../mocks/mdt'
import { s4CaseId } from '../mocks/coordinator-state'
import { demoState, server } from './setup'
import { expectApiResponse } from './api-contract'
import { completeCase, mutation, resolveBlockers } from './mdt-fixtures'

const headers = actorHeaders('koordinator'), path = { case_id: s4CaseId }, options = { headers, path }
const snapshot = () => mutation(api.createMdtSnapshotMutation(), { ...options, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })

describe('S5 contract-shaped HTTP demo', () => {
  it('blocks a snapshot until the case is complete and blockers are explicitly resolved', async () => {
    await expect(snapshot()).rejects.toMatchObject({ status: 409 })
    completeCase()
    await expect(snapshot()).rejects.toMatchObject({ status: 409 })
    await mutation(api.resolveFindingMutation(), { headers, path: { ...path, finding_id: `${s4CaseId}-demo-missing` }, body: { kind: 'overridden', note: 'Fiktivní zdůvodnění ponechání chybějícího údaje.' } })
    const live = demoState.documents.result(s4CaseId)?.handover
    if (!live?.weight_kg) throw new Error('Missing conflict fixture')
    demoState.documents.saveHandover({ ...live, weight_kg: { ...live.weight_kg, value: 65 } })
    const record = await snapshot()
    expectApiResponse('create_mdt_snapshot', 201, record)
    expect(record).toMatchObject({ case_id: s4CaseId, mdt_date: '2026-10-21', board_id: 'mdt-git-lipova', created: { by: 'koordinator' } })
    expect(record.weight_kg).toBeNull()
    expect(demoState.getCases().find((item) => item.id === s4CaseId)?.state).toBe('pripraveno_k_mdt')
    expectApiResponse('get_mdt_record', 200, await createQueryClient().fetchQuery(api.getMdtRecordOptions(options)))
    expectApiResponse('get_handover', 200, await createQueryClient().fetchQuery(api.getHandoverOptions({ ...options, query: { snapshot: true } })))
    await expect(snapshot()).rejects.toMatchObject({ status: 409 })
  })

  it('keeps the frozen snapshot and record independent of later documents, live edits and roster edits', async () => {
    completeCase(); resolveBlockers()
    const live = demoState.documents.result(s4CaseId)
    if (!live) throw new Error('Missing fixture')
    demoState.documents.saveHandover({ ...live.handover, other: { status: 'found', origin: 'manual', value: 'Fiktivní údaj z dalšího dne', entered: { by: 'koordinator', at: '2026-10-22T09:00:00' } } })
    const original = await snapshot()
    const frozen = demoState.mdt.snapshot(s4CaseId)
    expect(frozen?.other).toBeUndefined()
    expect(demoState.documents.result(s4CaseId)?.handover.other?.value).toBe('Fiktivní údaj z dalšího dne')
    demoState.documents.saveHandover({ ...live.handover, mdt_question: { status: 'found', origin: 'manual', value: 'Nová živá otázka', entered: { by: 'koordinator', at: '2026-10-23T09:00:00' } } })
    const updated = await mutation(api.updateMdtRecordMutation(), { ...options, body: { members: [{ name: 'Fiktivní člen', specialty: 'Onkologie' }], results: [{ date: '2026-10-20', examination: 'Fiktivní kontrola', result: 'Úplný fiktivní text výsledku.' }], mdt_question: 'Ručně upravená otázka zápisu' } })
    expectApiResponse('update_mdt_record', 200, updated)
    expect(demoState.mdt.snapshot(s4CaseId)).toEqual(frozen)
    const board = await mutation(api.updateMdtBoardMembersMutation(), { headers, path: { board_id: original.board_id }, body: { members: [{ name: 'Jiný fiktivní člen', specialty: 'Chirurgie' }] } })
    expectApiResponse('update_mdt_board_members', 200, board)
    expect(demoState.mdt.record(s4CaseId)?.members).toEqual(updated.members)
    expect(demoState.mdt.record(s4CaseId)?.mdt_question).toBe('Ručně upravená otázka zápisu')
  })

  it('saves a written draft separately from confirmation and records the definitive code only after confirmation', async () => {
    completeCase(); resolveBlockers(); await snapshot()
    const result = demoState.documents.result(s4CaseId)
    if (!result) throw new Error('Missing fixture')
    demoState.documents.saveResult(s4CaseId, { ...result, findings: [...result.findings, { id: 'definitive-code', kind: 'missing', severity: 'warning', fields: ['diagnosis_code'], suggested_action: 'review', message_cs: 'Fiktivní potřeba definitivního kódu.', resolved: false }] })
    const conclusion = await mutation(api.upsertMdtConclusionMutation(), { ...options, body: { conclusion: 'Fiktivní závěr – bez doporučení léčby.', diagnosis_code: 'Z00.0', recommendations: ['Fiktivní doporučení.'], ai_draft_used: true } })
    expectApiResponse('upsert_mdt_conclusion', 200, conclusion)
    expect(conclusion.confirmed).toBeNull()
    expect(demoState.getCases().find((item) => item.id === s4CaseId)?.state).toBe('pripraveno_k_mdt')
    expectApiResponse('get_mdt_conclusion', 200, await createQueryClient().fetchQuery(api.getMdtConclusionOptions(options)))
    const confirmed = await mutation(api.confirmMdtConclusionMutation(), options)
    expectApiResponse('confirm_mdt_conclusion', 200, confirmed)
    expect(confirmed.confirmed?.by).toBe('koordinator')
    expect(demoState.getCases().find((item) => item.id === s4CaseId)).toMatchObject({ state: 'zaver_mdt', milestones: { mdt_held: '2026-10-21' } })
    expect(demoState.documents.result(s4CaseId)?.handover.diagnosis_code).toMatchObject({ origin: 'manual', value: 'Z00.0', entered: { by: 'koordinator' } })
    expect(demoState.documents.result(s4CaseId)?.findings.find((finding) => finding.id === 'definitive-code')?.resolved).toBe(true)
    await expect(mutation(api.updateMdtRecordMutation(), { ...options, body: { mdt_question: 'late edit' } })).rejects.toMatchObject({ status: 409 })
  })

  it('returns queued, running and completed draft jobs without applying or confirming their text', async () => {
    let now = 0
    const state = createDemoState(() => now); server.use(...createHandlers(state))
    const item = state.getCases().find((item) => item.id === s4CaseId)
    if (!item) throw new Error('Missing fixture')
    state.saveCase({ ...item, state: 'kompletni' })
    for (const kind of ['epicrisis_summary', 'mdt_question', 'mdt_results', 'mdt_conclusion'] as const) {
      const job = await mutation(api.createDraftMutation(), { ...options, body: { kind } })
      expectApiResponse('create_draft', 202, job)
      expect(job.status).toBe('queued'); expect(job.result).toBeNull()
      now += 1500
      const running = await createQueryClient().fetchQuery(api.getJobOptions({ headers, path: { job_id: job.id } }))
      expect(running.status).toBe('running')
      now += 2000
      const done = await createQueryClient().fetchQuery(api.getJobOptions({ headers, path: { job_id: job.id } }))
      expectApiResponse('get_job', 200, done)
      expect(done).toMatchObject({ status: 'done', result: { text: demoDraftText } })
    }
    expect(state.documents.result(s4CaseId)?.handover.epicrisis?.value).toBeNull()
    expect(state.mdt.conclusion(s4CaseId)).toBeUndefined()
    expectApiResponse('list_case_jobs', 200, await createQueryClient().fetchQuery(api.listCaseJobsOptions(options)))
  })

  it('rejects foreign roles/KOCs, wrong boards, unknown cases and invalid dates without modifying the case', async () => {
    completeCase(); resolveBlockers()
    const body = { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' }
    for (const actor of ['pl-reznicek', 'koord-severni']) await expect(mutation(api.createMdtSnapshotMutation(), { ...options, headers: actorHeaders(actor), body })).rejects.toMatchObject({ status: 403 })
    await expect(mutation(api.createMdtSnapshotMutation(), { ...options, body: { ...body, board_id: 'not-this-KOC' } })).rejects.toMatchObject({ status: 400 })
    await expect(mutation(api.createMdtSnapshotMutation(), { ...options, body: { ...body, mdt_date: '2026-02-30' } })).rejects.toMatchObject({ status: 422 })
    await expect(createQueryClient().fetchQuery(api.getMdtRecordOptions({ ...options, path: { case_id: 'unknown' } }))).rejects.toMatchObject({ status: 404 })
    expect(demoState.mdt.record(s4CaseId)).toBeUndefined()
  })

  it('serves labelled PDF fixtures through binary endpoints and clears MDT state on reset', async () => {
    completeCase(); resolveBlockers(); await snapshot()
    const record = await createQueryClient().fetchQuery(api.getMdtRecordPdfOptions({ ...options, parseAs: 'text' }))
    expect(typeof record).toBe('string')
    expect(String(record)).toContain('%PDF-1.4')
    expect(String(record)).toContain('no medical data')
    demoState.reset('empty')
    expect(demoState.mdt.record(s4CaseId)).toBeUndefined()
    expect(demoState.mdt.snapshot(s4CaseId)).toBeUndefined()
    expect(demoState.mdt.boards().find((board) => board.id === 'mdt-git-lipova')?.members?.length).toBeGreaterThan(0)
  })
})
