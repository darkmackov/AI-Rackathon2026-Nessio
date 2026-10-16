import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Handover } from '../client/types.gen'
import { getDemoClockQueryKey } from '../client/@tanstack/react-query.gen'
import { isCaseQuery } from '../case-queries'
import { referenceCases } from '../mocks/reference'
import { referenceFindings, referenceHandover } from '../mocks/reference-data'
import { renderApp } from './renderApp'
import { demoState, server } from './setup'

beforeEach(() => {
  // Reset the viewport fixture: spying on an existing vi.fn retains its implementation.
  vi.mocked(window.matchMedia).mockImplementation((media) => ({
    matches: false, media, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

async function coordinator(user: ReturnType<typeof userEvent.setup>, id = 'koordinator') {
  await user.selectOptions(await screen.findByLabelText('Role'), 'coordinator')
  await screen.findByRole('option', { name: 'Bc. Lucie Dvořáková' })
  await user.selectOptions(screen.getByLabelText('Osoba'), id)
  await user.click(screen.getByRole('button', { name: 'Pokračovat' }))
  await screen.findByRole('heading', { level: 1, name: 'Pracovní fronta koordinátora' })
}

async function detail(user: ReturnType<typeof userEvent.setup>) {
  await coordinator(user)
  await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
  await screen.findByRole('heading', { level: 1, name: 'Alena Procházková' })
  await screen.findByRole('heading', { name: 'Stav případu' })
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('tab', { name }))
}

async function findings(user: ReturnType<typeof userEvent.setup>) {
  await openTab(user, /^Nálezy/)
  await screen.findByRole('heading', { name: 'Chybějící údaje a rozpory' })
}

async function fullHandover(user: ReturnType<typeof userEvent.setup>) {
  await openTab(user, /^Handover/)
  await user.click(await screen.findByRole('button', { name: 'Rozbalit vše' }))
}

describe('S1 read-only coordinator UI', () => {
  it('keeps a loaded case visible when directory name resolution fails', async () => {
    server.use(http.get('*/api/directory/organizations', () => HttpResponse.json({ detail: 'unavailable' }, { status: 500 })))
    renderApp()
    const user = userEvent.setup()
    await coordinator(user)
    expect(await screen.findByRole('link', { name: 'Alena Procházková' })).toBeVisible()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
  })

  it('closes a desktop source on Escape and removes it when the reference is reset', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
      matches: media.includes('75em'), media, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
    const { router } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    await findings(user)
    const finding = document.getElementById('finding-F01')
    if (!finding) throw new Error('Expected finding')
    const button = within(finding).getByRole('button', { name: /Zdroj 1/ })
    await user.click(button)
    const source = await screen.findByRole('complementary', { name: 'Zdrojový dokument' })
    await within(source).findByTestId('document-text')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'Zdrojový dokument' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    await user.click(button)
    await screen.findByRole('complementary', { name: 'Zdrojový dokument' })
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const panel = await screen.findByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(panel).getByRole('button', { name: 'Obnovit referenci' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Obnovit data' }))
    await screen.findByText('Demo bylo obnoveno.')
    await user.click(within(panel).getByRole('button', { name: 'Zavřít' }))
    expect(router.state.location.pathname).toBe('/coordinator')
    expect(screen.queryByRole('complementary', { name: 'Zdrojový dokument' })).not.toBeInTheDocument()
    expect(await screen.findByText('67 dní')).toBeVisible()
  })

  it('renders independent empty handover, finding, document and task states', async () => {
    server.use(
      http.get('*/api/cases/:id/handover', () => HttpResponse.json({ detail: 'no handover yet' }, { status: 404 })),
      ...['findings', 'documents', 'tasks'].map((part) => http.get(`*/api/cases/:id/${part}`, () => HttpResponse.json([]))),
    )
    renderApp()
    const user = userEvent.setup()
    await coordinator(user)
    await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
    expect(await screen.findByText('Handover zatím není dostupný.')).toBeVisible()
    await openTab(user, /^Nálezy/)
    expect(await screen.findByText('Nejsou zaznamenány žádné nedostatky ani rozpory.')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Dokumenty' }))
    expect(await screen.findByText('Případ zatím neobsahuje žádné dokumenty.')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Úkoly / cesta' }))
    expect(await screen.findByText('Případ zatím nemá žádné úkoly.')).toBeVisible()
  })

  it('offers a way back for an unknown case URL', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await coordinator(user)
    await act(async () => { await router.navigate({ to: '/coordinator/cases/$caseId', params: { caseId: 'unknown' }, search: { tab: 'documents' } }) })
    expect(await screen.findByRole('heading', { name: 'Případ není pro vaše KOC k dispozici.' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Zpět na pracovní frontu/ })).toHaveAttribute('href', '/coordinator')
  })

  it('opens an unavailable-source state instead of requesting an unrelated document', async () => {
    server.use(http.get('*/api/cases/:id/handover', () => HttpResponse.json({ ...referenceHandover, other: { value: 'Údaj', status: 'found', origin: 'ai', evidence: [{ document_id: 'unrelated', quote: 'Údaj' }] } } satisfies Handover)))
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await fullHandover(user)
    const field = document.getElementById('field-other')
    if (!field) throw new Error('Expected other field')
    await user.click(within(field).getByRole('button', { name: /Zdroj 1/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(within(source).getByText('Zdrojový dokument není mezi podklady tohoto případu.')).toBeVisible()
    expect(within(source).queryByRole('button', { name: 'Stáhnout originál' })).not.toBeInTheDocument()
  })

  it('refreshes running intervals when the demo date changes', async () => {
    const { queryClient } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    expect(await screen.findByText('19 dní')).toBeVisible()
    await act(async () => {
      demoState.setTime('2026-10-22T00:00:00')
      await queryClient.invalidateQueries({ queryKey: getDemoClockQueryKey() })
    })
    expect(await screen.findByText('20 dní')).toBeVisible()
    expect(screen.getByText('68 dní')).toBeVisible()
  })

  it('retries an original download and revokes its URL when leaving the document', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-original')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })
    server.use(http.get('*/api/documents/:id/file', () => HttpResponse.json({ detail: 'failed' }, { status: 500 })))
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await user.click(screen.getByRole('tab', { name: 'Dokumenty' }))
    const first = (await screen.findAllByRole('button', { name: 'Stáhnout originál' }))[0]
    await user.click(first)
    expect(await screen.findByText('Originální soubor se nepodařilo stáhnout.')).toBeVisible()
    expect(create).not.toHaveBeenCalled()
    server.resetHandlers()
    await user.click(first)
    expect(await screen.findByText('Originální soubor byl připraven ke stažení.')).toBeVisible()
    expect(create).toHaveBeenCalledWith(expect.any(Blob))
    expect(clicked).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('tab', { name: 'Úkoly / cesta' }))
    expect(revoke).toHaveBeenCalledWith('blob:test-original')
  })

  it('keeps full source text readable when a supplied quote is absent', async () => {
    server.use(http.get('*/api/documents/:id/text', () => HttpResponse.json({ id: '07', text: '<script>unsafe()</script> Jiný úplný text.' })))
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await findings(user)
    const finding = document.getElementById('finding-F01')
    if (!finding) throw new Error('Expected finding')
    await user.click(within(finding).getByRole('button', { name: /Zdroj 1/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(await within(source).findByText('Citaci se nepodařilo v textu nalézt.')).toBeVisible()
    const text = within(source).getByTestId('document-text')
    expect(text).toHaveTextContent('<script>unsafe()</script> Jiný úplný text.')
    expect(text.querySelector('script')).toBeNull()
    expect(text.querySelector('mark')).toBeNull()
  })

  it('opens the detail from the kanban, shows running times and keeps work actions disabled', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    expect(router.state.location.pathname).toBe('/coordinator/cases/vzp-prochazkova')
    expect(await screen.findByText('67 dní')).toBeVisible()
    expect(screen.getByText('48 dní')).toBeVisible()
    expect(screen.getByText('19 dní')).toBeVisible()
    expect(screen.getAllByText('dosud · probíhá')).toHaveLength(2)
    for (const name of ['Převzít', 'Vrátit lékaři', 'Odložit']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getAllByText('Zatím nepotvrzeno')).toHaveLength(2)
    await findings(user)
    expect(screen.getByText('Poradní upozornění')).toBeVisible()
    await openTab(user, /^Handover/)
    expect((await screen.findAllByRole('button', { name: 'Doplnit' })).every((button) => button.hasAttribute('disabled'))).toBe(true)
    await user.click(screen.getByRole('link', { name: /Zpět na pracovní frontu/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Pracovní fronta koordinátora' })).toBeVisible()
  })

  it('opens a finding source with the exact quote highlighted and returns focus on Escape', async () => {
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await findings(user)
    const finding = document.getElementById('finding-F01')
    if (!finding) throw new Error('Expected finding')
    const button = within(finding).getByRole('button', { name: /Zdroj 1/ })
    await user.click(button)
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    const text = await within(source).findByTestId('document-text')
    expect(text.querySelector('mark')?.textContent).toBe('Soběstačná, v práci t. č. v pracovní neschopnosti.')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zdrojový dokument' })).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('lists eleven documents, marks only the actual GP upload and opens full text', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    await user.click(screen.getByRole('tab', { name: 'Dokumenty' }))
    expect(router.state.location.search).toMatchObject({ tab: 'documents' })
    expect(await screen.findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(11)
    expect(screen.getAllByText('Předal odesílající lékař')).toHaveLength(1)
    await user.click(screen.getAllByRole('button', { name: 'Zobrazit text' })[0])
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(await within(source).findByTestId('document-text')).toHaveTextContent('Kardiologie')
  })

  it('shows task dependencies and never marks finished tasks overdue', async () => {
    demoState.setTime('2026-10-28T09:00:00')
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await user.click(screen.getByRole('tab', { name: 'Úkoly / cesta' }))
    const rows = (await screen.findAllByRole('row')).filter((row) => row.id.startsWith('task-'))
    expect(rows).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Spustit sadu úkolů' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Přidat úkol' })).toBeDisabled()
    expect(rows.filter((row) => within(row).queryByText('Dokončeno')).every((row) => !within(row).queryByText(/Po termínu/))).toBe(true)
    expect(rows.filter((row) => within(row).queryByText(/Po termínu/))).toHaveLength(3)
    expect(screen.getAllByRole('link', { name: /CT břicha a hrudníku.*Dokončeno/ }).length).toBeGreaterThan(0)
  })

  it('shows all conflict evidence and manual provenance without inferring confirmation', async () => {
    const conflict: Handover = {
      ...referenceHandover,
      weight_kg: { value: 65, status: 'conflict', origin: 'ai', evidence: [{ document_id: '04', quote: '65 kg' }, { document_id: '07', quote: '62 kg' }], note: 'Hmotnosti se liší.' },
      other: { value: 'Přání pacientky', status: 'found', origin: 'manual', entered: { by: 'koordinator', at: '2026-10-20T10:00:00' } },
    }
    server.use(http.get('*/api/cases/:id/handover', () => HttpResponse.json(conflict)))
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    expect(screen.getAllByText('Zatím nepotvrzeno')).toHaveLength(2)
    await fullHandover(user)
    const field = document.getElementById('field-weight_kg')
    if (!field) throw new Error('Expected weight field')
    expect(within(field).getByText('Rozpor')).toBeVisible()
    expect(within(field).getByText('65 kg')).toBeVisible()
    expect(within(field).getByText('62 kg')).toBeVisible()
    const other = document.getElementById('field-other')
    if (!other) throw new Error('Expected other field')
    expect(within(other).getByText(/Ruční zadání/)).toBeVisible()
    expect(within(other).getByText(/Bc. Lucie Dvořáková/)).toBeVisible()
  })

  it('does not fetch child data for a case belonging to another KOC', async () => {
    const childRequests: string[] = []
    const listener = ({ request }: { request: Request }) => { if (/\/cases\/[^/]+\/(handover|findings|documents|tasks)/.test(request.url)) childRequests.push(request.url) }
    server.events.on('request:start', listener)
    server.use(http.get('*/api/cases/:id', () => HttpResponse.json({ ...referenceCases[0], koc_id: 'koc1-severni' })))
    renderApp()
    const user = userEvent.setup()
    try {
      await coordinator(user)
      await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
      expect(await screen.findByRole('heading', { name: 'Případ není pro vaše KOC k dispozici.' })).toBeVisible()
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
      expect(childRequests).toEqual([])
    } finally { server.events.removeListener('request:start', listener) }
  })

  it('opens on the overview and counts unresolved findings on the findings tab', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    expect(router.state.location.search).toMatchObject({ tab: 'overview' })
    expect(screen.getByRole('tab', { name: /^Přehled/ })).toHaveAttribute('aria-selected', 'true')
    const unresolved = referenceFindings.filter((finding) => !finding.resolved).length
    expect(screen.getByRole('tab', { name: new RegExp(`^Nálezy\\s*${unresolved}$`) })).toBeVisible()
  })

  it('opens only handover sections with gaps or conflicts until the user expands them', async () => {
    const handover: Handover = {
      ...referenceHandover,
      weight_kg: { value: 65, status: 'conflict', origin: 'ai', evidence: [{ document_id: '04', quote: '65 kg' }] },
      other: { value: 'Přání pacientky', status: 'found', origin: 'manual', entered: { by: 'koordinator', at: '2026-10-20T10:00:00' } },
    }
    server.use(http.get('*/api/cases/:id/handover', () => HttpResponse.json(handover)))
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await openTab(user, /^Handover/)
    const history = await screen.findByRole('button', { name: /^Anamnézy a stav/ })
    const other = screen.getByRole('button', { name: /^Další sdělení/ })
    expect(history).toHaveAttribute('aria-expanded', 'true')
    expect(history).toHaveTextContent(/k řešení/)
    expect(other).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Rozbalit vše' }))
    expect(other).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Sbalit vše' }))
    expect(history).toHaveAttribute('aria-expanded', 'false')
  })

  it('jumps from a finding to its handover field and opens the field section', async () => {
    const { router } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    await findings(user)
    const finding = document.getElementById('finding-F01')
    if (!finding) throw new Error('Expected finding')
    await user.click(within(finding).getByRole('link', { name: /Stav výkonnosti/ }))
    expect(router.state.location.search).toMatchObject({ tab: 'handover' })
    expect(await screen.findByRole('button', { name: /^Anamnézy a stav/ })).toHaveAttribute('aria-expanded', 'true')
    const field = document.getElementById('field-performance_status')
    if (!field) throw new Error('Expected performance field')
    expect(within(field).getByText('Stav výkonnosti')).toBeVisible()
  })

  it('isolates a failed documents section and retries it without losing the case', async () => {
    server.use(http.get('*/api/cases/:id/documents', () => HttpResponse.json({ detail: 'failed' }, { status: 500 })))
    renderApp()
    const user = userEvent.setup()
    await detail(user)
    await user.click(screen.getByRole('tab', { name: 'Dokumenty' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Alena Procházková' })).toBeVisible()
    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(11)
  })

  it('translates the detail while retaining Czech clinical data and copies section values', async () => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderApp()
    await detail(user)
    await fullHandover(user)
    const section = screen.getByRole('region', { name: /^Nacionále pacienta/ })
    await user.click(within(section).getByRole('button', { name: 'Kopírovat sekci' }))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Jméno: Alena [Nalezeno; AI návrh]'))
    await user.selectOptions(screen.getByLabelText('Jazyk'), 'en')
    expect(await screen.findByRole('heading', { name: /^Patient details/ })).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Alena Procházková' })).toBeVisible()
    expect(screen.getByText('C25.0 Duktální adenokarcinom hlavy pankreatu')).toBeVisible()
    await openTab(user, /^Overview/)
    expect(screen.getByRole('button', { name: 'Take over' })).toBeDisabled()
  })

  it('clears detail data on reset and keeps the selected person and language', async () => {
    const { router, queryClient } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    await user.selectOptions(screen.getByLabelText('Jazyk'), 'en')
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
    expect(screen.getByText('Bc. Lucie Dvořáková')).toBeVisible()
  })

  it('aborts source loading and removes all previous case data on identity change', async () => {
    let finish: (() => void) | undefined
    let started: (() => void) | undefined
    const held = new Promise<void>((resolve) => { finish = resolve })
    const requested = new Promise<void>((resolve) => { started = resolve })
    server.use(http.get('*/api/documents/:id/text', async () => { started?.(); await held; return HttpResponse.json({ id: '07', text: 'OLD PATIENT TEXT' }) }))
    const { queryClient } = renderApp()
    const user = userEvent.setup()
    await detail(user)
    await findings(user)
    const finding = document.getElementById('finding-F01')
    if (!finding) throw new Error('Expected finding')
    await user.click(within(finding).getByRole('button', { name: /Zdroj 1/ }))
    await requested
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zdrojový dokument' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Změnit osobu' }))
    await coordinator(user, 'koord-severni')
    await act(async () => { finish?.() })
    expect(await screen.findByText('Vaše KOC zatím nemá žádné případy.')).toBeVisible()
    expect(screen.queryByText('OLD PATIENT TEXT')).not.toBeInTheDocument()
    expect(queryClient.getQueryCache().findAll({ predicate: isCaseQuery })).toEqual([])
  })
})
