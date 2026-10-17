import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { actorHeaders } from '../api'
import { getCaseQueryKey } from '../client/@tanstack/react-query.gen'
import type { Case } from '../client/types.gen'
import { changeLanguage } from '../i18n'
import { renderApp } from './renderApp'
import { seedReferral } from './referral-fixtures'
import { openTab, signIn } from './shell'
import { demoState, server } from './setup'

const caseId = 'readiness-example'
const markComplete = 'Označit podklady za kompletní'
const wait = 'Čekat na podklady'
const waitAgain = 'Znovu čekat na podklady'

async function openCase(state: Case['state']) {
  const item = seedReferral(caseId, { patient_name: 'Fiktivní kontrola podkladů', state, coordinator_id: 'koordinator' })
  demoState.documents.saveResult(caseId, {
    handover: { case_id: caseId, as_of: '2026-10-21' },
    findings: [{ id: 'readiness-missing', kind: 'missing', severity: 'blocker', message_cs: 'Fiktivní chybějící údaj.', resolved: false }],
  })
  const view = renderApp(), user = userEvent.setup()
  await signIn(user)
  await act(async () => { await view.router.navigate({ to: '/coordinator/cases/$caseId', params: { caseId }, search: { tab: 'overview' } }) })
  await screen.findByRole('heading', { name: item.patient_name, level: 1 })
  await screen.findByRole('heading', { name: 'Údaje o případu' })
  return { ...view, user }
}

afterEach(() => server.events.removeAllListeners('request:start'))

describe('Coordinator document readiness actions', () => {
  it.each([
    { state: 'v_triage', expected: [markComplete, wait] },
    { state: 'ceka_na_podklady', expected: [markComplete] },
    { state: 'kompletni', expected: [waitAgain] },
  ] as const)('offers specific actions for $state without a general state picker', async ({ state, expected }) => {
    await openCase(state)
    expect(screen.queryByRole('button', { name: 'Změnit stav' })).not.toBeInTheDocument()
    for (const label of [markComplete, wait, waitAgain]) {
      if (expected.some((value) => value === label)) expect(screen.getByRole('button', { name: label })).toBeVisible()
      else expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it.each(['koncept', 'odeslano', 'vraceno_lekari', 'pripraveno_k_mdt', 'zaver_mdt', 'zpetna_vazba_odeslana', 'uzavreno'] as const)('does not offer manual document-state moves in %s', async (state) => {
    await openCase(state)
    for (const label of [markComplete, wait, waitAgain, 'Změnit stav']) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
  })

  it.each(['v_triage', 'ceka_na_podklady'] as const)('marks %s complete explicitly, records the note and keeps findings and clinical validation unchanged', async (state) => {
    const requests: Request[] = []
    server.events.on('request:start', ({ request }) => { if (request.url.endsWith('/transition')) requests.push(request.clone()) })
    const { user } = await openCase(state)
    const before = demoState.documents.result(caseId)
    await user.click(screen.getByRole('button', { name: markComplete }))
    const form = within(await screen.findByRole('dialog', { name: markComplete }))
    expect(form.getByText(/Aktuální stav:/)).toBeVisible()
    expect(form.getByText(/Po kontrole označíte dokumentaci/)).toBeVisible()
    expect(form.queryByRole('combobox')).not.toBeInTheDocument()
    expect(form.getByLabelText('Poznámka')).not.toBeRequired()
    expect(requests).toEqual([])
    fireEvent.change(form.getByLabelText('Poznámka'), { target: { value: 'Fiktivní poznámka po kontrole dokumentace.' } })
    await user.click(form.getByRole('button', { name: markComplete }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Změna byla uložena.')).toBeVisible()
    expect(demoState.getCases().find((item) => item.id === caseId)?.state).toBe('kompletni')
    expect(demoState.documents.result(caseId)).toEqual(before)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain(`/cases/${caseId}/transition`)
    expect(requests[0].headers.get('X-Actor-Id')).toBe('koordinator')
    expect(await requests[0].json()).toEqual({ to: 'kompletni', note: 'Fiktivní poznámka po kontrole dokumentace.' })
    expect(demoState.coordinator.audit(caseId)).toMatchObject([{ action: 'case_transitioned', actor_id: 'koordinator', detail: expect.stringContaining('Fiktivní poznámka') }])
    expect(screen.queryByRole('button', { name: markComplete })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: waitAgain })).toBeVisible()
    await openTab(user, 'MDT')
    expect(await screen.findByRole('button', { name: 'Připravit podklad pro MDT' })).toBeVisible()
  })

  it.each(['v_triage', 'kompletni'] as const)('marks %s as waiting without creating a request or changing the hold', async (state) => {
    const { user } = await openCase(state)
    const messages = demoState.coordinator.messages(caseId), tasks = demoState.coordinator.tasks(caseId)
    const label = state === 'kompletni' ? waitAgain : wait
    await user.click(screen.getByRole('button', { name: label }))
    const form = within(await screen.findByRole('dialog', { name: label }))
    expect(form.getByText(/Konkrétní podklady vyžádejte/)).toBeVisible()
    await user.click(form.getByRole('button', { name: label }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(demoState.getCases().find((item) => item.id === caseId)).toMatchObject({ state: 'ceka_na_podklady', queue: 'aktivni' })
    expect(demoState.getCases().find((item) => item.id === caseId)?.on_hold).toBeFalsy()
    expect(demoState.coordinator.messages(caseId)).toEqual(messages)
    expect(demoState.coordinator.tasks(caseId)).toEqual(tasks)
    expect(screen.getByRole('button', { name: markComplete })).toBeVisible()
    expect(screen.queryByRole('button', { name: wait })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: waitAgain })).not.toBeInTheDocument()
  })

  it.each([409, 500])('preserves the note on a %s API error and retries without exposing technical details', async (status) => {
    const { user } = await openCase('v_triage')
    server.use(http.post('*/api/cases/:id/transition', () => HttpResponse.json({ detail: 'private technical information' }, { status })))
    await user.click(screen.getByRole('button', { name: markComplete }))
    const form = within(await screen.findByRole('dialog', { name: markComplete }))
    fireEvent.change(form.getByLabelText('Poznámka'), { target: { value: 'Zachovaná poznámka.' } })
    await user.click(form.getByRole('button', { name: markComplete }))
    expect(await form.findByRole('alert')).toBeVisible()
    expect(form.getByLabelText('Poznámka')).toHaveValue('Zachovaná poznámka.')
    expect(screen.queryByText('private technical information')).not.toBeInTheDocument()
    expect(demoState.getCases().find((item) => item.id === caseId)?.state).toBe('v_triage')
    server.resetHandlers()
    await user.click(form.getByRole('button', { name: markComplete }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(demoState.getCases().find((item) => item.id === caseId)?.state).toBe('kompletni')
  })

  it('cancels without saving, restores focus, and preserves a Czech note while switching UI language', async () => {
    const { user } = await openCase('kompletni')
    const trigger = screen.getByRole('button', { name: waitAgain })
    await user.click(trigger)
    let dialog = await screen.findByRole('dialog', { name: waitAgain })
    fireEvent.change(within(dialog).getByLabelText('Poznámka'), { target: { value: 'Poznámka ke zpracování.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(demoState.coordinator.audit(caseId)).toEqual([])
    await user.click(trigger)
    dialog = await screen.findByRole('dialog', { name: waitAgain })
    expect(within(dialog).getByLabelText('Poznámka')).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText('Poznámka'), { target: { value: 'Česká poznámka.' } })
    await act(async () => { await changeLanguage('en') })
    expect(within(dialog).getByLabelText('Note')).toHaveValue('Česká poznámka.')
    expect(within(dialog).getByRole('button', { name: 'Wait for documents again' })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(demoState.getCases().find((item) => item.id === caseId)?.state).toBe('kompletni')
  })

  it('discards an open readiness draft when a server refresh changes the phase, even if it later returns', async () => {
    const { user, queryClient } = await openCase('kompletni')
    await user.click(screen.getByRole('button', { name: waitAgain }))
    await screen.findByRole('dialog', { name: waitAgain })
    const item = demoState.getCases().find((item) => item.id === caseId)
    if (!item) throw new Error('Missing fixture')
    demoState.saveCase({ ...item, state: 'ceka_na_podklady' })
    await act(async () => { await queryClient.refetchQueries({ queryKey: getCaseQueryKey({ path: { case_id: caseId }, headers: actorHeaders('koordinator') }) }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: waitAgain })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: markComplete })).toBeVisible()
    demoState.saveCase(item)
    await act(async () => { await queryClient.refetchQueries({ queryKey: getCaseQueryKey({ path: { case_id: caseId }, headers: actorHeaders('koordinator') }) }) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('allows a complete case to open MDT with no planned date and asks for it without inventing one', async () => {
    const { user } = await openCase('kompletni')
    await openTab(user, 'MDT')
    expect(await screen.findByLabelText('Datum MDT')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
    expect(await screen.findByRole('alert', { name: 'Zkontrolujte formulář' })).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: 'Potvrdit podklad pro MDT?' })).not.toBeInTheDocument()
    expect(demoState.getCases().find((item) => item.id === caseId)?.mdt_date).toBeUndefined()
    expect(demoState.documents.result(caseId)?.handover.confirmed_by_coordinator).toBeUndefined()
  })
})
