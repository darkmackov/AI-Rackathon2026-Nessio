import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

export type User = ReturnType<typeof userEvent.setup>

/** Opens the header user menu and returns it. */
export async function openUserMenu(user: User) {
  await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /^(Uživatel|User) / }))
  return screen.findByRole('menu')
}

export async function changeIdentity(user: User) {
  const menu = await openUserMenu(user)
  await user.click(within(menu).getByRole('menuitem', { name: /Změnit osobu|Change person/ }))
}

export async function setLanguage(user: User, language: 'Čeština' | 'English') {
  await user.click(screen.getByRole('button', { name: /Změnit jazyk|Change language/ }))
  await user.click(await screen.findByRole('menuitem', { name: language }))
}

const people = { koordinator: 'Bc. Lucie Dvořáková', 'pl-reznicek': 'MUDr. Tomáš Řezníček' } as Record<string, string>

/** Picks a role and person on the identity page and waits for their home screen. */
export async function signIn(user: User, role: 'coordinator' | 'referring_doctor' = 'coordinator', id = role === 'coordinator' ? 'koordinator' : 'pl-reznicek') {
  await user.selectOptions(await screen.findByLabelText('Role'), role)
  await screen.findByRole('option', { name: role === 'coordinator' ? people.koordinator : people['pl-reznicek'] })
  await user.selectOptions(screen.getByLabelText('Osoba'), id)
  await user.click(screen.getByRole('button', { name: 'Pokračovat' }))
  await screen.findByRole('heading', { level: 1, name: role === 'coordinator' ? 'Pracovní fronta koordinátora' : `Vítejte, ${people[id] ?? ''}` })
}

/** Signs in as the reference coordinator and opens the reference case on its overview. */
export async function openReferenceCase(user: User) {
  await signIn(user)
  await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
  await screen.findByRole('heading', { level: 1, name: 'Alena Procházková' })
  await screen.findByRole('heading', { name: 'Údaje o případu' })
}

export async function openTab(user: User, name: RegExp | string) {
  await user.click(screen.getByRole('tab', { name }))
  return screen.getByRole('tabpanel', { name })
}

/** Makes the wide (≥ 75em) layout active, where the source opens beside the content. */
export function wideScreen() {
  vi.mocked(window.matchMedia).mockImplementation((media) => ({
    matches: media.includes('75em') || media.includes('48em'), media, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

/** A handover value, addressed by its label. */
export function field(name: string | RegExp) {
  return screen.getByRole('group', { name })
}

/** A finding in the worklist, addressed by its message. */
export function finding(name: string | RegExp) {
  return screen.getByRole('article', { name })
}