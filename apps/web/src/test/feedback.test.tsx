import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { actorHeaders } from '../api'
import { changeLanguage } from '../i18n'
import { sendFeedbackMutation } from '../client/@tanstack/react-query.gen'
import { concludeReference, referenceId } from './feedback-fixtures'
import { mutation } from './mdt-fixtures'
import { renderApp } from './renderApp'
import { changeIdentity, openReferenceCase, openTab, setLanguage, signIn } from './shell'
import { demoState, server } from './setup'

const path = { case_id: referenceId }, headers = actorHeaders('koordinator')
async function sentResult() {
  await concludeReference()
  return mutation(sendFeedbackMutation(), { headers, path, body: { note: 'Poznámka pro PL.' } })
}

describe('S6 feedback workflow', () => {
  it('sends through a confirmation dialog, receives as the GP and shows the receipt to the coordinator', async () => {
    await concludeReference()
    const { queryClient } = renderApp(), user = userEvent.setup()
    await openReferenceCase(user)
    await openTab(user, 'Komunikace')
    const send = screen.getByRole('button', { name: 'Odeslat PL' })
    await waitFor(() => expect(send).toBeEnabled())
    await user.click(send)
    let dialog = await screen.findByRole('dialog', { name: 'Odeslat výsledek MDT odesílajícímu lékaři?' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Odeslat PL' })).toBeEnabled())
    expect(within(dialog).getByText('Alena Procházková')).toBeVisible()
    expect(within(dialog).getByText(/Zmrazený podklad MDT k/)).toBeVisible()
    fireEvent.change(within(dialog).getByLabelText('Poznámka pro lékaře (nepovinná)'), { target: { value: 'Poznámka pro PL.' } })
    await user.click(within(dialog).getByRole('button', { name: 'Odeslat PL' }))
    expect(await screen.findByText('Výsledek MDT byl odeslán odesílajícímu lékaři.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Odeslat PL' })).toBeDisabled()

    await changeIdentity(user); await signIn(user, 'referring_doctor')
    await user.click(await screen.findByRole('button', { name: /Výsledek MDT: Alena Procházková/ }))
    expect(await screen.findByText('Fiktivní závěr MDT.')).toBeVisible()
    expect(screen.getByText('Poznámka pro PL.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Zobrazit podklad MDT' }))
    expect(await screen.findByText(/Zmrazené podklady k 21. 10. 2026/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stáhnout zápis PDF' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Potvrzuji převzetí' }))
    dialog = await screen.findByRole('dialog', { name: 'Potvrdit převzetí výsledku MDT?' })
    expect(demoState.getCases().find((item) => item.id === referenceId)?.state).toBe('zpetna_vazba_odeslana')
    await user.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await user.click(screen.getByRole('button', { name: 'Potvrzuji převzetí' }))
    dialog = await screen.findByRole('dialog', { name: 'Potvrdit převzetí výsledku MDT?' })
    await user.click(within(dialog).getByRole('button', { name: 'Potvrzuji převzetí' }))
    expect(await screen.findByText('Převzetí bylo potvrzeno a případ je uzavřen.')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Alena Procházková' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Zobrazit uzavřené' }))
    expect(await screen.findByRole('link', { name: 'Alena Procházková' })).toBeVisible()

    await changeIdentity(user); await signIn(user)
    expect(screen.queryByRole('link', { name: 'Alena Procházková' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Zobrazit uzavřené' }))
    await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
    const communication = await openTab(user, 'Komunikace')
    await waitFor(() => expect(within(communication).getAllByText(/Převzato/)[0]).toBeVisible())
    expect(within(communication).queryByText('Čeká na potvrzení převzetí')).not.toBeInTheDocument()
    expect(queryClient.getQueryCache().getAll().some((query) => JSON.stringify(query.queryKey).includes('pl-reznicek'))).toBe(false)
  })

  it('keeps sending disabled when the MDT input cannot be reviewed and allows retry', async () => {
    await concludeReference()
    server.use(http.get('*/api/cases/:id/mdt/record', () => HttpResponse.json({ detail: 'unavailable' }, { status: 501 })))
    renderApp(); const user = userEvent.setup(); await openReferenceCase(user); await openTab(user, 'Komunikace')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Odeslat PL' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Odeslat PL' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tato funkce zatím není implementována.')
    expect(within(dialog).getByRole('button', { name: 'Odeslat PL' })).toBeDisabled()
    expect(demoState.getMessages()).toHaveLength(0)
    server.resetHandlers()
    await user.click(within(dialog).getByRole('button', { name: 'Zkusit znovu' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Odeslat PL' })).toBeEnabled())
  })

  it('does not invent a pending receipt or allow confirmation when receipts fail to load', async () => {
    await sentResult()
    server.use(http.get('*/api/cases/:id/receipts', () => HttpResponse.json({ detail: 'unavailable' }, { status: 501 })))
    renderApp(); const user = userEvent.setup(); await signIn(user, 'referring_doctor')
    const inbox = screen.getByRole('region', { name: 'Doručená pošta' })
    expect(await within(inbox).findByRole('alert')).toHaveTextContent('Tato funkce zatím není implementována.')
    expect(within(inbox).queryByText('Čeká na potvrzení převzetí')).not.toBeInTheDocument()
    expect(within(inbox).queryByText('1 k potvrzení')).not.toBeInTheDocument()
    await user.click(within(inbox).getByRole('button', { name: /Výsledek MDT: Alena Procházková/ }))
    await screen.findByText('Fiktivní závěr MDT.')
    expect(screen.getByRole('button', { name: 'Potvrzuji převzetí' })).toBeDisabled()
    server.resetHandlers()
    await user.click(within(inbox).getByRole('button', { name: 'Zkusit znovu' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Potvrzuji převzetí' })).toBeEnabled())
  })

  it('records a simulated patient notice and keeps its Czech draft when changing UI language', async () => {
    renderApp(); const user = userEvent.setup(); await openReferenceCase(user); await openTab(user, 'Komunikace')
    await user.click(screen.getByRole('button', { name: 'Informovat pacienta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Informovat pacienta (simulace)' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Předmět/ }), { target: { value: 'Termín MDT' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Text zprávy/ }), { target: { value: 'Fiktivní informace o termínu.' } })
    // Escape closes the dialog without creating a message.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(demoState.getMessages()).toHaveLength(0)
    await setLanguage(user, 'English')
    await user.click(screen.getByRole('button', { name: 'Inform patient' }))
    const english = await screen.findByRole('dialog', { name: 'Inform patient (simulation)' })
    fireEvent.change(within(english).getByRole('textbox', { name: /^Subject/ }), { target: { value: 'Termín MDT' } })
    fireEvent.change(within(english).getByRole('textbox', { name: /^Message text/ }), { target: { value: 'Fiktivní informace o termínu.' } })
    await act(async () => { await changeLanguage('cs') })
    expect(within(english).getByRole('textbox', { name: /^Text zprávy/ })).toHaveValue('Fiktivní informace o termínu.')
    await act(async () => { await changeLanguage('en') })
    await user.click(within(english).getByRole('button', { name: 'Record notice' }))
    expect(await screen.findByText('The notice has been recorded in the history. It was not delivered to the patient.')).toBeVisible()
    expect(screen.getByText('Fiktivní informace o termínu.')).toBeVisible()
    expect(demoState.getMessages()[0]).toMatchObject({ simulated: true, recipient_ids: [] })
    expect(demoState.getCases().find((item) => item.id === referenceId)?.state).toBe('kompletni')
  })

  it('shows returned referral notes with an edit link and no close-case confirmation', async () => {
    demoState.saveMessage({ id: 'returned', case_id: 'demo-s4', kind: 'case_returned', sender_id: 'koordinator', recipient_ids: ['pl-reznicek'], subject: 'Žádost k doplnění', body: 'Doplňte údaj.', sent_at: '2026-10-21T09:00:00' })
    renderApp(); const user = userEvent.setup(); await signIn(user, 'referring_doctor')
    await user.click(await screen.findByRole('button', { name: /Žádost k doplnění/ }))
    await waitFor(() => expect(screen.getByText('Doplňte údaj.')).toBeVisible())
    expect(screen.getByRole('link', { name: 'Zobrazit žádost' })).toHaveAttribute('href', '/referrer/cases/demo-s4')
    expect(screen.queryByRole('button', { name: 'Potvrzuji převzetí' })).not.toBeInTheDocument()
  })

  it('clears the inbox and receipt queries when the demo is reset', async () => {
    await sentResult()
    const { queryClient } = renderApp(), user = userEvent.setup(); await signIn(user, 'referring_doctor')
    await screen.findByRole('button', { name: /Výsledek MDT: Alena Procházková/ })
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const demo = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(demo).getByRole('button', { name: 'Obnovit prázdné demo' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Obnovit data' }))
    await screen.findByText('Demo bylo obnoveno.')
    await user.click(within(demo).getByRole('button', { name: 'Zavřít' }))
    expect(await screen.findByText('Ve schránce zatím nejsou žádné zprávy.')).toBeVisible()
    expect(queryClient.getQueryCache().getAll().some((query) => JSON.stringify(query.queryKey).includes('listCaseReceipts'))).toBe(false)
    await act(async () => { await queryClient.invalidateQueries() })
    expect(screen.queryByRole('button', { name: /Výsledek MDT: Alena Procházková/ })).not.toBeInTheDocument()
  })
})
