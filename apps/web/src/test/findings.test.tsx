import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { finding, openReferenceCase, openTab } from './shell'

async function openFindings() {
  const view = await openReferenceCase()
  const panel = await openTab(view.user, /^K řešení/)
  await within(panel).findByRole('heading', { name: 'Chybějící údaje a rozpory' })
  return { ...view, panel }
}

describe('findings worklist', () => {
  it('opens a finding source with the exact quote highlighted and returns focus on Escape', async () => {
    const { user } = await openFindings()
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