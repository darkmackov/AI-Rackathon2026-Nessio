/// <reference types="node" />
import { readFileSync } from 'node:fs'
import type { UseMutationOptions } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import * as api from '../client/@tanstack/react-query.gen'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { s8Documents, s8Handover, s8Texts } from '../mocks/s8-data'
import { expectApiResponse } from './api-contract'
import { server } from './setup'

const headers = actorHeaders('koordinator')
const scoped = (id = 'demo-s8') => ({ path: { case_id: id }, headers })
function mutation<T, E, V>(options: UseMutationOptions<T, E, V>, variables: V) {
  const client = createQueryClient()
  return client.getMutationCache().build(client, options).execute(variables)
}

describe('S8 dummy HTTP contract', () => {
  it('keeps its source snapshots identical to reference-2 canonical reports', () => {
    for (const document of s8Documents) expect(s8Texts[document.id]).toBe(readFileSync(`../../data/reference-2/reports/${document.filename}`, 'utf8').replace(/\r\n/g, '\n'))
  })
  it('answers from both reference cases with exact, case-scoped evidence through a normal job', async () => {
    let ticks = 0
    const state = createDemoState(() => ticks)
    server.resetHandlers(...createHandlers(state))
    const client = createQueryClient()
    for (const id of ['vzp-prochazkova', 'demo-s8']) {
      for (const question of ['Jaký byl nález na CT?', 'Jaká je histologie?', 'Jaké jsou laboratorní výsledky?']) {
        const job = await mutation(api.askCaseMutation(), { ...scoped(id), body: { question } })
        expectApiResponse('ask_case', 202, job)
        expect(job).toMatchObject({ kind: 'ask_case', status: 'queued', case_id: id })
        ticks += 1000
        const running = await client.fetchQuery(api.getJobOptions({ path: { job_id: job.id }, headers }))
        expect(running.status).toBe('running')
        ticks += 2000
        const done = await client.fetchQuery(api.getJobOptions({ path: { job_id: job.id }, headers }))
        expectApiResponse('get_job', 200, done)
        expect(done).toMatchObject({ status: 'done', answer: { found: true, question } })
        expect(done.answer?.quotes?.length).toBeGreaterThan(0)
        for (const quote of done.answer?.quotes ?? []) {
          expect(state.documents.get(quote.document_id)?.case_id).toBe(id)
          expect(Array.from(state.documents.text(quote.document_id)).slice(quote.start ?? undefined, quote.end ?? undefined).join('')).toBe(quote.quote)
        }
      }
      const jobs = await client.fetchQuery(api.listCaseJobsOptions(scoped(id)))
      expectApiResponse('list_case_jobs', 200, jobs)
      expect(jobs.filter((job) => job.kind === 'ask_case')).toHaveLength(3)
    }
  })

  it('uses the submission-time cut-off, returns not found for unknown questions and clears jobs on reset', async () => {
    let ticks = 0
    const state = createDemoState(() => ticks)
    server.resetHandlers(...createHandlers(state))
    const client = createQueryClient()
    state.setTime('2026-10-08T09:00:00')
    const early = await mutation(api.askCaseMutation(), { ...scoped(), body: { question: 'Jaký byl nález na CT?' } })
    state.setTime('2026-10-21T09:00:00')
    ticks += 3000
    const result = await client.fetchQuery(api.getJobOptions({ headers, path: { job_id: early.id } }))
    expect(result.answer).toMatchObject({ found: false, quotes: [] })
    const unknown = await mutation(api.askCaseMutation(), { ...scoped(), body: { question: 'Jakou má pacient oblíbenou barvu?' } })
    ticks += 3000
    expect((await client.fetchQuery(api.getJobOptions({ headers, path: { job_id: unknown.id } }))).answer?.found).toBe(false)
    state.reset('empty')
    await expect(client.fetchQuery(api.getJobOptions({ headers, path: { job_id: early.id } }))).rejects.toMatchObject({ status: 404 })
    state.reset('reference_at_mdt')
    expect(await client.fetchQuery(api.listCaseJobsOptions(scoped()))).toEqual([])
    await expect(mutation(api.askCaseMutation(), { ...scoped(), body: { question: '  ' } })).rejects.toMatchObject({ status: 422 })
  })

  it('saves only a current code candidate with manual provenance and audit, without resolving findings', async () => {
    const state = createDemoState()
    server.resetHandlers(...createHandlers(state))
    const client = createQueryClient()
    const candidates = await client.fetchQuery(api.listCodeCandidatesOptions(scoped()))
    expectApiResponse('list_code_candidates', 200, candidates)
    expect(candidates).toEqual([{ code: 'C20', title_cs: 'Zhoubný novotvar konečníku' }])
    const findings = state.documents.result('demo-s8')?.findings
    await expect(mutation(api.pickDiagnosisCodeMutation(), { ...scoped(), body: { code: 'C25.0' } })).rejects.toMatchObject({ status: 400 })
    await expect(mutation(api.pickDiagnosisCodeMutation(), { ...scoped(), headers: actorHeaders('pl-reznicek'), body: { code: 'C20' } })).rejects.toMatchObject({ status: 403 })
    const updated = await mutation(api.pickDiagnosisCodeMutation(), { ...scoped(), body: { code: 'C20' } })
    expectApiResponse('pick_diagnosis_code', 200, updated)
    expect(updated.diagnosis_code).toMatchObject({ value: 'C20', status: 'found', origin: 'manual', entered: { by: 'koordinator' } })
    expect(state.documents.result('demo-s8')?.findings).toEqual(findings)
    const audit = await client.fetchQuery(api.listAuditOptions(scoped()))
    expectApiResponse('list_audit', 200, audit)
    expect(audit).toContainEqual(expect.objectContaining({ action: 'diagnosis_code_from_ai', actor_id: 'koordinator', detail: expect.stringContaining('C20') }))
    await expect(client.fetchQuery(api.listCodeCandidatesOptions(scoped()))).rejects.toMatchObject({ status: 409 })
    state.reset('reference_at_mdt')
    state.documents.saveHandover({ ...s8Handover, diagnosis: { value: null, status: 'missing', origin: 'ai' } })
    await expect(client.fetchQuery(api.listCodeCandidatesOptions(scoped()))).rejects.toMatchObject({ status: 409 })
  })

  it('keeps ask, draft and ingest jobs in one list without mixing their results', async () => {
    const state = createDemoState()
    server.resetHandlers(...createHandlers(state))
    const ingest = state.documents.createJob('demo-s8', state.clock().now)
    const ask = await mutation(api.askCaseMutation(), { ...scoped(), body: { question: 'Jaká je histologie?' } })
    const draft = await mutation(api.createDraftMutation(), { ...scoped(), body: { kind: 'epicrisis_summary' } })
    const jobs = await createQueryClient().fetchQuery(api.listCaseJobsOptions(scoped()))
    expect(jobs.map((job) => job.id)).toEqual(expect.arrayContaining([ingest.id, ask.id, draft.id]))
    expect(jobs.find((job) => job.id === ingest.id)?.answer).toBeUndefined()
    expect(jobs.find((job) => job.id === ask.id)?.kind).toBe('ask_case')
  })
})
