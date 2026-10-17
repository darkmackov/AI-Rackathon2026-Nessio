import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import { createMdtSnapshotMutation, getMdtConclusionPdfOptions, uploadMdtConclusionMutation, upsertMdtConclusionMutation } from '../client/@tanstack/react-query.gen'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { s4CaseId } from '../mocks/coordinator-state'
import { completeCase, mutation, resolveBlockers } from './mdt-fixtures'
import { openCoordinatorCase, openTab } from './shell'
import { demoState, server } from './setup'
import { expectApiResponse } from './api-contract'

beforeAll(async () => {
  const form = await new Response('a=b', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData()
  vi.stubGlobal('FormData', form.constructor); vi.stubGlobal('File', NodeFile); vi.stubGlobal('Blob', NodeBlob)
})
afterAll(() => vi.unstubAllGlobals())
const headers = actorHeaders('koordinator'), path = { case_id: s4CaseId }
async function prepare(state = demoState) {
  completeCase(state); resolveBlockers(state)
  return mutation(createMdtSnapshotMutation(), { headers, path, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
}
async function openMdt() {
  const view = await openCoordinatorCase(s4CaseId, 'Fiktivní pacient S4', { notifications: true, user: { applyAccept: false } }), { user } = view
  await openTab(user, 'MDT')
  await user.click(await screen.findByRole('radio', { name: 'Nahrát dokument' }))
  expect(screen.queryByRole('region', { name: 'Zapsat závěr' })).not.toBeInTheDocument()
  await screen.findByRole('button', { name: 'Nahrát dokument závěru' })
  return { ...view, user }
}
const pdf = () => new File(['%PDF-1.4\nfictional uploaded document'], 'fiktivni-zaver.pdf', { type: 'application/pdf' })

describe('S5 upload and cut-off', () => {
  it('retains the selected file after upload failure and can retry through the same API contract', async () => {
    await prepare()
    server.use(http.post('*/api/cases/:id/mdt/conclusion/upload', () => HttpResponse.json({ detail: 'private upload failure' }, { status: 500 })))
    const { user } = await openMdt()
    await user.upload(screen.getByLabelText('Vybrat závěr MDT'), pdf())
    await user.click(screen.getByRole('button', { name: 'Nahrát dokument závěru' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.getByText('fiktivni-zaver.pdf')).toBeVisible()
    expect(screen.queryByText('private upload failure')).not.toBeInTheDocument()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Nahrát dokument závěru' }))
    expect(await screen.findByText('Nahraný závěr')).toBeVisible()
  })

  it('refuses a snapshot whose handover quotes a document received after the MDT date', async () => {
    let now = 0
    const state = createDemoState(() => now); server.use(...createHandlers(state)); completeCase(state); resolveBlockers(state)
    const upload = state.documents.upload(s4CaseId, pdf(), 'koordinator', '2026-10-22T08:00:00', state.clock().now)
    now = 3500; state.documents.readJob(upload.job.id, state.clock().now)
    const live = state.documents.result(s4CaseId)
    if (!live) throw new Error('Missing fixture')
    const evidence = [{ document_id: upload.document.id, quote: 'FIKTIVNÍ UKÁZKA – nejde o text nahraného souboru.' }]
    state.documents.saveHandover({ ...live.handover, other: { origin: 'ai', status: 'found', value: 'Fiktivní pozdní údaj', evidence }, examinations: [{ date: '2026-10-20', place: 'Fiktivní pracoviště', type: 'Fiktivní pozdní kontrola', result_full_text: 'Fiktivní pozdní údaj', origin: 'ai', evidence }] })
    // Refused rather than silently filtered (Q-F39), even though the examination date precedes the MDT.
    await expect(mutation(createMdtSnapshotMutation(), { headers, path, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })).rejects.toMatchObject({ status: 409 })
    expect(state.mdt.snapshot(s4CaseId)).toBeUndefined()
    expect(state.mdt.record(s4CaseId)).toBeUndefined()
    expect(state.getCases().find((item) => item.id === s4CaseId)?.state).toBe('kompletni')
  })

  it('keeps the upload response within the generated models, serves the uploaded PDF and keeps it the source when fields are typed in', async () => {
    await prepare()
    await expect(mutation(uploadMdtConclusionMutation(), { headers, path, body: { file: new File(['invalid'], 'file.exe', { type: 'application/octet-stream' }) } })).rejects.toMatchObject({ status: 415 })
    expect(demoState.mdt.conclusion(s4CaseId)).toBeUndefined()
    await mutation(upsertMdtConclusionMutation(), { headers, path, body: { presented_by: 'Fiktivní lékař' } })
    const uploaded = await mutation(uploadMdtConclusionMutation(), { headers, path, body: { file: pdf() } })
    expectApiResponse('upload_mdt_conclusion', 201, uploaded)
    expect(uploaded.document).toMatchObject({ case_id: s4CaseId, uploaded_by: 'koordinator', doc_type: 'mdt_conclusion' })
    expect(uploaded.job.case_id).toBe(s4CaseId)
    // Fields typed in earlier stay; the report stays the source when more are added (Q-F38).
    expect(demoState.mdt.conclusion(s4CaseId)).toMatchObject({ source: 'uploaded', document_id: uploaded.document.id, presented_by: 'Fiktivní lékař' })
    const typed = await mutation(upsertMdtConclusionMutation(), { headers, path, body: { diagnosis_code: 'Z00.0' } })
    expect(typed).toMatchObject({ source: 'uploaded', document_id: uploaded.document.id, diagnosis_code: 'Z00.0' })
    const served = await createQueryClient().fetchQuery(getMdtConclusionPdfOptions({ headers, path, parseAs: 'text' }))
    expect(String(served)).toContain('fictional uploaded document')
  })
})
