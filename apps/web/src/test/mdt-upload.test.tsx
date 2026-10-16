import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { actorHeaders } from '../api'
import { createMdtSnapshotMutation, getJobQueryKey, uploadMdtConclusionMutation } from '../client/@tanstack/react-query.gen'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { s4CaseId } from '../mocks/coordinator-state'
import { renderApp } from './renderApp'
import { completeCase, mutation, resolveBlockers } from './mdt-fixtures'
import { openTab, signIn } from './shell'
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
  const view = renderApp(), user = userEvent.setup({ applyAccept: false })
  await signIn(user); await user.click(await screen.findByRole('link', { name: 'Fiktivní pacient S4' })); await screen.findByRole('heading', { level: 1, name: 'Fiktivní pacient S4' }); await openTab(user, 'MDT')
  await screen.findByRole('button', { name: 'Nahrát dokument závěru' })
  return { ...view, user }
}
const pdf = () => new File(['%PDF-1.4\nfictional uploaded document'], 'fiktivni-zaver.pdf', { type: 'application/pdf' })

describe('S5 upload and cut-off', () => {
  it('uploads a conclusion to its own endpoint, follows processing and requires confirmation after viewing the source', async () => {
    let now = 0
    const state = createDemoState(() => now); server.use(...createHandlers(state)); await prepare(state)
    const { user, queryClient } = await openMdt()
    await user.upload(screen.getByLabelText('Vybrat závěr MDT'), new File(['invalid'], 'wrong.txt', { type: 'text/plain' }))
    expect(await screen.findByText('Vyberte podporovaný dokument PDF, DOCX nebo PPTX.')).toBeVisible()
    await user.upload(screen.getByLabelText('Vybrat závěr MDT'), pdf())
    await user.click(screen.getByRole('button', { name: 'Nahrát dokument závěru' }))
    expect(await screen.findByText('Čeká na zpracování')).toBeVisible()
    expect(state.mdt.conclusion(s4CaseId)).toBeUndefined()
    const job = state.mdt.jobs(s4CaseId).find((job) => job.kind === 'ingest_document')
    if (!job) throw new Error('Missing upload job')
    const jobKey = getJobQueryKey({ headers, path: { job_id: job.id } })
    now = 1500
    await act(async () => { await queryClient.refetchQueries({ queryKey: jobKey }) })
    expect(await screen.findByText('Probíhá AI extrakce')).toBeVisible()
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: jobKey }) })
    expect(await screen.findByText('Nahraný závěr')).toBeVisible()
    expect(state.mdt.conclusion(s4CaseId)).toMatchObject({ source: 'uploaded', document_id: job.document_id, confirmed: null })
    expectApiResponse('get_mdt_conclusion', 200, state.mdt.conclusion(s4CaseId))
    await user.click(screen.getByRole('button', { name: 'Otevřít nahraný závěr' }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(await within(source).findByTestId('document-text')).toHaveTextContent('FIKTIVNÍ UKÁZKA')
    await user.click(within(source).getByRole('button', { name: 'Zavřít zdroj' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Potvrdit závěr MDT' })).toBeEnabled())
    expect(state.mdt.conclusion(s4CaseId)?.confirmed).toBeNull()
    expect((await state.documents.original(job.document_id ?? ''))?.name).toBe('fiktivni-zaver.pdf')
  })

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
    expect(await screen.findByText('Čeká na zpracování')).toBeVisible()
  })

  it('excludes a late received document even when its examination date precedes the snapshot date', async () => {
    let now = 0
    const state = createDemoState(() => now); server.use(...createHandlers(state)); completeCase(state); resolveBlockers(state)
    const upload = state.documents.upload(s4CaseId, pdf(), 'koordinator', '2026-10-22T08:00:00', state.clock().now)
    now = 3500; state.documents.readJob(upload.job.id, state.clock().now)
    const live = state.documents.result(s4CaseId)
    if (!live) throw new Error('Missing fixture')
    const evidence = [{ document_id: upload.document.id, quote: 'FIKTIVNÍ UKÁZKA – nejde o text nahraného souboru.' }]
    state.documents.saveHandover({ ...live.handover, other: { origin: 'ai', status: 'found', value: 'Fiktivní pozdní údaj', evidence }, examinations: [{ date: '2026-10-20', place: 'Fiktivní pracoviště', type: 'Fiktivní pozdní kontrola', result_full_text: 'Fiktivní pozdní údaj', origin: 'ai', evidence }] })
    await mutation(createMdtSnapshotMutation(), { headers, path, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
    expect(state.mdt.snapshot(s4CaseId)?.other).toBeUndefined()
    expect(state.mdt.record(s4CaseId)?.results).toEqual([])
    expect(state.documents.result(s4CaseId)?.handover.other?.value).toBe('Fiktivní pozdní údaj')
  })

  it('keeps the upload response within the generated models and returns safe errors for unsupported files', async () => {
    await prepare()
    const uploaded = await mutation(uploadMdtConclusionMutation(), { headers, path, body: { file: pdf() } })
    expectApiResponse('upload_mdt_conclusion', 201, uploaded)
    expect(uploaded.document).toMatchObject({ case_id: s4CaseId, uploaded_by: 'koordinator' })
    expect(uploaded.job.case_id).toBe(s4CaseId)
    await expect(mutation(uploadMdtConclusionMutation(), { headers, path, body: { file: new File(['invalid'], 'file.exe', { type: 'application/octet-stream' }) } })).rejects.toMatchObject({ status: 415 })
  })
})
