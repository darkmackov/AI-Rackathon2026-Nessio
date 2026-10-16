import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderApp } from './renderApp'
import { signIn } from './shell'
import { server } from './setup'

describe('coordinator work queue', () => {
  it('shows each case in its queue column with state, owner, next step, due date and time to treatment', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await signIn(user)
    const active = await screen.findByRole('region', { name: 'Aktivní pacient' })
    const card = await within(active).findByRole('article')
    expect(within(card).getByText('C25.0 Duktální adenokarcinom hlavy pankreatu')).toBeVisible()
    expect(within(card).getByText('Připraveno k MDT')).toBeVisible()
    expect(within(card).getByText('Vysoká')).toBeVisible()
    expect(within(card).getByText('MDT pro nádory GIT')).toBeVisible()
    expect(within(card).getByText(/^21\. 10\. 2026/)).toBeVisible()
    expect(await within(card).findByRole('button', { name: 'Kontakty: Bc. Lucie Dvořáková' })).toBeVisible()
    const time = within(card).getByRole('group', { name: 'Čas do léčby' })
    expect(await within(time).findByText('67 dní')).toBeVisible()
    expect(within(time).getByText('T1 48 d, T2 19 d')).toBeVisible()
    for (const name of ['Odložený pacient']) expect(within(screen.getByRole('region', { name })).getByText('V této skupině nejsou žádné případy.')).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Nový pacient' })).getByRole('link', { name: 'Fiktivní pacient S4' })).toBeVisible()
    await user.click(within(card).getByRole('link', { name: 'Alena Procházková' }))
    expect(router.state.location).toMatchObject({ pathname: '/coordinator/cases/vzp-prochazkova', search: { tab: 'overview' } })
  })

  it('keeps a loaded case visible when directory name resolution fails', async () => {
    server.use(http.get('*/api/directory/organizations', () => HttpResponse.json({ detail: 'unavailable' }, { status: 500 })))
    renderApp()
    const user = userEvent.setup()
    await signIn(user)
    expect(await screen.findByRole('link', { name: 'Alena Procházková' })).toBeVisible()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })
})