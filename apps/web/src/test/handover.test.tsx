import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { Handover } from '../client/types.gen'
import { referenceHandover } from '../mocks/reference-data'
import { field, openReferenceCase, openTab, wideScreen } from './shell'
import { server } from './setup'

function serveHandover(handover: Handover) {
  server.use(http.get('*/api/cases/:id/handover', () => HttpResponse.json(handover)))
}

async function openHandover(expand = true) {
  const view = await openReferenceCase()
  const panel = await openTab(view.user, 'Předávka')
  if (expand) await view.user.click(await within(panel).findByRole('button', { name: 'Rozbalit vše' }))
  return { ...view, panel }
}

const manual = { by: 'koordinator', at: '2026-10-20T10:00:00' }

describe('handover', () => {
  it('shows zero and empty manual values explicitly without inventing data', async () => {
    serveHandover({
      ...referenceHandover,
      symptoms: { status: 'found', origin: 'manual', value: '', entered: manual },
      comorbidities: { status: 'found', origin: 'manual', value: [], entered: manual },
      weight_kg: { status: 'found', origin: 'manual', value: 0, entered: manual },
    })
    await openHandover()
    expect(within(field('Příznaky a jejich počátek')).getByText('Prázdná hodnota.')).toBeVisible()
    expect(within(field('Komorbidity (OA)')).getByText('Prázdná hodnota.')).toBeVisible()
    expect(within(field('Hmotnost (kg)')).getByText('0')).toBeVisible()
    for (const name of ['Příznaky a jejich počátek', 'Komorbidity (OA)', 'Hmotnost (kg)']) expect(within(field(name)).getByText('Ruční zadání')).toBeVisible()
  })

  it('opens a source chip beside the handover with the quote highlighted and marks the chip active', async () => {
    wideScreen()
    const { user } = await openHandover(false)
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
    const { user } = await openHandover()
    await user.click(within(field('Další sdělení')).getByRole('button', { name: /^Zdroj 1/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(within(source).getByText('Zdrojový dokument není mezi podklady tohoto případu.')).toBeVisible()
    expect(within(source).queryByRole('button', { name: 'Stáhnout originál' })).not.toBeInTheDocument()
  })

  it('copies a section as plain text', async () => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const { user } = await openHandover()
    const section = screen.getByRole('region', { name: /^Nacionále pacienta/ })
    await user.click(within(section).getByRole('button', { name: 'Kopírovat sekci' }))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Jméno: Alena [Nalezeno; AI návrh]'))
    expect(await within(section).findByText('Sekce byla zkopírována.')).toBeVisible()
  })
})