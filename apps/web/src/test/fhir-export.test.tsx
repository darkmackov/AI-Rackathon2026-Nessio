import { Blob as NodeBlob } from 'node:buffer'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import { getCaseFhirOptions } from '../client/@tanstack/react-query.gen'
import { changeLanguage } from '../i18n'
import { renderApp } from './renderApp'
import { seedReferral } from './referral-fixtures'
import { changeIdentity, openReferenceCase, signIn } from './shell'
import { demoState, server } from './setup'

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fhir-export')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  server.events.removeAllListeners('request:start')
  vi.unstubAllGlobals()
})

describe('S9 FHIR export', () => {
  it.each(['coordinator', 'referring_doctor'] as const)('downloads on explicit click as %s, using current case/actor and revoking file URLs', async (role) => {
    const requests: Request[] = []
    server.events.on('request:start', ({ request }) => { if (request.url.endsWith('/fhir')) requests.push(request) })
    const view = renderApp(), user = userEvent.setup()
    let caseId = 'vzp-prochazkova'
    if (role === 'coordinator') await openReferenceCase(user)
    else {
      caseId = 'another-fhir-case'
      seedReferral(caseId, { state: 'odeslano', patient_name: 'Fiktivní export' })
      await signIn(user, role)
      await user.click(await screen.findByRole('link', { name: 'Fiktivní export' }))
      await screen.findByRole('heading', { name: 'Fiktivní export', level: 1 })
    }
    expect(requests).toEqual([])
    const item = structuredClone(demoState.getCases().find((item) => item.id === caseId))
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    expect(await screen.findByText('FHIR soubor byl připraven ke stažení.')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0].headers.get('X-Actor-Id')).toBe(role === 'coordinator' ? 'koordinator' : 'pl-reznicek')
    expect(requests[0].url).toContain(`/cases/${caseId}/fhir`)
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    const file = vi.mocked(URL.createObjectURL).mock.calls[0][0]
    expect(file).toBeInstanceOf(Blob)
    if (!(file instanceof Blob)) throw new Error('Expected a Blob')
    expect(file.type).toContain('application/fhir+json')
    const bundle = JSON.parse(await file.text())
    expect(bundle.identifier.value).toBe(caseId)
    expect(bundle.meta.tag[0].display).toContain('FIKTIVNÍ UKÁZKA')
    expect(bundle.entry).toEqual([])
    expect(view.container.querySelector(`a[download="case-${caseId}.fhir.json"]`)).toHaveAttribute('href', 'blob:fhir-export')
    expect(demoState.getCases().find((entry) => entry.id === caseId)).toEqual(item)
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fhir-export')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it.each([
    [403, 'Pro export tohoto případu nemáte oprávnění.'],
    [404, 'Data případu zatím nejsou ve FHIR serveru dostupná. Zkuste export později.'],
    [502, 'FHIR server nyní export neposkytl. Zkuste to znovu později.'],
    [503, 'FHIR export není na serveru nastavený. Obraťte se na správce aplikace.'],
    [0, 'FHIR export se nepodařilo stáhnout. Zkuste to znovu.'],
  ])('shows a safe %s error, creates no file and allows retry', async (status, message) => {
    server.use(http.get('*/api/cases/:id/fhir', () => status === 0 ? HttpResponse.error() : HttpResponse.json({ detail: 'private technical details' }, { status: Number(status) })))
    renderApp(); const user = userEvent.setup(); await openReferenceCase(user)
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    expect(await screen.findByText(message)).toHaveAttribute('role', 'alert')
    expect(screen.queryByText('private technical details')).not.toBeInTheDocument()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    expect(await screen.findByText('FHIR soubor byl připraven ke stažení.')).toBeVisible()
  })

  it('follows a new case id and translates labels without reusing the old download', async () => {
    seedReferral('export-a', { patient_name: 'Fiktivní A', state: 'odeslano' })
    seedReferral('export-b', { patient_name: 'Fiktivní B', state: 'odeslano' })
    const { router } = renderApp(), user = userEvent.setup()
    await signIn(user, 'referring_doctor')
    await user.click(await screen.findByRole('link', { name: 'Fiktivní A' }))
    await screen.findByRole('heading', { name: 'Fiktivní A', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    await screen.findByText('FHIR soubor byl připraven ke stažení.')
    await act(async () => { await router.navigate({ to: '/referrer/cases/$caseId', params: { caseId: 'export-b' } }) })
    await screen.findByRole('heading', { name: 'Fiktivní B', level: 1 })
    expect(screen.queryByText('FHIR soubor byl připraven ke stažení.')).not.toBeInTheDocument()
    await act(async () => { await changeLanguage('en') })
    await user.click(screen.getByRole('button', { name: 'Export FHIR' }))
    await screen.findByText('The FHIR file is ready to download.')
    const file = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0]
    if (!(file instanceof Blob)) throw new Error('Expected a Blob')
    expect(JSON.parse(await file.text()).identifier.value).toBe('export-b')
  })

  it('shows pending state and never downloads stale data when a new request fails', async () => {
    renderApp(); const user = userEvent.setup(); await openReferenceCase(user)
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    await screen.findByText('FHIR soubor byl připraven ke stažení.')
    let release: (() => void) | undefined
    server.use(http.get('*/api/cases/:id/fhir', async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return HttpResponse.json({ detail: 'unavailable' }, { status: 502 })
    }))
    const button = screen.getByRole('button', { name: 'Exportovat FHIR' })
    await user.click(button)
    await waitFor(() => expect(release).toBeDefined())
    try {
      expect(button).toBeDisabled()
      expect(screen.queryByText('FHIR soubor byl připraven ke stažení.')).not.toBeInTheDocument()
    } finally {
      await act(async () => { release?.() })
    }
    expect(await screen.findByText('FHIR server nyní export neposkytl. Zkuste to znovu později.')).toBeVisible()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
  })

  it('does not create a file if identity changes before the download finishes', async () => {
    let release: (() => void) | undefined
    server.use(http.get('*/api/cases/:id/fhir', async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return new HttpResponse('{}', { headers: { 'Content-Type': 'application/fhir+json' } })
    }))
    renderApp(); const user = userEvent.setup(); await openReferenceCase(user)
    await user.click(screen.getByRole('button', { name: 'Exportovat FHIR' }))
    await waitFor(() => expect(release).toBeDefined())
    try {
      await changeIdentity(user)
      await signIn(user, 'referring_doctor')
    } finally {
      await act(async () => { release?.() })
    }
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('enforces actor and case authorization at the mock HTTP boundary', async () => {
    const query = createQueryClient()
    const options = { path: { case_id: 'vzp-prochazkova' }, parseAs: 'blob' as const }
    await expect(query.fetchQuery(getCaseFhirOptions({ ...options, headers: actorHeaders('pl-novakova') }))).rejects.toMatchObject({ status: 403 })
    await expect(query.fetchQuery(getCaseFhirOptions({ ...options, headers: actorHeaders('koord-severni') }))).rejects.toMatchObject({ status: 403 })
    await expect(query.fetchQuery(getCaseFhirOptions({ ...options, path: { case_id: 'missing' }, headers: actorHeaders('koordinator') }))).rejects.toMatchObject({ status: 404 })
  })
})
