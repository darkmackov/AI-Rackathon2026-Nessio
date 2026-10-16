import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { Handover } from '../client/types.gen'
import { referenceHandover } from '../mocks/reference-data'
import { renderApp } from './renderApp'
import { field, openReferenceCase, openTab, wideScreen, type User } from './shell'
import { server } from './setup'

function serveHandover(handover: Handover) {
  server.use(http.get('*/api/cases/:id/handover', () => HttpResponse.json(handover)))
}

async function openHandover(user: User, expand = true) {
  await openReferenceCase(user)
  const panel = await openTab(user, 'Předávka')
  if (expand) await user.click(await within(panel).findByRole('button', { name: 'Rozbalit vše' }))
  return panel
}

const manual = { by: 'koordinator', at: '2026-10-20T10:00:00' }

describe('handover', () => {
  it('opens only sections with gaps or conflicts until the user expands them', async () => {
    serveHandover({ ...referenceHandover, weight_kg: { value: 65, status: 'conflict', origin: 'ai', evidence: [{ document_id: '04', quote: '65 kg' }] }, other: { value: 'Přání pacientky', status: 'found', origin: 'manual', entered: manual } })
    renderApp()
    const user = userEvent.setup()
    const panel = await openHandover(user, false)
    const history = await within(panel).findByRole('button', { name: /^Anamnézy a stav/ })
    const other = within(panel).getByRole('button', { name: /^Další sdělení/ })
    expect(history).toHaveAttribute('aria-expanded', 'true')
    expect(history).toHaveTextContent(/k řešení/)
    expect(other).toHaveAttribute('aria-expanded', 'false')
    await user.click(within(panel).getByRole('button', { name: 'Rozbalit vše' }))
    expect(other).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(panel).getByRole('button', { name: 'Sbalit vše' }))
    expect(history).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows every competing value with its source, and AI or manual provenance', async () => {
    serveHandover({
      ...referenceHandover,
      weight_kg: { value: 65, status: 'conflict', origin: 'ai', evidence: [{ document_id: '04', quote: '65 kg' }, { document_id: '07', quote: '62 kg' }], note: 'Hmotnosti se liší.' },
      other: { value: 'Přání pacientky', status: 'found', origin: 'manual', entered: manual },
    })
    renderApp()
    const user = userEvent.setup()
    await openHandover(user)
    const weight = field('Hmotnost (kg)')
    expect(within(weight).getByText('Rozpor')).toBeVisible()
    expect(within(weight).getByText('AI návrh')).toBeVisible()
    const sources = within(weight).getByRole('group', { name: 'Zdroje' })
    expect(within(sources).getByText('65 kg')).toBeVisible()
    expect(within(sources).getByText('62 kg')).toBeVisible()
    expect(within(sources).getByRole('button', { name: /^Zdroj 1: Epikríza a žádost o vyšetření/ })).toBeVisible()
    expect(within(sources).getByRole('button', { name: /^Zdroj 2: Epikríza a žádost o převzetí/ })).toBeVisible()
    const other = field('Další sdělení')
    expect(within(other).getByText('Ruční zadání')).toBeVisible()
    expect(within(other).queryByText('AI návrh')).not.toBeInTheDocument()
    expect(within(other).getByText('Bc. Lucie Dvořáková')).toBeVisible()
  })

  it('shows zero and empty manual values explicitly without inventing data', async () => {
    serveHandover({
      ...referenceHandover,
      symptoms: { status: 'found', origin: 'manual', value: '', entered: manual },
      comorbidities: { status: 'found', origin: 'manual', value: [], entered: manual },
      weight_kg: { status: 'found', origin: 'manual', value: 0, entered: manual },
    })
    renderApp()
    const user = userEvent.setup()
    await openHandover(user)
    expect(within(field('Příznaky a jejich počátek')).getByText('Prázdná hodnota.')).toBeVisible()
    expect(within(field('Komorbidity (OA)')).getByText('Prázdná hodnota.')).toBeVisible()
    expect(within(field('Hmotnost (kg)')).getByText('0')).toBeVisible()
    for (const name of ['Příznaky a jejich počátek', 'Komorbidity (OA)', 'Hmotnost (kg)']) expect(within(field(name)).getByText('Ruční zadání')).toBeVisible()
  })

  it('shows a finding at its value and links it to the worklist', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await openHandover(user, false)
    const performance = field('Stav výkonnosti')
    expect(within(performance).getByText('Chybí')).toBeVisible()
    expect(within(performance).getByText('Blokující')).toBeVisible()
    expect(within(performance).getByText(/není v podkladech výslovně stanoven/)).toBeVisible()
    for (const name of ['Doplnit', 'Vyžádat']) expect(within(performance).getByRole('button', { name })).toBeDisabled()
    await user.click(within(performance).getByRole('link', { name: 'Přejít na nález' }))
    expect(router.state.location).toMatchObject({ search: { tab: 'findings' }, hash: 'finding-F01' })
    expect(screen.getByRole('tab', { name: /^K řešení/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens a source chip beside the handover with the quote highlighted and marks the chip active', async () => {
    wideScreen()
    renderApp()
    const user = userEvent.setup()
    await openHandover(user, false)
    expect(screen.getByText('Vyberte zdroj u hodnoty')).toBeVisible()
    const chip = within(field('Stav výkonnosti')).getByRole('button', { name: /^Zdroj 1: Epikríza a žádost o převzetí/ })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip)
    const source = await screen.findByRole('complementary', { name: 'Zdrojový dokument' })
    const text = await within(source).findByTestId('document-text')
    expect(text.querySelector('mark')?.textContent).toBe('Soběstačná, v práci t. č. v pracovní neschopnosti.')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Vyberte zdroj u hodnoty')).not.toBeInTheDocument()
  })

  it('opens an unavailable-source state instead of requesting an unrelated document', async () => {
    serveHandover({ ...referenceHandover, other: { value: 'Údaj', status: 'found', origin: 'ai', evidence: [{ document_id: 'unrelated', quote: 'Údaj' }] } })
    renderApp()
    const user = userEvent.setup()
    await openHandover(user)
    await user.click(within(field('Další sdělení')).getByRole('button', { name: /^Zdroj 1/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(within(source).getByText('Zdrojový dokument není mezi podklady tohoto případu.')).toBeVisible()
    expect(within(source).queryByRole('button', { name: 'Stáhnout originál' })).not.toBeInTheDocument()
  })

  it('copies a section as plain text', async () => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderApp()
    const user = userEvent.setup()
    await openHandover(user)
    const section = screen.getByRole('region', { name: /^Nacionále pacienta/ })
    await user.click(within(section).getByRole('button', { name: 'Kopírovat sekci' }))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Jméno: Alena [Nalezeno; AI návrh]'))
    expect(await within(section).findByText('Sekce byla zkopírována.')).toBeVisible()
  })
})