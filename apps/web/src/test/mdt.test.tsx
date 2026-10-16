import { Blob as NodeBlob } from 'node:buffer'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actorHeaders } from '../api'
import { createMdtSnapshotMutation, getJobQueryKey } from '../client/@tanstack/react-query.gen'
import { demoDraftText } from '../mocks/mdt'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { s4CaseId } from '../mocks/coordinator-state'
import { completeCase, mutation, resolveBlockers } from './mdt-fixtures'
import { renderApp } from './renderApp'
import { changeIdentity, openTab, setLanguage, signIn, type User } from './shell'
import { demoState, server } from './setup'

async function openMdt(user: User) {
  await signIn(user)
  await user.click(await screen.findByRole('link', { name: 'Fiktivní pacient S4' }))
  await screen.findByRole('heading', { level: 1, name: 'Fiktivní pacient S4' })
  return openTab(user, 'MDT')
}
async function prepare() {
  completeCase(); resolveBlockers()
  return mutation(createMdtSnapshotMutation(), { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId }, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
}
afterEach(() => vi.unstubAllGlobals())

describe('S5 coordinator MDT workflow', () => {
  it('requires explicit snapshot confirmation and explains unresolved blockers without hiding the S4 resolution workflow', async () => {
    completeCase()
    renderApp(); const user = userEvent.setup(); await openMdt(user)
    await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
    let dialog = await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' })
    expect(within(dialog).getByText(/Později přijaté zprávy/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    expect(demoState.mdt.snapshot(s4CaseId)).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
    dialog = await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' })
    await user.click(within(dialog).getByRole('button', { name: 'Potvrdit a připravit' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('nevyřešená blokující upozornění')
    expect(demoState.getCases().find((item) => item.id === s4CaseId)?.state).toBe('kompletni')
    await user.click(within(dialog).getByRole('button', { name: 'Zobrazit k řešení' }))
    expect(await screen.findByRole('article', { name: 'Fiktivní ukázka: chybí ECOG / Karnofsky.' })).toBeVisible()
  })

  it('prepares the record from the chosen board/date while keeping missing values explicit', async () => {
    completeCase(); resolveBlockers()
    renderApp(); const user = userEvent.setup(); await openMdt(user)
    expect(screen.getByLabelText('MDT tým')).toHaveValue('mdt-git-lipova')
    expect(screen.getByLabelText('Datum MDT')).toHaveValue('2026-10-21')
    await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
    const dialog = await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' })
    await user.click(within(dialog).getByRole('button', { name: 'Potvrdit a připravit' }))
    expect(await screen.findByText('Zmrazené podklady k 21. 10. 2026. Pozdější zprávy mění pouze živou předávku.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Upravit zápis' })).toBeVisible()
    expect(demoState.mdt.record(s4CaseId)?.patient_name).toBeNull()
    expect(screen.queryByRole('button', { name: 'Připravit podklad pro MDT' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Není uvedeno').length).toBeGreaterThan(1)
  })

  it('edits the board roster before snapshot creation without changing the canonical directory', async () => {
    completeCase()
    renderApp(); const user = userEvent.setup(); await openMdt(user)
    await user.click(screen.getByRole('button', { name: 'Upravit členy týmu' }))
    const dialog = await screen.findByRole('dialog', { name: 'Členové MDT' })
    fireEvent.change(within(dialog).getByLabelText('Jméno a příjmení (1)'), { target: { value: 'Fiktivní změněný člen' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    expect(await screen.findByText('Změny MDT byly uloženy.')).toBeVisible()
    expect(demoState.mdt.boards().find((board) => board.id === 'mdt-git-lipova')?.members?.[0].name).toBe('Fiktivní změněný člen')
  })

  it('edits record members, results and question while leaving the frozen handover untouched', async () => {
    await prepare()
    const original = demoState.mdt.snapshot(s4CaseId)
    renderApp(); const user = userEvent.setup(); await openMdt(user)
    await user.click(await screen.findByRole('button', { name: 'Upravit zápis' }))
    const dialog = await screen.findByRole('dialog', { name: 'Upravit zápis' })
    fireEvent.change(within(dialog).getByLabelText('Otázka na MDT'), { target: { value: 'Fiktivní otázka ke kontrole.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Přidat výsledek' }))
    fireEvent.change(within(dialog).getByLabelText('Datum vyšetření (1)'), { target: { value: '2026-10-20' } })
    fireEvent.change(within(dialog).getByLabelText('Vyšetření (1)'), { target: { value: 'Fiktivní kontrola' } })
    fireEvent.change(within(dialog).getByLabelText('Výsledek (1)'), { target: { value: 'Úplný fiktivní text výsledku.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    expect(await screen.findByText('Změny MDT byly uloženy.')).toBeVisible()
    expect(screen.getByText('Úplný fiktivní text výsledku.')).toBeVisible()
    expect(demoState.mdt.snapshot(s4CaseId)).toEqual(original)
  })

  it('separates saving a conclusion from human confirmation and preserves Czech data when switching languages', async () => {
    await prepare()
    renderApp(); const user = userEvent.setup(); await openMdt(user)
    await user.click(await screen.findByRole('button', { name: 'Zapsat / upravit závěr' }))
    const dialog = await screen.findByRole('dialog', { name: 'Zapsat / upravit závěr' })
    fireEvent.change(within(dialog).getByLabelText('Závěr MDT'), { target: { value: 'Fiktivní závěr bez klinického doporučení.' } })
    fireEvent.change(within(dialog).getByLabelText('Definitivní kód (MKN-10)'), { target: { value: 'Z00.0' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    expect(await screen.findByText('Fiktivní závěr bez klinického doporučení.')).toBeVisible()
    expect(demoState.mdt.conclusion(s4CaseId)?.confirmed).toBeNull()
    expect(demoState.getCases().find((item) => item.id === s4CaseId)?.state).toBe('pripraveno_k_mdt')
    await setLanguage(user, 'English')
    expect(screen.getByText('Fiktivní závěr bez klinického doporučení.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm MDT conclusion' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Confirm the MDT conclusion?' })
    expect(demoState.mdt.conclusion(s4CaseId)?.confirmed).toBeNull()
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm MDT conclusion' }))
    expect(await screen.findByText('The MDT conclusion has been confirmed.')).toBeVisible()
    expect(demoState.getCases().find((item) => item.id === s4CaseId)?.state).toBe('zaver_mdt')
    expect(screen.queryByRole('button', { name: 'Write / edit conclusion' })).not.toBeInTheDocument()
  })

  it('polls an AI draft and only turns it into a manual handover value after explicit use and save', async () => {
    let now = 0
    const state = createDemoState(() => now)
    const item = state.getCases().find((item) => item.id === s4CaseId)
    if (!item) throw new Error('Missing fixture')
    state.saveCase({ ...item, state: 'kompletni', coordinator_id: 'koordinator', mdt_board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' })
    server.use(...createHandlers(state))
    const { queryClient } = renderApp(); const user = userEvent.setup(); await openMdt(user)
    const panel = screen.getByRole('region', { name: 'Návrh AI: Souhrn epikrízy' })
    await user.click(within(panel).getByRole('button', { name: 'Připravit návrh AI' }))
    expect(await within(panel).findByText('Čeká na zpracování')).toBeVisible()
    const job = state.mdt.jobs(s4CaseId)[0]
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: getJobQueryKey({ headers: actorHeaders('koordinator'), path: { job_id: job.id } }) }) })
    expect(await within(panel).findByText(demoDraftText)).toBeVisible()
    expect(within(panel).getByText('AI návrh – vyžaduje kontrolu')).toBeVisible()
    expect(state.documents.result(s4CaseId)?.handover.epicrisis?.value).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Použít jako rozepsaný text' }))
    const dialog = await screen.findByRole('dialog', { name: 'Souhrn epikrízy' })
    expect(within(dialog).getByLabelText('Hodnota')).toHaveValue(demoDraftText)
    expect(state.documents.result(s4CaseId)?.handover.epicrisis?.value).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.documents.result(s4CaseId)?.handover.epicrisis).toMatchObject({ value: demoDraftText, origin: 'manual', entered: { by: 'koordinator' } })
  })

  it('shows retryable backend errors without technical details or a fake successful record', async () => {
    completeCase()
    server.use(http.get('*/api/cases/:id/mdt/record', () => HttpResponse.json({ detail: 'internal MDT error' }, { status: 501 })))
    renderApp(); const user = userEvent.setup(); const panel = await openMdt(user)
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Tato funkce zatím není implementována.')
    expect(screen.queryByText('internal MDT error')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upravit zápis' })).not.toBeInTheDocument()
    server.resetHandlers()
    await user.click(within(panel).getByRole('button', { name: 'Zkusit znovu' }))
    expect(await within(panel).findByText('Podklad pro MDT zatím není připraven.')).toBeVisible()
  })

  it('downloads the record PDF through the generated endpoint and revokes its temporary URL', async () => {
    await prepare()
    vi.stubGlobal('Blob', NodeBlob)
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mdt-test'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = renderApp(); const user = userEvent.setup(); await openMdt(user)
    await user.click(await screen.findByRole('button', { name: 'Stáhnout zápis PDF' }))
    expect(await screen.findByText('PDF bylo připraveno ke stažení.')).toBeVisible()
    expect(createUrl).toHaveBeenCalledOnce()
    view.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:mdt-test')
    vi.unstubAllGlobals()
  })

  it('clears MDT data and returns to the home screen on demo reset, and keeps identities isolated', async () => {
    await prepare()
    const { queryClient } = renderApp(); const user = userEvent.setup(); await openMdt(user)
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const demo = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(demo).getByRole('button', { name: 'Obnovit prázdné demo' }))
    const confirm = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirm).getByRole('button', { name: 'Obnovit data' }))
    await screen.findByText('Demo bylo obnoveno.')
    expect(demoState.mdt.record(s4CaseId)).toBeUndefined()
    await user.click(within(demo).getByRole('button', { name: 'Zavřít' }))
    expect(await screen.findByRole('heading', { name: 'Pracovní fronta koordinátora' })).toBeVisible()
    expect(queryClient.getQueryCache().getAll().some((query) => JSON.stringify(query.queryKey).includes('getMdtRecord'))).toBe(false)
    await changeIdentity(user); await signIn(user, 'referring_doctor')
    expect(screen.queryByRole('tab', { name: 'MDT' })).not.toBeInTheDocument()
  })
})
