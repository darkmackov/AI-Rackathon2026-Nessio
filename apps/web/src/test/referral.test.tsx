import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actorHeaders } from '../api'
import { listCasesQueryKey } from '../client/@tanstack/react-query.gen'
import type { Case, Handover } from '../client/types.gen'
import { changeLanguage } from '../i18n'
import { referenceHandover } from '../mocks/reference-data'
import { s8Handover } from '../mocks/s8-data'
import { renderApp } from './renderApp'
import { seedReferral, seedReturnedReferral } from './referral-fixtures'
import { changeIdentity, field, openReferrerCase, openTab, openUserMenu, signIn, wideScreen, type User } from './shell'
import { demoState, server } from './setup'

async function openReferral(item: Case, options: { notifications?: boolean } = {}) {
  const view = await openReferrerCase(item.id, item.patient_name || 'Pacient zatím neuveden', options)
  await screen.findByText('Případ zatím nemá žádné dokumenty.')
  return view
}

async function review(user: User, expand = false) {
  const panel = await openTab(user, 'Předávka')
  if (expand) await user.click(await within(panel).findByRole('button', { name: 'Rozbalit vše' }))
  return panel
}

afterEach(() => server.events.removeAllListeners('request:start'))

describe('S3 referring doctor workflow', () => {
  it('shows an empty list, retries a failed load and shows a creation error without losing the KOC', async () => {
    demoState.reset('empty')
    server.use(http.get('*/api/cases', () => HttpResponse.json({ detail: 'private technical information' }, { status: 500 })))
    renderApp('/', { notifications: true })
    const user = userEvent.setup({ delay: null })
    await signIn(user, 'referring_doctor')
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.queryByText('private technical information')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zavřít oznámení' }))
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findByText('Zatím nemáte žádné žádosti.')).toBeVisible()
    server.use(http.post('*/api/referrals', () => HttpResponse.json({ detail: 'todo' }, { status: 501 })))
    await user.click(screen.getByRole('button', { name: 'Nová žádost' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nová žádost do KOC' })
    await user.selectOptions(await within(dialog).findByLabelText('Cílové KOC'), 'koc2-lipova')
    await user.click(within(dialog).getByRole('button', { name: 'Vytvořit žádost' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tato funkce zatím není implementována.')
    expect(dialog.querySelector('.mantine-Alert-root')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Cílové KOC')).toHaveValue('koc2-lipova')
    expect(demoState.getCases()).toEqual([])
  })

  it('requires confirmation and validates before sending even with missing fields, then appears in the KOC queue', async () => {
    const item = seedReferral('draft-send', { patient_name: 'Fiktivní žádost' })
    const { queryClient, user } = await openReferral(item)
    await review(user)
    const sendButton = screen.getByRole('button', { name: 'Validovat a odeslat' })
    await waitFor(() => expect(sendButton).toBeEnabled())
    await user.click(sendButton)
    let dialog = await screen.findByRole('dialog', { name: 'Validovat a odeslat žádost?' })
    expect(demoState.documents.result(item.id)?.handover.validated_by_referrer).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(demoState.getCases().find((entry) => entry.id === item.id)?.state).toBe('koncept')
    await user.click(sendButton)
    dialog = await screen.findByRole('dialog', { name: 'Validovat a odeslat žádost?' })
    await user.click(within(dialog).getByRole('button', { name: 'Validovat a odeslat' }))
    expect(await screen.findByText('Žádost byla odeslána do KOC.')).toBeVisible()
    expect(demoState.documents.result(item.id)?.handover.validated_by_referrer?.by).toBe('pl-reznicek')
    expect(screen.queryByRole('button', { name: 'Validovat a odeslat' })).not.toBeInTheDocument()
    await changeIdentity(user)
    await signIn(user)
    expect(await screen.findByRole('link', { name: 'Fiktivní žádost' })).toBeVisible()
    expect(queryClient.getQueryData(listCasesQueryKey({ headers: actorHeaders('pl-reznicek'), query: { referring_doctor_id: 'pl-reznicek' } }))).toBeUndefined()
  })

  it.each(['validate', 'send'])('handles %s failure without losing the referral and permits an explicit retry', async (stage) => {
    const item = seedReferral(`draft-failure-${stage}`)
    const validateCalls = vi.fn()
    const sendCalls = vi.fn()
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/handover/validate')) validateCalls()
      if (request.url.endsWith('/send')) sendCalls()
    })
    const path = stage === 'validate' ? '*/api/cases/:caseId/handover/validate' : '*/api/cases/:caseId/send'
    server.use(http.post(path, () => HttpResponse.json({ detail: 'private error' }, { status: 500 })))
    const { user } = await openReferral(item)
    await review(user)
    await user.click(screen.getByRole('button', { name: 'Validovat a odeslat' }))
    const dialog = await screen.findByRole('dialog', { name: 'Validovat a odeslat žádost?' })
    await user.click(within(dialog).getByRole('button', { name: 'Validovat a odeslat' }))
    expect(await within(dialog).findByText(stage === 'validate' ? 'Předávku se nepodařilo validovat. Žádost nebyla odeslána.' : 'Odeslání se nepodařilo. Zkontrolujte aktuální stav žádosti a zkuste to znovu.')).toBeVisible()
    expect(screen.queryByText('private error')).not.toBeInTheDocument()
    expect(demoState.getCases().find((entry) => entry.id === item.id)?.state).toBe('koncept')
    expect(validateCalls).toHaveBeenCalledTimes(1)
    expect(sendCalls).toHaveBeenCalledTimes(stage === 'validate' ? 0 : 1)
    server.resetHandlers()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Validovat a odeslat' })).toBeEnabled())
    await user.click(within(dialog).getByRole('button', { name: 'Validovat a odeslat' }))
    expect(await screen.findByText('Žádost byla odeslána do KOC.')).toBeVisible()
    server.events.removeAllListeners('request:start')
  })

  it('rejects another doctor’s case before loading clinical data and keeps a sent case read-only', async () => {
    const other = seedReferral('private-other', { referring_doctor_id: 'pl-novakova' })
    const { router } = renderApp()
    const user = userEvent.setup({ delay: null })
    await signIn(user, 'referring_doctor')
    const clinical = vi.fn()
    server.use(http.get(`*/api/cases/${other.id}/handover`, () => { clinical(); return HttpResponse.json(referenceHandover) }))
    await act(async () => { await router.navigate({ to: '/referrer/cases/$caseId', params: { caseId: other.id } }) })
    expect(await screen.findByText('Tato žádost není dostupná pro vybraného lékaře.')).toBeVisible()
    expect(clinical).not.toHaveBeenCalled()
    const sent = seedReferral('already-sent', { state: 'odeslano' })
    await act(async () => { await router.navigate({ to: '/referrer/cases/$caseId', params: { caseId: sent.id } }) })
    expect(await screen.findByText('Žádost byla předána KOC. Úpravy budou opět dostupné, pokud ji koordinátor vrátí.')).toBeVisible()
    expect(screen.queryByLabelText('Vybrat soubory')).not.toBeInTheDocument()
    await review(user)
    expect(screen.queryByRole('button', { name: 'Validovat a odeslat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Není k dispozici' })).not.toBeInTheDocument()
  })

  it('keeps a missing handover and unavailable return-note endpoint recoverable without exposing technical errors', async () => {
    const item = seedReturnedReferral()
    server.use(http.get('*/api/inbox', () => HttpResponse.json({ detail: 'internal inbox stub' }, { status: 501 })),
      http.get(`*/api/cases/${item.id}/handover`, () => HttpResponse.json({ detail: 'no handover yet' }, { status: 404 })))
    const { user } = await openReferral(item, { notifications: true })
    expect(await screen.findByText('Tato funkce zatím není implementována.')).toBeVisible()
    expect(screen.queryByText('internal inbox stub')).not.toBeInTheDocument()
    await review(user)
    expect(await screen.findByText('Předávka zatím není dostupná.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Validovat a odeslat' })).toBeDisabled()
    server.resetHandlers()
    await user.click(within(screen.getByRole('tabpanel', { name: 'Předávka' })).getByRole('button', { name: 'Zkusit znovu' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validovat a odeslat' })).toBeEnabled())
    expect(within(field('Jméno')).getByRole('button', { name: 'Doplnit' })).toBeEnabled()
  })

  it('moves keyboard focus from a finding into a field in a collapsed section', async () => {
    const item = seedReferral('draft-focus', {}, { ...referenceHandover, case_id: 'draft-focus' })
    // This fixture has findings linked to a handover section that starts collapsed.
    const finding = { id: 'focus-finding', kind: 'missing', severity: 'warning', fields: ['contacts.patient_phone'], message_cs: 'Fiktivní upozornění na kontakt.', suggested_action: 'fill_in' } as const
    server.use(http.get('*/api/cases/draft-focus/findings', () => HttpResponse.json([{ ...finding, fields: [...finding.fields] }])))
    const { user } = await openReferral(item)
    await review(user)
    const issue = await screen.findByRole('article', { name: finding.message_cs })
    await user.click(within(issue).getByRole('link', { name: /Telefon pacienta/ }))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Telefon pacienta' })).toHaveFocus())
  })

  it('keeps coordinator identities outside the GP workflow', async () => {
    const item = seedReferral('doctor-only')
    const { router } = renderApp()
    const user = userEvent.setup({ delay: null })
    await signIn(user)
    await act(async () => { await router.navigate({ to: '/referrer/cases/$caseId', params: { caseId: item.id } }) })
    await waitFor(() => expect(router.state.location.pathname).toBe('/coordinator'))
    expect(screen.queryByRole('button', { name: 'Validovat a odeslat' })).not.toBeInTheDocument()
  })

  it('keeps field drafts while changing language and blocks identity changes during a write', async () => {
    const item = seedReferral('draft-language')
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    server.use(http.patch('*/api/cases/:caseId/handover', async () => { await held; return HttpResponse.json(demoState.documents.result('draft-language')?.handover) }))
    const { user } = await openReferral(item)
    await review(user)
    await user.click(within(field('Jméno')).getByRole('button', { name: 'Doplnit' }))
    let dialog = await screen.findByRole('dialog', { name: 'Upravit údaj: Jméno' })
    await user.type(within(dialog).getByLabelText('Hodnota'), 'Fiktivní koncept')
    await act(async () => { await changeLanguage('en') })
    dialog = screen.getByRole('dialog', { name: 'Edit information: First name' })
    expect(within(dialog).getByLabelText('Value')).toHaveValue('Fiktivní koncept')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // The modal traps focus; the shared shell also disables changing identity for any pending mutation.
    fireEvent.click(screen.getByRole('button', { name: /^User /, hidden: true }))
    expect(await screen.findByRole('menuitem', { name: 'Change person' })).toHaveAttribute('data-disabled')
    await user.keyboard('{Escape}')
    await act(async () => { release?.() })
    expect(await screen.findByText('The information has been saved.')).toBeVisible()
    expect(await openUserMenu(user)).toBeVisible()
  })

  it('opens a verbatim source in the wide layout without enabling coordinator-only field edits', async () => {
    wideScreen()
    const reference = demoState.getCases().find((item) => item.id === 'vzp-prochazkova')
    if (!reference) throw new Error('Missing reference fixture')
    demoState.saveCase({ ...reference, state: 'koncept' })
    renderApp()
    const user = userEvent.setup({ delay: null })
    await signIn(user, 'referring_doctor')
    await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
    await screen.findByRole('heading', { level: 1, name: 'Alena Procházková' })
    await review(user)
    const diagnosis = field('Diagnóza')
    const citation = within(diagnosis).getAllByRole('button', { name: /^Zdroj / })[0]
    await user.click(citation)
    const panel = await screen.findByRole('complementary', { name: 'Zdrojový dokument' })
    expect(await within(panel).findByTestId('document-text')).toBeVisible()
    expect(panel.querySelector('mark')).not.toBeNull()
    expect(within(field('Souhrn epikrízy')).queryByRole('button', { name: /Upravit|Doplnit/ })).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Zavřít zdroj' }))
    expect(citation).toHaveFocus()
  })

  it('lets the doctor pick an AI-suggested MKN-10 code as a manual entry', async () => {
    const item = seedReferral('draft-code', {}, { ...s8Handover, case_id: 'draft-code' })
    const pick = vi.fn()
    server.use(http.get('*/api/cases/draft-code/handover/code-candidates', () => HttpResponse.json([{ code: 'C20', title_cs: 'Zhoubný novotvar konečníku' }])),
      http.post('*/api/cases/draft-code/handover/diagnosis-code', async ({ request }) => {
        pick(await request.json(), request.headers.get('X-Actor-Id'))
        const handover = demoState.documents.result('draft-code')?.handover as Handover
        const updated: Handover = { ...handover, diagnosis_code: { value: 'C20', status: 'found', origin: 'manual', entered: { by: 'pl-reznicek', at: '2026-10-21T09:00:00' }, evidence: [], note: null } }
        demoState.documents.saveHandover(updated)
        return HttpResponse.json(updated)
      }))
    const { user } = await openReferral(item)
    await review(user)
    await user.click(within(field('MKN-10')).getByRole('button', { name: 'Navrhnout kód' }))
    expect(await screen.findByText('AI návrhy. Kód se uloží teprve vaším výběrem.')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'Použít kód C20' }))
    expect(await screen.findByText('Kód byl uložen jako ruční zadání.')).toBeVisible()
    expect(pick).toHaveBeenCalledWith({ code: 'C20' }, 'pl-reznicek')
    await waitFor(() => expect(within(field('MKN-10')).queryByRole('button', { name: 'Navrhnout kód' })).not.toBeInTheDocument())
  })

  it('does not offer code suggestions once the referral is sent', async () => {
    const item = seedReferral('sent-code', { state: 'odeslano', queue: 'novy' }, { ...s8Handover, case_id: 'sent-code' })
    const { user } = await openReferral(item)
    await review(user)
    expect(within(field('MKN-10')).queryByRole('button', { name: 'Navrhnout kód' })).not.toBeInTheDocument()
  })
})
