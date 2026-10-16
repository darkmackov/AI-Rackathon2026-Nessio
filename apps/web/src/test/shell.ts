import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

type User = ReturnType<typeof userEvent.setup>

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
