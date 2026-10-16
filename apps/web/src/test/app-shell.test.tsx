import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { listCasesQueryKey, meQueryKey } from '../client/@tanstack/react-query.gen'
import { actorHeaders } from '../api'
import { referenceCases } from '../mocks/reference'
import { entrySearch } from '../session'
import { renderApp } from './renderApp'
import { changeIdentity, openUserMenu, setLanguage, signIn } from './shell'
import { demoState, server } from './setup'

describe('app shell, identity and demo controls', () => {
  it('requires choosing a person even for a direct role URL, then sends their identity and KOC filter', async () => {
    const seen: string[] = []
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/api/me') || request.url.includes('/api/cases')) seen.push(`${request.url} ${request.headers.get('X-Actor-Id')}`)
    })
    const { router, queryClient } = renderApp('/coordinator')
    const user = userEvent.setup()
    await signIn(user)
    expect(await screen.findByText('Alena Procházková')).toBeVisible()
    expect(router.state.location.pathname).toBe('/coordinator')
    expect(seen.some((value) => value.endsWith('/api/me koordinator'))).toBe(true)
    expect(seen.some((value) => value.includes('koc_id=koc2-lipova') && value.endsWith('koordinator'))).toBe(true)
    expect(queryClient.getQueryData(meQueryKey({ headers: actorHeaders('koordinator') }))).toMatchObject({ id: 'koordinator' })
  })

  it('returns to the reloaded page, with its tab, after choosing a person again', async () => {
    const { router } = renderApp('/coordinator/cases/vzp-prochazkova?tab=tasks')
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Role'), 'coordinator')
    await screen.findByRole('option', { name: 'Bc. Lucie Dvořáková' })
    await user.selectOptions(screen.getByLabelText('Osoba'), 'koordinator')
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Alena Procházková' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/coordinator/cases/vzp-prochazkova')
    expect(router.state.location.search).toEqual({ tab: 'tasks' })
  })

  it('sends a person to their role home when the reloaded page belongs to another role or is not a local path', async () => {
    const { router } = renderApp('/coordinator/cases/vzp-prochazkova')
    const user = userEvent.setup()
    await signIn(user, 'referring_doctor', 'pl-reznicek')
    expect(router.state.location.pathname).toBe('/referrer')
    expect(entrySearch({ redirect: '//evil.example' })).toEqual({})
    expect(entrySearch({ redirect: 'https://evil.example' })).toEqual({})
    expect(entrySearch({ redirect: '/referrer' })).toEqual({ redirect: '/referrer' })
  })

  it('removes the old person and their data when switching identities, including another KOC', async () => {
    const { queryClient } = renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await screen.findByText('Alena Procházková')
    await changeIdentity(user)
    expect(screen.queryByText('Alena Procházková')).not.toBeInTheDocument()
    expect(queryClient.getQueriesData({ queryKey: listCasesQueryKey() })).toEqual([])
    await signIn(user, 'coordinator', 'koord-severni')
    expect(await screen.findByText('Vaše KOC zatím nemá žádné případy.')).toBeVisible()
    expect(screen.queryByText('Alena Procházková')).not.toBeInTheDocument()
    expect(screen.getByText('Mgr. Jitka Králová')).toBeVisible()
  })

  it('translates UI and document language while keeping Czech clinical data and identity', async () => {
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await screen.findByText('Alena Procházková')
    await setLanguage(user, 'English')
    expect(await screen.findByRole('heading', { name: 'Coordinator work queue' })).toBeVisible()
    expect(screen.getByText('C25.0 Duktální adenokarcinom hlavy pankreatu')).toBeVisible()
    expect(within(screen.getByRole('banner')).getByText('Bc. Lucie Dvořáková')).toBeVisible()
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Oncology coordination')
  })

  it('does not restore old patient data when a cancelled request finishes after an identity switch', async () => {
    let finish: (() => void) | undefined
    let requested: (() => void) | undefined
    const started = new Promise<void>((resolve) => { requested = resolve })
    const held = new Promise<void>((resolve) => { finish = resolve })
    server.use(http.get('*/api/cases', async ({ request }) => {
      if (new URL(request.url).searchParams.get('koc_id') === 'koc2-lipova') {
        requested?.()
        await held
        return HttpResponse.json(referenceCases)
      }
      return HttpResponse.json([])
    }))
    const { queryClient } = renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await started
    await changeIdentity(user)
    await signIn(user, 'coordinator', 'koord-severni')
    await screen.findByText('Vaše KOC zatím nemá žádné případy.')
    await act(async () => { finish?.() })
    expect(screen.queryByText('Alena Procházková')).not.toBeInTheDocument()
    expect(queryClient.getQueryData(listCasesQueryKey({ headers: actorHeaders('koordinator'), query: { koc_id: 'koc2-lipova' } }))).toBeUndefined()
  })

  it('shows the referrer identity in the user menu, redirects a wrong-role route, and offers no referral controls', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await signIn(user, 'referring_doctor', 'pl-reznicek')
    const menu = await openUserMenu(user)
    expect(await within(menu).findByText('Ordinace praktického lékaře pro dospělé, MUDr. Tomáš Řezníček')).toBeVisible()
    expect(within(menu).getByText('Odesílající lékař')).toBeVisible()
    await user.keyboard('{Escape}')
    await act(async () => { await router.navigate({ to: '/coordinator' }) })
    await waitFor(() => expect(router.state.location.pathname).toBe('/referrer'))
    expect(screen.queryByRole('button', { name: 'Validovat a odeslat' })).not.toBeInTheDocument()
  })

  it('shows a retryable directory error instead of technical details', async () => {
    server.use(http.get('*/api/directory/actors', () => HttpResponse.json({ detail: 'secret internal stack' }, { status: 500 })))
    renderApp()
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.queryByText('secret internal stack')).not.toBeInTheDocument()
    server.resetHandlers()
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findByRole('option', { name: 'MUDr. Tomáš Řezníček' })).toBeInTheDocument()
  })

  it('does not enter the shell when /me rejects the selected person', async () => {
    server.use(http.get('*/api/me', () => HttpResponse.json({ detail: 'unknown actor' }, { status: 404 })))
    renderApp()
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Osoba'), 'pl-reznicek')
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Požadované údaje nebyly nalezeny.')
    expect(screen.queryByRole('button', { name: /^Uživatel / })).not.toBeInTheDocument()
  })

  it('sets time, switches to real time, confirms reset, and preserves identity and language', async () => {
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await screen.findByText('Alena Procházková')
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const drawer = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    const field = within(drawer).getByLabelText('Datum a čas')
    await user.clear(field)
    await user.type(field, '2026-10-27T15:30')
    await user.click(within(drawer).getByRole('button', { name: 'Nastavit čas' }))
    expect(await within(drawer).findByText('Čas aplikace byl změněn.')).toBeVisible()
    expect(demoState.clock().now).toMatch(/^2026-10-27T15:30/)
    await user.click(within(drawer).getByRole('button', { name: 'Použít skutečný čas' }))
    await waitFor(() => expect(demoState.clock().simulated).toBe(false))
    await setLanguage(user, 'English')
    await user.click(within(drawer).getByRole('button', { name: 'Restore empty demo' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Restore the demo?' })
    expect(demoState.getCases()).toHaveLength(2)
    await user.click(within(confirmation).getByRole('button', { name: 'Restore data' }))
    await screen.findByText('The demo has been restored.')
    expect(demoState.getCases()).toEqual([])
    expect(demoState.clock().now).toMatch(/^2026-10-02T14:00/)
    const resetTime = within(drawer).getByLabelText('Date and time')
    expect(resetTime).toBeInstanceOf(HTMLInputElement)
    if (resetTime instanceof HTMLInputElement) expect(resetTime.value).toMatch(/^2026-10-02T14:00/)
    await user.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('heading', { name: 'Coordinator work queue' })).toBeVisible()
    expect(within(screen.getByRole('banner')).getByText('Bc. Lucie Dvořáková')).toBeVisible()
    expect(await screen.findByText('There are no cases at your KOC yet.')).toBeVisible()
  })

  it('validates the time on submit and focuses the error summary', async () => {
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const drawer = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.clear(within(drawer).getByLabelText('Datum a čas'))
    await user.click(within(drawer).getByRole('button', { name: 'Nastavit čas' }))
    const summary = await within(drawer).findByRole('alert')
    expect(summary).toHaveFocus()
    expect(summary).toHaveTextContent('Zadejte platné místní datum a čas.')
  })

  it('keeps data when reset is cancelled or fails, and can retry the same confirmation', async () => {
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const drawer = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(drawer).getByRole('button', { name: 'Obnovit prázdné demo' }))
    let confirmation = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Zrušit' }))
    expect(demoState.getCases()).toHaveLength(2)
    server.use(http.post('*/api/demo/reset', () => HttpResponse.json({ detail: 'failed reset' }, { status: 500 })))
    await user.click(within(drawer).getByRole('button', { name: 'Obnovit prázdné demo' }))
    confirmation = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Obnovit data' }))
    expect(await within(confirmation).findByRole('alert')).toBeVisible()
    expect(demoState.getCases()).toHaveLength(2)
    server.resetHandlers()
    await user.click(within(confirmation).getByRole('button', { name: 'Obnovit data' }))
    await screen.findByText('Demo bylo obnoveno.')
    expect(demoState.getCases()).toEqual([])
    await user.click(within(drawer).getByRole('button', { name: 'Obnovit referenci' }))
    confirmation = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Obnovit data' }))
    await waitFor(() => expect(demoState.getCases()).toHaveLength(2))
    expect(demoState.clock().now).toMatch(/^2026-10-21T09:00/)
  })

  it('blocks overlapping writes and closing the Demo panel until a pending clock update finishes', async () => {
    let finish: (() => void) | undefined
    const held = new Promise<void>((resolve) => { finish = resolve })
    server.use(http.put('*/api/demo/clock', async () => { await held; return HttpResponse.json(demoState.clock()) }))
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const drawer = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(drawer).getByRole('button', { name: 'Nastavit čas' }))
    expect(within(drawer).getByLabelText('Datum a čas')).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Obnovit prázdné demo' })).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Zavřít' })).toBeDisabled()
    await act(async () => { finish?.() })
    await screen.findByText('Čas aplikace byl změněn.')
    expect(within(drawer).getByLabelText('Datum a čas')).toBeEnabled()
  })

  it('returns focus after closing the Demo dialog with Escape', async () => {
    renderApp()
    const user = userEvent.setup()
    await signIn(user, 'referring_doctor')
    const button = screen.getByRole('button', { name: 'Demo' })
    await user.click(button)
    await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('shows a translated not-found page with a way home', async () => {
    renderApp('/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Stránka nebyla nalezena' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Přejít na úvod' })).toHaveAttribute('href', '/')
  })
})
