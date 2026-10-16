import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { referenceFindings } from '../mocks/reference-data'
import { renderApp } from './renderApp'
import { field, finding, openReferenceCase, openTab, type User } from './shell'

async function openFindings(user: User) {
  await openReferenceCase(user)
  const panel = await openTab(user, /^K řešení/)
  await within(panel).findByRole('heading', { name: 'Chybějící údaje a rozpory' })
  return panel
}

describe('findings worklist', () => {
  it('groups unresolved findings by severity and keeps resolved ones collapsed', async () => {
    renderApp()
    const user = userEvent.setup()
    const panel = await openFindings(user)
    const open = referenceFindings.filter((item) => !item.resolved)
    for (const [severity, name] of [['blocker', 'Blokující'], ['warning', 'Upozornění'], ['info', 'Informace']] as const) {
      const group = within(panel).getByRole('region', { name })
      expect(within(group).getAllByRole('article')).toHaveLength(open.filter((item) => item.severity === severity).length)
    }
    const blocker = finding(/^Stav výkonnosti/)
    expect(within(blocker).queryByText('F01')).not.toBeInTheDocument()
    expect(within(blocker).getByText('Chybějící údaj')).toBeVisible()
    expect(within(blocker).getByText('Lze překonat s poznámkou')).toBeVisible()
    expect(within(blocker).getByRole('button', { name: 'Vyžádat' })).toBeEnabled()
    expect(within(panel).getByText('Poradní upozornění')).toBeVisible()
    expect(within(panel).getByRole('button', { name: /^Vyřešené nálezy/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('jumps from a finding to its handover value and opens that section', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await openFindings(user)
    await user.click(within(finding(/^Stav výkonnosti/)).getByRole('link', { name: 'Stav výkonnosti' }))
    expect(router.state.location).toMatchObject({ search: { tab: 'handover' }, hash: 'field-performance_status' })
    expect(await screen.findByRole('button', { name: /^Anamnézy a stav/ })).toHaveAttribute('aria-expanded', 'true')
    expect(field('Stav výkonnosti')).toBeVisible()
  })

  it('opens a finding source with the exact quote highlighted and returns focus on Escape', async () => {
    renderApp()
    const user = userEvent.setup()
    await openFindings(user)
    const button = within(finding(/^Stav výkonnosti/)).getByRole('button', { name: /^Zdroj 1/ })
    await user.click(button)
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    const text = await within(source).findByTestId('document-text')
    expect(text.querySelector('mark')?.textContent).toBe('Soběstačná, v práci t. č. v pracovní neschopnosti.')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zdrojový dokument' })).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })
})