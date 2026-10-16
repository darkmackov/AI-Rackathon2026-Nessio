import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { actorHeaders } from '../api'
import { getHandoverQueryKey, getJobQueryKey } from '../client/@tanstack/react-query.gen'
import { demoDocumentText } from '../mocks/documents'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { renderApp } from './renderApp'
import { field, openTab, signIn } from './shell'
import { server } from './setup'

// Keep File/FormData compatible with Node Fetch at the mocked HTTP boundary.
beforeAll(async () => {
  const form = await new Response('a=b', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData()
  vi.stubGlobal('FormData', form.constructor)
  vi.stubGlobal('File', NodeFile)
  vi.stubGlobal('Blob', NodeBlob)
})
afterAll(() => vi.unstubAllGlobals())

describe('S3 reuses S2 document ingest', () => {
  it.each(['koncept', 'vraceno_lekari'] as const)('uploads to the current %s case, follows job states and refreshes handover and findings', async (caseState) => {
    let now = 0
    const state = createDemoState(() => now)
    state.reset('empty')
    const caseId = `ingest-${caseState}`
    state.saveCase({ id: caseId, patient_name: 'Fiktivní žádost', koc_id: 'koc2-lipova', referring_doctor_id: 'pl-reznicek', state: caseState, queue: 'novy', created_at: '2026-10-02T14:00:00' })
    state.documents.saveHandover({ case_id: caseId, as_of: '2026-10-02' })
    server.use(...createHandlers(state))
    const { queryClient } = renderApp()
    const user = userEvent.setup({ applyAccept: false })
    await signIn(user, 'referring_doctor')
    await user.click(await screen.findByRole('link', { name: 'Fiktivní žádost' }))
    await screen.findByRole('heading', { level: 1, name: 'Fiktivní žádost' })
    await user.upload(screen.getByLabelText('Vybrat soubory'), new File(['invalid'], 'nepodporovany.txt', { type: 'text/plain' }))
    expect(await screen.findByText('nepodporovany.txt')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' })).toBeDisabled()
    const file = new File(['%PDF-1.4\nfictional local test'], 'fiktivni-zprava.pdf', { type: 'application/pdf' })
    // The same drop interaction as the uploader in S2, exercised inside the actual GP route.
    fireEvent.drop(screen.getByText('Přetáhněte dokumenty sem nebo vyberte soubory.'), { dataTransfer: { files: [file] } })
    await user.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByText('Nahráno, stav AI níže')).toBeVisible()
    expect(await screen.findByText('Čeká na zpracování')).toBeVisible()
    expect(state.documents.list(caseId)).toMatchObject([{ case_id: caseId, filename: file.name, uploaded_by: 'pl-reznicek' }])
    expect(screen.getByRole('button', { name: 'Validovat a odeslat', hidden: true })).toBeDisabled()
    const job = state.documents.listJobs(caseId, state.clock().now)[0]
    const headers = actorHeaders('pl-reznicek')
    const jobKey = getJobQueryKey({ headers, path: { job_id: job.id } })
    now = 1500
    await act(async () => { await queryClient.refetchQueries({ queryKey: jobKey }) })
    expect(await screen.findByText('Probíhá AI extrakce')).toBeVisible()
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: jobKey }) })
    expect(await screen.findByText('Dokončeno')).toBeVisible()
    await openTab(user, 'Předávka')
    const handover = queryClient.getQueryData(getHandoverQueryKey({ headers, path: { case_id: caseId } }))
    expect(handover).toMatchObject({ case_id: caseId, symptoms: { status: 'found', origin: 'ai' }, validated_by_referrer: null })
    expect(await screen.findByRole('article', { name: 'Fiktivní ukázka: chybí ECOG / Karnofsky.' })).toBeVisible()
    await user.click(within(screen.getByRole('heading', { level: 2, name: /^Anamnézy a stav/ })).getByRole('button'))
    const symptoms = field('Příznaky a jejich počátek')
    expect(within(symptoms).getByText('V ukázkové zprávě je uvedena únava.')).toBeVisible()
    expect(within(symptoms).getByText('AI návrh')).toBeVisible()
    await user.click(within(symptoms).getByRole('button', { name: /^Zdroj / }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(await within(source).findByTestId('document-text')).toHaveTextContent(demoDocumentText.split('\n')[0])
    expect(source.querySelector('mark')).not.toBeNull()
    await user.click(within(source).getByRole('button', { name: 'Zavřít zdroj' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validovat a odeslat' })).toBeEnabled())
  })

  it('shows a safe extraction failure and offers the shared re-extraction action', async () => {
    const state = createDemoState()
    state.reset('empty')
    state.saveCase({ id: 'failed-job-case', patient_name: 'Fiktivní chyba', koc_id: 'koc2-lipova', referring_doctor_id: 'pl-reznicek', state: 'koncept', created_at: '2026-10-02T14:00:00' })
    state.documents.saveHandover({ case_id: 'failed-job-case', as_of: '2026-10-02' })
    const uploaded = state.documents.upload('failed-job-case', new File(['fictional'], 'zprava.pdf', { type: 'application/pdf' }), 'pl-reznicek', state.clock().now, state.clock().now)
    server.use(...createHandlers(state))
    const failed = { ...uploaded.job, status: 'failed', error: 'sensitive technical details' } as const
    server.use(http.get('*/api/jobs/:id', () => HttpResponse.json(failed)), http.get('*/api/cases/:id/jobs', () => HttpResponse.json([failed])))
    renderApp()
    const user = userEvent.setup()
    await signIn(user, 'referring_doctor')
    await user.click(await screen.findByRole('link', { name: 'Fiktivní chyba' }))
    expect(await screen.findByText('Chyba zpracování')).toBeVisible()
    expect(screen.getByText('Dokument se nepodařilo zpracovat. Můžete znovu spustit extrakci dokumentů případu.')).toBeVisible()
    expect(screen.queryByText('sensitive technical details')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Znovu spustit extrakci' })).toBeEnabled()
    await openTab(user, 'Předávka')
    expect(screen.getByRole('button', { name: 'Validovat a odeslat' })).toBeEnabled()
  })
})
