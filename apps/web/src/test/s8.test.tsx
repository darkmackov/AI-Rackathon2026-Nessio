import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from '../client/types.gen'
import { s8Case, s8Texts } from '../mocks/s8-data'
import { renderApp } from './renderApp'
import { changeIdentity, field, openReferenceCase, openTab, setLanguage, signIn, wideScreen, type User } from './shell'
import { demoState, server } from './setup'

const quote = 'Tumor hlavy pankreatu 35 mm s venózním postižením VMS se zúžením lumen a s kontaktem s AMS.'
function done(found = true): Job {
  return { id: 'test-s8-question', case_id: 'vzp-prochazkova', kind: 'ask_case', status: 'done', created_at: '2026-10-21T09:00:00', params: { question: 'Jaký byl nález na CT?' },
    answer: { question: 'Jaký byl nález na CT?', found, quotes: found ? [{ document_id: '08', quote }] : [] } }
}
function serveAnswer(value: Job) {
  const post = vi.fn()
  server.use(http.post('*/api/cases/:id/ask', async ({ request }) => { post(await request.json()); return HttpResponse.json<Job>(value, { status: 202 }) }),
    http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(value)))
  return post
}
async function openS8(user: User) {
  await signIn(user)
  await user.click(await screen.findByRole('link', { name: s8Case.patient_name }))
  await screen.findByRole('heading', { level: 1, name: s8Case.patient_name })
}

describe('S8 questions in the case header', () => {
  it('submits only on Enter, polls to completion and opens exact evidence in a drawer even on desktop', async () => {
    wideScreen()
    let reads = 0
    const post = vi.fn()
    server.use(http.post('*/api/cases/:id/ask', async ({ request }) => { post(await request.json()); return HttpResponse.json<Job>({ ...done(), status: 'queued', answer: null }, { status: 202 }) }),
      http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(++reads < 2 ? { ...done(), status: 'running', answer: null } : done())))
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const input = screen.getByRole('textbox', { name: 'Vyhledat v případu' })
    await user.click(screen.getByRole('button', { name: 'Odeslat otázku' }))
    expect(await screen.findByText('Zadejte otázku.')).toBeVisible()
    expect(post).not.toHaveBeenCalled()
    await user.type(input, 'Jaký byl nález na CT?')
    expect(post).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Výsledek dotazu' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Odeslat otázku' })).toBeDisabled()
    expect(await screen.findByText(quote, {}, { timeout: 5000 })).toBeVisible()
    expect(post).toHaveBeenCalledExactlyOnceWith({ question: 'Jaký byl nález na CT?' })
    const completedReads = reads
    await user.click(screen.getByRole('button', { name: /^Otevřít zdroj:/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    const text = await within(source).findByTestId('document-text')
    expect(text.querySelector('mark')?.textContent).toBe(quote)
    expect(screen.queryByRole('dialog', { name: 'Výsledek dotazu' })).not.toBeInTheDocument()
    await user.click(within(source).getByRole('button', { name: 'Zavřít zdroj' }))
    await waitFor(() => expect(input).toHaveFocus())
    await user.click(input)
    expect(await screen.findByText(quote)).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Výsledek dotazu' })).not.toBeInTheDocument()
    expect(reads).toBe(completedReads)
  })

  it('keeps polling after the result is closed and does not submit a second question while busy', async () => {
    let completed = false
    const post = vi.fn()
    server.use(http.post('*/api/cases/:id/ask', () => { post(); return HttpResponse.json<Job>({ ...done(), status: 'queued', answer: null }, { status: 202 }) }),
      http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(completed ? done() : { ...done(), status: 'running', answer: null })))
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const input = screen.getByRole('textbox', { name: 'Vyhledat v případu' })
    await user.type(input, 'Jaký byl nález na CT?{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Zavřít výsledek' }))
    await user.keyboard('{Enter}')
    expect(post).toHaveBeenCalledTimes(1)
    completed = true
    await waitFor(() => expect(screen.getByRole('button', { name: 'Odeslat otázku' })).toBeEnabled(), { timeout: 5000 })
    await user.click(input)
    expect(await screen.findByText(quote)).toBeVisible()
  })

  it('shows not found, preserves the draft across language and tab changes, and clears it on another patient', async () => {
    serveAnswer(done(false))
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const input = screen.getByRole('textbox', { name: 'Vyhledat v případu' })
    await user.type(input, 'Jaký byl nález na CT?')
    await user.click(screen.getByRole('button', { name: 'Odeslat otázku' }))
    expect(await screen.findByText('V dostupných podkladech nebyla odpověď nalezena.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Zavřít výsledek' }))
    await openTab(user, 'Dokumenty')
    expect(input).toHaveValue('Jaký byl nález na CT?')
    await setLanguage(user, 'English')
    expect(screen.getByRole('textbox', { name: 'Search within the case' })).toHaveValue('Jaký byl nález na CT?')
    await user.click(screen.getByRole('link', { name: 'Back to work queue' }))
    await user.click(await screen.findByRole('link', { name: s8Case.patient_name }))
    expect(await screen.findByRole('textbox', { name: 'Search within the case' })).toHaveValue('')
    expect(screen.queryByRole('dialog', { name: 'Question result' })).not.toBeInTheDocument()
    await changeIdentity(user)
    expect(screen.queryByRole('textbox', { name: 'Search within the case' })).not.toBeInTheDocument()
  })

  it('shows failed jobs and permits an explicit retry', async () => {
    const value: Job = { ...done(), status: 'failed', answer: null, error: 'Fiktivní chyba zpracování' }
    serveAnswer(value)
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await user.type(screen.getByRole('textbox', { name: 'Vyhledat v případu' }), 'Jaký byl nález na CT?{Enter}')
    expect(await screen.findByText('Fiktivní chyba zpracování')).toBeVisible()
    const post = serveAnswer(done())
    await user.click(screen.getByRole('button', { name: 'Zopakovat dotaz' }))
    expect(await screen.findByText(quote)).toBeVisible()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('shows a polling error with retry, a malformed result and an unavailable source without inventing content', async () => {
    serveAnswer({ ...done(), status: 'queued', answer: null })
    server.use(http.get('*/api/jobs/:id', () => HttpResponse.json({ detail: 'unavailable' }, { status: 503 })))
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    await user.type(screen.getByRole('textbox', { name: 'Vyhledat v případu' }), 'Jaký byl nález na CT?{Enter}')
    expect(await screen.findByRole('alert')).toBeVisible()
    server.use(http.get('*/api/jobs/:id', () => HttpResponse.json<Job>({ ...done(), answer: null })))
    await user.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findByText('Výsledek neobsahuje ověřené citace. Zkuste dotaz znovu.')).toBeVisible()
    serveAnswer({ ...done(), answer: { question: 'Jaký byl nález na CT?', found: true, quotes: [{ document_id: 'unrelated', quote: 'Nedostupný zdroj' }] } })
    await user.click(screen.getByRole('button', { name: 'Zopakovat dotaz' }))
    await user.click(await screen.findByRole('button', { name: /^Otevřít zdroj:/ }))
    expect(await screen.findByText('Zdrojový dokument není mezi podklady tohoto případu.')).toBeVisible()
  })
})

describe('S8 code suggestions and unverified quotes', () => {
  it('loads candidates only on request, saves a human pick and retains open findings', async () => {
    const read = vi.fn()
    server.events.on('request:start', ({ request }) => { if (request.url.endsWith('/code-candidates')) read() })
    renderApp()
    const user = userEvent.setup()
    await openS8(user)
    await openTab(user, 'Předávka')
    const code = field('MKN-10')
    expect(read).not.toHaveBeenCalled()
    expect(within(code).getByText('Chybí')).toBeVisible()
    await user.click(within(code).getByRole('button', { name: 'Navrhnout kód' }))
    const pick = await within(code).findByRole('button', { name: 'Použít kód C20' })
    expect(within(code).getByText('Zhoubný novotvar konečníku')).toBeVisible()
    expect(demoState.documents.result('demo-s8')?.handover.diagnosis_code?.value).toBeNull()
    await user.click(pick)
    expect(await within(code).findByText('Kód byl uložen jako ruční zadání.')).toBeVisible()
    expect(await within(code).findByText('Ruční zadání')).toBeVisible()
    expect(within(code).getByText('C20')).toBeVisible()
    expect(within(code).queryByRole('button', { name: 'Navrhnout kód' })).not.toBeInTheDocument()
    expect(demoState.documents.result('demo-s8')?.findings.every((finding) => !finding.resolved)).toBe(true)
    await openTab(user, 'Audit')
    expect(await screen.findByText(/Kód MKN-10 C20/)).toBeVisible()
    server.events.removeAllListeners('request:start')
  })

  it('does not offer code suggestions when the existing diagnosis already has a code', async () => {
    renderApp()
    const user = userEvent.setup()
    await openReferenceCase(user)
    const panel = await openTab(user, 'Předávka')
    await user.click(within(panel).getByRole('button', { name: 'Rozbalit vše' }))
    expect(within(field('MKN-10')).queryByRole('button', { name: 'Navrhnout kód' })).not.toBeInTheDocument()
  })

  it('shows empty candidates and a stale pick without writing a different code', async () => {
    server.use(http.get('*/api/cases/:id/handover/code-candidates', () => HttpResponse.json([])))
    renderApp()
    const user = userEvent.setup()
    await openS8(user)
    await openTab(user, 'Předávka')
    await user.click(within(field('MKN-10')).getByRole('button', { name: 'Navrhnout kód' }))
    expect(await screen.findByText('Pro tuto diagnózu nebyly nalezeny návrhy kódu.')).toBeVisible()
    server.use(http.get('*/api/cases/:id/handover/code-candidates', () => HttpResponse.json([{ code: 'C20', title_cs: 'Zhoubný novotvar konečníku' }])),
      http.post('*/api/cases/:id/handover/diagnosis-code', () => HttpResponse.json({ detail: 'stale' }, { status: 400 })))
    await user.click(within(field('MKN-10')).getByRole('button', { name: 'Navrhnout kód' }))
    await user.click(await screen.findByRole('button', { name: 'Použít kód C20' }))
    expect(await screen.findByText('Návrhy již nemusí být aktuální. Obnovte údaje a zkuste to znovu.')).toBeVisible()
    expect(demoState.documents.result('demo-s8')?.handover.diagnosis_code?.value).toBeNull()
  })

  it('labels nearest-source evidence as unverified and retains the normal source viewer', async () => {
    renderApp()
    const user = userEvent.setup()
    await openS8(user)
    const panel = await openTab(user, /^K řešení/)
    const finding = within(panel).getByRole('article', { name: 'Ukázka S8: původní AI citaci nebylo možné ověřit.' })
    expect(within(finding).getByText('Neověřená citace')).toBeVisible()
    expect(within(finding).getByText(/pouze nejbližší nalezený úryvek/)).toBeVisible()
    await user.click(within(finding).getByRole('button', { name: /^Zdroj 1:/ }))
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    expect(await within(source).findByTestId('document-text')).toHaveTextContent('Adenokarcinom rekta')
    expect(s8Texts['demo-s8-histology']).toContain(within(source).getByTestId('document-text').querySelector('mark')?.textContent)
  })
})
