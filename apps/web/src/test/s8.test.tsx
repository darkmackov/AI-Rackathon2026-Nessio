import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from '../client/types.gen'
import { s8Case, s8Texts } from '../mocks/s8-data'
import { field, openCoordinatorCase, openReferenceCase, openTab } from './shell'
import { demoState, server } from './setup'

const quote = 'Tumor hlavy pankreatu 35 mm s venózním postižením VMS se zúžením lumen a s kontaktem s AMS.'
function done(found = true): Job {
  return {
    id: 'test-s8-question', case_id: 'vzp-prochazkova', kind: 'ask_case', status: 'done', created_at: '2026-10-21T09:00:00', params: { question: 'Jaký byl nález na CT?' },
    answer: { question: 'Jaký byl nález na CT?', found, quotes: found ? [{ document_id: '08', quote }] : [] }
  }
}
function serveAnswer(value: Job) {
  const post = vi.fn()
  server.use(http.post('*/api/cases/:id/ask', async ({ request }) => { post(await request.json()); return HttpResponse.json<Job>(value, { status: 202 }) }),
    http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(value)))
  return post
}
function openS8(options: { notifications?: boolean } = {}) {
  return openCoordinatorCase(s8Case.id, s8Case.patient_name, options)
}

describe('S8 questions in the case header', () => {
  it('keeps polling after the result is closed and does not submit a second question while busy', async () => {
    let completed = false
    const post = vi.fn()
    server.use(http.post('*/api/cases/:id/ask', () => { post(); return HttpResponse.json<Job>({ ...done(), status: 'queued', answer: null }, { status: 202 }) }),
      http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(completed ? done() : { ...done(), status: 'running', answer: null })))
    const { user } = await openReferenceCase()
    const input = screen.getByRole('textbox', { name: 'Vyhledat v případu' })
    await user.type(input, 'Jaký byl nález na CT?{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Zavřít výsledek' }))
    await user.keyboard('{Enter}')
    expect(post).toHaveBeenCalledTimes(1)
    completed = true
    await waitFor(() => expect(screen.getByRole('button', { name: 'Odeslat otázku' })).toBeEnabled())
    await user.click(input)
    expect(await screen.findByText(quote)).toBeVisible()
  })

  it('shows failed jobs and permits an explicit retry', async () => {
    const value: Job = { ...done(), status: 'failed', answer: null, error: 'Fiktivní chyba zpracování' }
    serveAnswer(value)
    const { user } = await openReferenceCase({ notifications: true })
    await user.type(screen.getByRole('textbox', { name: 'Vyhledat v případu' }), 'Jaký byl nález na CT?{Enter}')
    const result = await screen.findByRole('dialog', { name: 'Výsledek dotazu' })
    expect(await screen.findByText('Dotaz nad podklady se nepodařilo zpracovat. Zkuste jej odeslat znovu.')).toBeVisible()
    expect(within(result).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Fiktivní chyba zpracování')).not.toBeInTheDocument()
    const post = serveAnswer(done())
    await user.click(screen.getByRole('button', { name: 'Zopakovat dotaz' }))
    expect(await screen.findByText(quote)).toBeVisible()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('shows a polling error with retry, a malformed result and an unavailable source without inventing content', async () => {
    serveAnswer({ ...done(), status: 'queued', answer: null })
    server.use(http.get('*/api/jobs/:id', () => HttpResponse.json({ detail: 'unavailable' }, { status: 503 })))
    const { user } = await openReferenceCase({ notifications: true })
    await user.type(screen.getByRole('textbox', { name: 'Vyhledat v případu' }), 'Jaký byl nález na CT?{Enter}')
    expect(await screen.findByRole('alert')).toBeVisible()
    server.use(http.get('*/api/jobs/:id', () => HttpResponse.json<Job>({ ...done(), answer: null })))
    await user.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findByText('Výsledek neobsahuje ověřené citace. Zkuste dotaz znovu.')).toBeVisible()
    expect(within(screen.getByRole('dialog', { name: 'Výsledek dotazu' })).queryByRole('alert')).not.toBeInTheDocument()
    serveAnswer({ ...done(), answer: { question: 'Jaký byl nález na CT?', found: true, quotes: [{ document_id: 'unrelated', quote: 'Nedostupný zdroj' }] } })
    await user.click(screen.getByRole('button', { name: 'Zopakovat dotaz' }))
    await user.click(await screen.findByRole('button', { name: /^Otevřít zdroj:/ }))
    expect(await screen.findByText('Zdrojový dokument není mezi podklady tohoto případu.')).toBeVisible()
  })
})

describe('S8 code suggestions and unverified quotes', () => {
  it('does not offer code suggestions when the existing diagnosis already has a code', async () => {
    const { user } = await openReferenceCase()
    const panel = await openTab(user, 'Předávka')
    await user.click(within(panel).getByRole('button', { name: 'Rozbalit vše' }))
    expect(within(field('MKN-10')).queryByRole('button', { name: 'Navrhnout kód' })).not.toBeInTheDocument()
  })

  it('shows empty candidates and a stale pick without writing a different code', async () => {
    server.use(http.get('*/api/cases/:id/handover/code-candidates', () => HttpResponse.json([])))
    const { user } = await openS8({ notifications: true })
    await openTab(user, 'Předávka')
    await user.click(within(field('MKN-10')).getByRole('button', { name: 'Navrhnout kód' }))
    expect(await screen.findByText('Pro tuto diagnózu nebyly nalezeny návrhy kódu.')).toBeVisible()
    server.use(http.get('*/api/cases/:id/handover/code-candidates', () => HttpResponse.json([{ code: 'C20', title_cs: 'Zhoubný novotvar konečníku' }])),
      http.post('*/api/cases/:id/handover/diagnosis-code', () => HttpResponse.json({ detail: 'stale' }, { status: 400 })))
    await user.click(within(field('MKN-10')).getByRole('button', { name: 'Navrhnout kód' }))
    await user.click(await screen.findByRole('button', { name: 'Použít kód C20' }))
    expect(await screen.findByText('Návrhy již nemusí být aktuální. Obnovte údaje a zkuste to znovu.')).toBeVisible()
    expect(within(field('MKN-10')).queryByText('Návrhy již nemusí být aktuální. Obnovte údaje a zkuste to znovu.')).not.toBeInTheDocument()
    expect(within(field('MKN-10')).getByRole('button', { name: 'Obnovit údaje' })).toBeEnabled()
    expect(demoState.documents.result('demo-s8')?.handover.diagnosis_code?.value).toBeNull()
  })

  it('labels nearest-source evidence as unverified and retains the normal source viewer', async () => {
    const { user } = await openS8()
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
