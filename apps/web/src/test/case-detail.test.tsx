import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { getDemoClockQueryKey } from '../client/@tanstack/react-query.gen'
import { isCaseQuery } from '../case-queries'
import { referenceCases } from '../mocks/reference'
import { referenceFindings } from '../mocks/reference-data'
import { quoteSegments } from '../screens/CaseDetail/clinical'
import { renderApp } from './renderApp'
import { changeIdentity, finding, openReferenceCase, openTab, setLanguage, signIn, wideScreen } from './shell'
import { demoState, server } from './setup'

describe('case detail', () => {
  it('shows where the case is, who is on the move, by when and what needs attention in the header', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const header = screen.getByRole('region', { name: 'Alena Procházková' })
    expect(within(header).getByText('Připraveno k MDT')).toBeVisible()
    expect(within(header).getByText('Vysoká')).toBeVisible()
    expect(within(header).getByRole('button', { name: 'Kontakty: Bc. Lucie Dvořáková' })).toBeVisible()
    expect(within(header).getByText('MDT pro nádory GIT')).toBeVisible()
    expect(within(header).getByText(/^21\. 10\. 2026/)).toBeVisible()
    for (const name of ['Převzít', 'Vrátit lékaři', 'Odložit']) expect(within(header).getByRole('button', { name })).toBeDisabled()
    const attention = await within(header).findByRole('group', { name: 'K řešení:' })
    expect(within(attention).getByRole('link', { name: '1 blokující nález' })).toBeVisible()
    await user.click(within(attention).getByRole('link', { name: '6 upozornění' }))
    expect(router.state.location.search).toMatchObject({ tab: 'findings' })
    await user.click(within(attention).getByRole('link', { name: /chybějící/ }))
    expect(router.state.location.search).toMatchObject({ tab: 'handover' })
    await user.click(within(header).getByRole('link', { name: /Zpět na pracovní frontu/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Pracovní fronta koordinátora' })).toBeVisible()
  })

  it('opens on the overview with running times and the handover status, and counts unresolved findings on its tab', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    expect(router.state.location).toMatchObject({ pathname: '/coordinator/cases/vzp-prochazkova', search: { tab: 'overview' } })
    expect(screen.getByRole('tab', { name: 'Přehled' })).toHaveAttribute('aria-selected', 'true')
    const time = screen.getByRole('group', { name: 'Čas do léčby' })
    expect(await within(time).findByText('67 dní')).toBeVisible()
    expect(within(time).getByText('48 dní')).toBeVisible()
    expect(within(time).getByText('19 dní')).toBeVisible()
    expect(within(time).getAllByText('probíhá')).toHaveLength(2)
    const status = screen.getByRole('region', { name: 'Stav předávky' })
    expect(within(status).getAllByText('Zatím nepotvrzeno')).toHaveLength(2)
    const unresolved = referenceFindings.filter((item) => !item.resolved).length
    expect(await screen.findByRole('tab', { name: new RegExp(`^K řešení\\s*${unresolved}$`) })).toBeVisible()
  })

  it('renders independent empty handover, finding, task and document states', async () => {
    server.use(
      http.get('*/api/cases/:id/handover', () => HttpResponse.json({ detail: 'no handover yet' }, { status: 404 })),
      ...['findings', 'documents', 'tasks'].map((part) => http.get(`*/api/cases/:id/${part}`, () => HttpResponse.json([]))),
    )
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
    expect(await screen.findByText('Předávka zatím není dostupná.')).toBeVisible()
    expect(await within(await openTab(user, 'K řešení')).findByText('Nejsou zaznamenány žádné nedostatky ani rozpory.')).toBeVisible()
    expect(await within(await openTab(user, 'Úkoly')).findByText('Případ zatím nemá žádné úkoly.')).toBeVisible()
    expect(await within(await openTab(user, 'Dokumenty')).findByText('Případ zatím nemá žádné dokumenty.')).toBeVisible()
  })

  it('offers a way back for an unknown case URL', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await act(async () => { await router.navigate({ to: '/coordinator/cases/$caseId', params: { caseId: 'unknown' }, search: { tab: 'documents' } }) })
    expect(await screen.findByRole('heading', { name: 'Případ není pro vaše KOC k dispozici.' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Zpět na pracovní frontu/ })).toHaveAttribute('href', '/coordinator')
  })

  it('does not fetch child data for a case belonging to another KOC', async () => {
    const childRequests: string[] = []
    const listener = ({ request }: { request: Request }) => { if (/\/cases\/[^/]+\/(handover|findings|documents|tasks)/.test(request.url)) childRequests.push(request.url) }
    server.events.on('request:start', listener)
    server.use(http.get('*/api/cases/:id', () => HttpResponse.json({ ...referenceCases[0], koc_id: 'koc1-severni' })))
    renderApp()
    const user = userEvent.setup()
    try {
      await signIn(user)
      await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
      expect(await screen.findByRole('heading', { name: 'Případ není pro vaše KOC k dispozici.' })).toBeVisible()
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
      expect(childRequests).toEqual([])
    } finally { server.events.removeListener('request:start', listener) }
  })

  it('refreshes running intervals when the demo date changes', async () => {
    const { queryClient } = renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const time = screen.getByRole('group', { name: 'Čas do léčby' })
    expect(await within(time).findByText('19 dní')).toBeVisible()
    await act(async () => {
      demoState.setTime('2026-10-22T00:00:00')
      await queryClient.invalidateQueries({ queryKey: getDemoClockQueryKey() })
    })
    expect(await within(time).findByText('20 dní')).toBeVisible()
    expect(within(time).getByText('68 dní')).toBeVisible()
  })

  it('shows task dependencies, keeps task actions disabled and never marks finished tasks overdue', async () => {
    demoState.setTime('2026-10-28T09:00:00')
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const panel = await openTab(user, 'Úkoly')
    const rows = (await within(panel).findAllByRole('row')).slice(1)
    expect(rows).toHaveLength(7)
    expect(within(panel).getByRole('button', { name: 'Spustit sadu úkolů' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Přidat úkol' })).toBeDisabled()
    expect(rows.filter((row) => within(within(row).getAllByRole('cell')[1]).queryByText('Dokončeno')).every((row) => !within(row).queryByText(/Po termínu/))).toBe(true)
    expect(rows.filter((row) => within(row).queryByText(/Po termínu/))).toHaveLength(3)
    expect(within(panel).getAllByRole('link', { name: /CT břicha a hrudníku/ }).length).toBeGreaterThan(0)
  })

  it('translates the detail while keeping Czech clinical data', async () => {
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await setLanguage(user, 'English')
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Alena Procházková' })).toBeVisible()
    expect(screen.getByText('C25.0 Duktální adenokarcinom hlavy pankreatu')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Take over' })).toBeDisabled()
    const panel = await openTab(user, 'Handover')
    expect(await within(panel).findByRole('button', { name: /^History and condition/ })).toBeVisible()
  })

  it('clears detail data on reset and keeps the selected person and language', async () => {
    const { router, queryClient } = renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await setLanguage(user, 'English')
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const panel = await screen.findByRole('dialog', { name: 'Demo controls' })
    await user.click(within(panel).getByRole('button', { name: 'Restore empty demo' }))
    const confirm = await screen.findByRole('dialog', { name: 'Restore the demo?' })
    await user.click(within(confirm).getByRole('button', { name: 'Restore data' }))
    await screen.findByText('The demo has been restored.')
    expect(router.state.location.pathname).toBe('/coordinator')
    expect(queryClient.getQueryCache().findAll({ predicate: isCaseQuery })).toEqual([])
    await user.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('There are no cases at your KOC yet.')).toBeVisible()
    expect(within(screen.getByRole('banner')).getByText('Bc. Lucie Dvořáková')).toBeVisible()
  })
})

describe('source panel', () => {
  it('closes a desktop source on Escape, returns focus and disappears when the reference is reset', async () => {
    wideScreen()
    const { router } = renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await openTab(user, /^K řešení/)
    const source = within(finding(/^Stav výkonnosti/)).getByRole('button', { name: /^Zdroj 1/ })
    await user.click(source)
    const panel = await screen.findByRole('complementary', { name: 'Zdrojový dokument' })
    await within(panel).findByTestId('document-text')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'Zdrojový dokument' })).not.toBeInTheDocument()
    expect(source).toHaveFocus()
    await user.click(source)
    await screen.findByRole('complementary', { name: 'Zdrojový dokument' })
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const demo = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(demo).getByRole('button', { name: 'Obnovit referenci' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Obnovit data' }))
    await screen.findByText('Demo bylo obnoveno.')
    await user.click(within(demo).getByRole('button', { name: 'Zavřít' }))
    expect(router.state.location.pathname).toBe('/coordinator')
    expect(screen.queryByRole('complementary', { name: 'Zdrojový dokument' })).not.toBeInTheDocument()
    expect(await screen.findByText('67 dní')).toBeVisible()
  })

  it('keeps full source text readable when a supplied quote is absent', async () => {
    server.use(http.get('*/api/documents/:id/text', () => HttpResponse.json({ id: '07', text: '<script>unsafe()</script> Jiný úplný text.' })))
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await openTab(user, /^K řešení/)
    await user.click(within(finding(/^Stav výkonnosti/)).getByRole('button', { name: /^Zdroj 1/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(await within(source).findByText('Citaci se nepodařilo v textu nalézt.')).toBeVisible()
    const text = within(source).getByTestId('document-text')
    expect(text).toHaveTextContent('<script>unsafe()</script> Jiný úplný text.')
    expect(text.querySelector('script')).toBeNull()
    expect(text.querySelector('mark')).toBeNull()
  })

  it('aborts source loading and removes all previous case data on identity change', async () => {
    let finish: (() => void) | undefined
    let started: (() => void) | undefined
    const held = new Promise<void>((resolve) => { finish = resolve })
    const requested = new Promise<void>((resolve) => { started = resolve })
    server.use(http.get('*/api/documents/:id/text', async () => { started?.(); await held; return HttpResponse.json({ id: '07', text: 'OLD PATIENT TEXT' }) }))
    const { queryClient } = renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await openTab(user, /^K řešení/)
    await user.click(within(finding(/^Stav výkonnosti/)).getByRole('button', { name: /^Zdroj 1/ }))
    await requested
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zdrojový dokument' })).not.toBeInTheDocument())
    await changeIdentity(user)
    await signIn(user, 'coordinator', 'koord-severni')
    await act(async () => { finish?.() })
    expect(await screen.findByText('Vaše KOC zatím nemá žádné případy.')).toBeVisible()
    expect(screen.queryByText('OLD PATIENT TEXT')).not.toBeInTheDocument()
    expect(queryClient.getQueryCache().findAll({ predicate: isCaseQuery })).toEqual([])
  })

  it('highlights quotes by code-point offsets and falls back safely for incorrect offsets', () => {
    const text = '😀 lék; lék'
    expect(quoteSegments(text, { document_id: 'x', quote: 'lék', start: 2, end: 5 }).filter((item) => item.highlight)).toHaveLength(1)
    expect(quoteSegments(text, { document_id: 'x', quote: 'lék', start: 99, end: 103 }).filter((item) => item.highlight)).toHaveLength(2)
    expect(quoteSegments(text, { document_id: 'x', quote: 'neexistuje' })).toEqual([{ text, highlight: false }])
  })
})