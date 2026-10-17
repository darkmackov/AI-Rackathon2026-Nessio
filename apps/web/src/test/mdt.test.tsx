import { Blob as NodeBlob } from 'node:buffer'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actorHeaders } from '../api'
import { confirmMdtConclusionMutation, createMdtSnapshotMutation, getJobQueryKey, upsertMdtConclusionMutation } from '../client/@tanstack/react-query.gen'
import { demoDraftText, demoResultLine } from '../mocks/mdt'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { s4CaseId } from '../mocks/coordinator-state'
import { refreshCaseResults } from '../components/documents/use-document-ingest'
import { completeCase, mutation, resolveBlockers } from './mdt-fixtures'
import { changeIdentity, openCoordinatorCase, openTab, setLanguage, signIn } from './shell'
import { demoState, server } from './setup'

async function openMdt(options: { notifications?: boolean } = {}) {
  const view = await openCoordinatorCase(s4CaseId, 'Fiktivní pacient S4', options)
  return { ...view, panel: await openTab(view.user, 'MDT') }
}
async function prepare() {
  completeCase(); resolveBlockers()
  return mutation(createMdtSnapshotMutation(), { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId }, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
}
afterEach(() => vi.unstubAllGlobals())

describe('S5 coordinator MDT workflow', () => {
  it('prepares the record from the chosen board/date while keeping missing values explicit', async () => {
    completeCase(); resolveBlockers()
    const { user } = await openMdt()
    expect(await screen.findByLabelText('MDT tým')).toHaveValue('mdt-git-lipova')
    expect(screen.getByLabelText('Datum MDT')).toHaveValue('2026-10-21')
    await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
    const dialog = await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' })
    await user.click(within(dialog).getByRole('button', { name: 'Potvrdit a připravit' }))
    expect(await screen.findByText('Zmrazené podklady k 21. 10. 2026. Pozdější zprávy mění pouze živou předávku.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Upravit zápis' })).toBeVisible()
    expect(demoState.mdt.record(s4CaseId)?.patient_name).toBe('Fiktivní pacient S4')  // the case's name when the handover has none
    expect(screen.queryByRole('button', { name: 'Připravit podklad pro MDT' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Není uvedeno').length).toBeGreaterThan(1)
  })

  it('edits the board roster before snapshot creation without changing the canonical directory', async () => {
    completeCase()
    const { user } = await openMdt()
    await user.click(await screen.findByRole('button', { name: 'Upravit členy týmu' }))
    const dialog = await screen.findByRole('dialog', { name: 'Členové MDT' })
    fireEvent.change(within(dialog).getByLabelText('Jméno a příjmení (1)'), { target: { value: 'Fiktivní změněný člen' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    expect(await screen.findByText('Členové MDT týmu byli uloženi.')).toBeVisible()
    expect(demoState.mdt.boards().find((board) => board.id === 'mdt-git-lipova')?.members?.[0].name).toBe('Fiktivní změněný člen')
  })

  it('edits record members, results and question while leaving the frozen handover untouched', async () => {
    await prepare()
    const original = demoState.mdt.snapshot(s4CaseId)
    const { user } = await openMdt()
    await user.click(await screen.findByRole('button', { name: 'Upravit zápis' }))
    const dialog = await screen.findByRole('region', { name: 'Upravit zápis' })
    expect(within(dialog).getByRole('heading', { name: 'Upravit zápis' })).toHaveFocus()
    fireEvent.change(within(dialog).getByLabelText('Otázka na MDT'), { target: { value: 'Fiktivní otázka ke kontrole.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Přidat výsledek' }))
    fireEvent.change(within(dialog).getByLabelText('Datum vyšetření (1)'), { target: { value: '2026-10-20' } })
    fireEvent.change(within(dialog).getByLabelText('Vyšetření (1)'), { target: { value: 'Fiktivní kontrola' } })
    fireEvent.change(within(dialog).getByLabelText('Výsledek (1)'), { target: { value: 'Úplný fiktivní text výsledku.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    expect(await screen.findByText('Změny MDT byly uloženy.')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Upravit zápis' })).not.toBeInTheDocument()
    expect(screen.getByText('Úplný fiktivní text výsledku.')).toBeVisible()
    expect(demoState.mdt.snapshot(s4CaseId)).toEqual(original)
  })

  it('separates saving a conclusion from human confirmation and preserves Czech data when switching languages', async () => {
    await prepare()
    const { user } = await openMdt()
    expect(await screen.findByRole('radio', { name: 'Zapsat v aplikaci' })).toBeChecked()
    const dialog = await screen.findByRole('region', { name: 'Zapsat závěr' })
    fireEvent.change(within(dialog).getByLabelText('Závěr MDT'), { target: { value: 'Fiktivní závěr bez klinického doporučení.' } })
    fireEvent.change(within(dialog).getByLabelText('Definitivní kód (MKN-10)'), { target: { value: 'Z00.0' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    expect(await screen.findByRole('heading', { level: 2, name: /Závěr MDT\s*Čeká na potvrzení/ })).toBeVisible()
    expect(screen.getByText('Fiktivní závěr bez klinického doporučení.')).toBeVisible()
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
    // Corrections stay possible until the feedback is sent, and need a new confirmation (Q-F34).
    expect(screen.getByText('Editing or uploading the conclusion again removes its confirmation. Confirm it again afterwards.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit conclusion' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Confirm MDT conclusion' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /MDT conclusion\s*Confirmed/ })).toBeVisible()
  })

  it('applies the conclusion prefill to the record-restating fields only, never as an AI draft or the decision', async () => {
    let now = 0
    const state = createDemoState(() => now); server.use(...createHandlers(state)); completeCase(state); resolveBlockers(state)
    await mutation(createMdtSnapshotMutation(), { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId }, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
    const { queryClient, user } = await openMdt()
    const editor = await screen.findByRole('region', { name: 'Zapsat závěr' })
    const panel = within(editor).getByRole('region', { name: 'Předvyplnění ze zápisu: Závěr MDT' })
    await user.click(within(panel).getByRole('button', { name: 'Předvyplnit ze zápisu' }))
    const job = state.mdt.jobs(s4CaseId)[0]
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: getJobQueryKey({ headers: actorHeaders('koordinator'), path: { job_id: job.id } }) }) })
    expect(await within(panel).findByText('Převzato ze zápisu MDT – nejde o návrh AI')).toBeVisible()
    expect(within(panel).queryByText('AI návrh – vyžaduje kontrolu')).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Použít jako rozepsaný text' }))
    const dialog = screen.getByRole('region', { name: 'Zapsat závěr' })
    expect(await within(dialog).findByDisplayValue('Praha 4')).toBe(within(dialog).getByLabelText('Místo'))
    expect(within(dialog).getByLabelText('Závěr MDT')).toHaveValue('')
    expect(within(dialog).getByLabelText('Doporučení MDT')).toHaveValue('')
    fireEvent.change(within(dialog).getByLabelText('Závěr MDT'), { target: { value: 'Fiktivní závěr z jednání.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    await waitFor(() => expect(state.mdt.conclusion(s4CaseId)).toMatchObject({ place: 'Praha 4', conclusion: 'Fiktivní závěr z jednání.', ai_draft_used: false }))
  })

  it('applies the AI result rows to the record editor without saving them', async () => {
    let now = 0
    const state = createDemoState(() => now); server.use(...createHandlers(state)); completeCase(state); resolveBlockers(state)
    await mutation(createMdtSnapshotMutation(), { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId }, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
    state.mdt.saveRecord({ ...state.mdt.record(s4CaseId)!, results: [{ date: '2026-10-08', examination: 'Fiktivní CT', result: 'Dlouhý fiktivní text.' }] })
    state.mdt.saveSnapshot({ ...state.mdt.snapshot(s4CaseId)!, examinations: [{ date: '2026-10-08', place: 'Fiktivní KOC', type: 'Fiktivní CT', result_full_text: 'Dlouhý fiktivní text.', origin: 'manual', entered: { by: 'koordinator', at: '2026-10-20T09:00:00' } }] })
    const { queryClient, user } = await openMdt()
    await user.click(await screen.findByRole('button', { name: 'Upravit zápis' }))
    const dialog = await screen.findByRole('region', { name: 'Upravit zápis' })
    const panel = within(dialog).getByRole('region', { name: 'Návrh AI: Výsledky stávajících vyšetření' })
    await user.click(within(panel).getByRole('button', { name: 'Připravit návrh AI' }))
    const job = state.mdt.jobs(s4CaseId)[0]
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: getJobQueryKey({ headers: actorHeaders('koordinator'), path: { job_id: job.id } }) }) })
    expect(await within(panel).findByText(demoResultLine)).toBeVisible()
    expect(within(dialog).getByLabelText('Výsledek (1)')).toHaveValue('Dlouhý fiktivní text.')
    await user.click(within(panel).getByRole('button', { name: 'Použít jako výsledky zápisu' }))
    expect(await within(dialog).findByDisplayValue(demoResultLine)).toBe(within(dialog).getByLabelText('Výsledek (1)'))
    expect(state.mdt.record(s4CaseId)?.results?.[0].result).toBe('Dlouhý fiktivní text.')
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    await waitFor(() => expect(state.mdt.record(s4CaseId)?.results?.[0].result).toBe(demoResultLine))
  })

  it('polls an AI draft and only turns it into a manual handover value after explicit use and save', async () => {
    let now = 0
    const state = createDemoState(() => now)
    const item = state.getCases().find((item) => item.id === s4CaseId)
    if (!item) throw new Error('Missing fixture')
    state.saveCase({ ...item, state: 'kompletni', coordinator_id: 'koordinator', mdt_board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' })
    server.use(...createHandlers(state))
    const { queryClient, user } = await openMdt()
    await user.click(within(await screen.findByRole('group', { name: 'Souhrn epikrízy' })).getByRole('button', { name: 'Upravit' }))
    const dialog = screen.getByRole('region', { name: 'Souhrn epikrízy' })
    const panel = within(dialog).getByRole('region', { name: 'Návrh AI: Souhrn epikrízy' })
    await user.click(within(panel).getByRole('button', { name: 'Připravit návrh AI' }))
    expect(await within(panel).findByText('Čeká na zpracování')).toBeVisible()
    const job = state.mdt.jobs(s4CaseId)[0]
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: getJobQueryKey({ headers: actorHeaders('koordinator'), path: { job_id: job.id } }) }) })
    expect(await within(panel).findByText(demoDraftText)).toBeVisible()
    expect(within(panel).getByText('AI návrh – vyžaduje kontrolu')).toBeVisible()
    expect(state.documents.result(s4CaseId)?.handover.epicrisis?.value).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Použít jako rozepsaný text' }))
    expect(await within(dialog).findByDisplayValue(demoDraftText)).toBe(within(dialog).getByLabelText('Hodnota'))
    expect(state.documents.result(s4CaseId)?.handover.epicrisis?.value).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Uložit' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Souhrn epikrízy' })).not.toBeInTheDocument())
    expect(screen.getByRole('group', { name: 'Souhrn epikrízy' })).toHaveFocus()
    expect(state.documents.result(s4CaseId)?.handover.epicrisis).toMatchObject({ value: demoDraftText, origin: 'manual', entered: { by: 'koordinator' } })
  })

  it('guides each stage with one next step and keeps finished sections collapsed', async () => {
    completeCase(); resolveBlockers()
    const { user } = await openMdt()
    const next = await screen.findByRole('region', { name: 'Další krok' })
    expect(screen.getByText('Postup MDT: krok 2 z 5, Podklad pro MDT.')).toBeInTheDocument()
    await user.click(within(next).getByRole('button', { name: 'Přejít k přípravě podkladu' }))
    expect(screen.getByRole('button', { name: /Zápis k jednání MDT/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /Příprava předávky pro MDT/ })).toHaveAttribute('aria-expanded', 'true')
    // Collapsing a section is kept while the stage stays the same.
    await user.click(screen.getByRole('button', { name: /Příprava předávky pro MDT/ }))
    expect(screen.getByRole('button', { name: /Příprava předávky pro MDT/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('points a confirmed conclusion to sending, with the frozen record collapsed', async () => {
    await prepare()
    const options = { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId } }
    await mutation(upsertMdtConclusionMutation(), { ...options, body: { conclusion: 'Fiktivní závěr.' } })
    await mutation(confirmMdtConclusionMutation(), options)
    const { user } = await openMdt()
    const next = await screen.findByRole('region', { name: 'Další krok' })
    expect(screen.getByRole('button', { name: /Zápis k jednání MDT/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Závěr MDT\s*Potvrzeno/ })).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(next).getByRole('button', { name: 'Přejít k odeslání PL' }))
    expect(await screen.findByRole('tab', { name: 'Komunikace' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps an open conclusion form when the case data refreshes before any conclusion exists', async () => {
    await prepare()
    const { queryClient } = await openMdt()
    const editor = await screen.findByRole('region', { name: 'Zapsat závěr' })
    fireEvent.change(within(editor).getByLabelText('Závěr MDT'), { target: { value: 'Rozepsaný fiktivní závěr.' } })
    // A refresh refetches the missing (404) conclusion; while it runs the form must not be swapped for a loader.
    server.use(http.get('*/api/cases/:id/mdt/conclusion', async () => { await new Promise((resolve) => setTimeout(resolve, 100)); return HttpResponse.json({ detail: 'not found' }, { status: 404 }) }))
    let refresh: Promise<void> = Promise.resolve()
    await act(async () => { refresh = refreshCaseResults(queryClient, s4CaseId); await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(screen.getByRole('region', { name: 'Zapsat závěr' })).toBe(editor)
    await act(async () => { await refresh })
    expect(screen.getByRole('region', { name: 'Zapsat závěr' })).toBe(editor)
    expect(within(editor).getByLabelText('Závěr MDT')).toHaveValue('Rozepsaný fiktivní závěr.')
  })

  it('shows retryable backend errors without technical details or a fake successful record', async () => {
    completeCase()
    server.use(http.get('*/api/cases/:id/mdt/record', () => HttpResponse.json({ detail: 'internal MDT error' }, { status: 501 })))
    const { user, panel } = await openMdt({ notifications: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('Tato funkce zatím není implementována.')
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('internal MDT error')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upravit zápis' })).not.toBeInTheDocument()
    server.resetHandlers()
    await user.click(within(panel).getByRole('button', { name: 'Zkusit znovu' }))
    expect(await within(panel).findByRole('button', { name: 'Připravit podklad pro MDT' })).toBeVisible()
  })

  it('downloads the record PDF through the generated endpoint and revokes its temporary URL', async () => {
    await prepare()
    vi.stubGlobal('Blob', NodeBlob)
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mdt-test'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = await openMdt(), { user } = view
    await user.click(await screen.findByRole('button', { name: 'Stáhnout zápis PDF' }))
    expect(await screen.findByText('PDF bylo připraveno ke stažení.')).toBeVisible()
    expect(createUrl).toHaveBeenCalledOnce()
    view.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:mdt-test')
    vi.unstubAllGlobals()
  })

  it('clears MDT data and returns to the home screen on demo reset, and keeps identities isolated', async () => {
    await prepare()
    const { queryClient, user } = await openMdt()
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
