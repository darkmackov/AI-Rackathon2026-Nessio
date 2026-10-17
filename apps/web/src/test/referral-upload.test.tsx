import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { openReferrerCase, openTab } from './shell'
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
  // Upload in each editable state is covered by documents.test.tsx; this checks the GP route reuses it.
  it('shows the historical extraction failure status and offers the shared re-extraction action', async () => {
    const state = createDemoState()
    state.reset('empty')
    state.saveCase({ id: 'failed-job-case', patient_name: 'Fiktivní chyba', koc_id: 'koc2-lipova', referring_doctor_id: 'pl-reznicek', state: 'koncept', created_at: '2026-10-02T14:00:00' })
    state.documents.saveHandover({ case_id: 'failed-job-case', as_of: '2026-10-02' })
    const uploaded = state.documents.upload('failed-job-case', new File(['fictional'], 'zprava.pdf', { type: 'application/pdf' }), 'pl-reznicek', state.clock().now, state.clock().now)
    server.use(...createHandlers(state))
    const failed = { ...uploaded.job, status: 'failed', error: 'sensitive technical details' } as const
    server.use(http.get('*/api/jobs/:id', () => HttpResponse.json(failed)), http.get('*/api/cases/:id/jobs', () => HttpResponse.json([failed])))
    const { user } = await openReferrerCase('failed-job-case', 'Fiktivní chyba', { notifications: true })
    expect(await screen.findByText('Chyba zpracování')).toBeVisible()
    expect(screen.queryByText('Dokument se nepodařilo zpracovat. Můžete znovu spustit extrakci dokumentů případu.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('sensitive technical details')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Znovu spustit extrakci' })).toBeEnabled()
    await openTab(user, 'Předávka')
    expect(screen.getByRole('button', { name: 'Validovat a odeslat' })).toBeEnabled()
  })
})
