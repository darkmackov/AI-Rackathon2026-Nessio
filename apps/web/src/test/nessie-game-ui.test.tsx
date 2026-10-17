import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropsWithChildren } from 'react'
import { createQueryClient } from '../api'
import type { Job } from '../client/types.gen'
import NessieGame, { BEST_SCORE_KEY } from '../components/nessie-game/NessieGame'
import DocumentJobs from '../components/documents/DocumentJobs'
import { i18n } from '../i18n'
import { theme } from '../theme'
import { server } from './setup'

const caseId = 'case-game'
const actorId = 'koordinator'
const job = (status: Job['status'], kind: Job['kind'] = 'ingest_document'): Job => ({ id: `job-${kind}`, kind, case_id: caseId, status, created_at: '2026-10-16T09:00:00' })

function wrapper() {
  const client = createQueryClient()
  return { client, Wrapper: ({ children }: PropsWithChildren) => <MantineProvider theme={theme} env="test"><I18nextProvider i18n={i18n}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </I18nextProvider></MantineProvider> }
}

beforeEach(() => localStorage.clear())

describe('Nessie game in the document job list', () => {
  let jobs: Job[] = []
  beforeEach(() => {
    jobs = []
    server.use(
      http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json(jobs)),
      http.get('*/api/jobs/:jobId', ({ params }) => HttpResponse.json(jobs.find((item) => item.id === params.jobId))),
    )
  })

  it('is offered inline only while documents are being processed', async () => {
    jobs = [job('done'), job('running', 'draft')]
    const { client, Wrapper } = wrapper()
    render(<DocumentJobs caseId={caseId} actorId={actorId} documents={[]} />, { wrapper: Wrapper })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByRole('button', { name: 'Zahrát si s Nessie, než AI skončí' })).not.toBeInTheDocument()
    jobs = [job('running')]
    await act(() => client.invalidateQueries())
    expect(await screen.findByRole('button', { name: 'Zahrát si s Nessie, než AI skončí' })).toBeVisible()
  })

  it('opens the game in a dialog, keeps it open when processing ends and offers the way back', async () => {
    jobs = [job('running')]
    const { client, Wrapper } = wrapper()
    render(<DocumentJobs caseId={caseId} actorId={actorId} documents={[]} />, { wrapper: Wrapper })
    await userEvent.click(await screen.findByRole('button', { name: 'Zahrát si s Nessie, než AI skončí' }))
    const dialog = screen.getByRole('dialog', { name: 'Nessie loví ryby' })
    expect(within(dialog).getByText('AI zpracovává 1 dokument…')).toBeVisible()
    expect(within(dialog).getByRole('group', { name: 'Herní plocha' })).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Zpět k práci' })).not.toBeInTheDocument()

    jobs = [job('done')]
    await act(() => client.invalidateQueries())
    expect(await within(dialog).findByText('Zpracování dokumentů je dokončeno.')).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Nessie loví ryby' })).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zpět k práci' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Zahrát si s Nessie, než AI skončí' })).not.toBeInTheDocument()
  })

  it('says when processing failed', async () => {
    jobs = [job('running')]
    const { client, Wrapper } = wrapper()
    render(<DocumentJobs caseId={caseId} actorId={actorId} documents={[]} />, { wrapper: Wrapper })
    await userEvent.click(await screen.findByRole('button', { name: 'Zahrát si s Nessie, než AI skončí' }))
    jobs = [job('failed')]
    await act(() => client.invalidateQueries())
    expect(await screen.findByText('Některé dokumenty se nepodařilo zpracovat.')).toBeVisible()
  })
})

describe('Nessie game', () => {
  // Nessie starts at (5,6) heading right on the 16×12 lake; this puts the first fish right in front of her.
  const fishAhead = (99 + 0.5) / (16 * 12 - 3)
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(fishAhead)
  })
  afterEach(() => vi.useRealTimers())

  const step = (count = 1) => act(() => { vi.advanceTimersByTime(160 * count) })

  it('starts with an arrow key, catches a fish, remembers the best score and pauses with Space', () => {
    render(<NessieGame />, { wrapper: wrapper().Wrapper })
    const board = screen.getByRole('group', { name: 'Herní plocha' })
    expect(screen.getByText('Začněte tlačítkem Začít hrát nebo šipkou.')).toBeInTheDocument()
    fireEvent.keyDown(board, { key: 'ArrowRight' })
    expect(screen.queryByText('Začněte tlačítkem Začít hrát nebo šipkou.')).not.toBeInTheDocument()
    step()
    expect(screen.getByRole('status')).toHaveTextContent('Chycena 1 ryba')
    expect(screen.getByRole('img')).toHaveAccessibleName('Jezero s Nessie: 1 chycených ryb, délka 4')
    step()
    expect(localStorage.getItem(BEST_SCORE_KEY)).toBe('1')

    board.focus()
    fireEvent.keyDown(board, { key: ' ' })
    expect(screen.getByText('Pozastaveno')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pokračovat' })).toBeInTheDocument()
  })

  it('steers with the on-screen arrows and pauses when focus leaves the game', () => {
    render(<><NessieGame /><button type="button">outside</button></>, { wrapper: wrapper().Wrapper })
    const board = screen.getByRole('group', { name: 'Herní plocha' })
    board.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Plavat nahoru' }))
    step(2)
    expect(screen.getByRole('button', { name: 'Pozastavit' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    fireEvent.focusOut(board, { relatedTarget: screen.getByRole('button', { name: 'outside' }) })
    expect(screen.getByText('Pozastaveno')).toBeInTheDocument()
  })

  it('shows a saved best score', () => {
    localStorage.setItem(BEST_SCORE_KEY, '12')
    render(<NessieGame />, { wrapper: wrapper().Wrapper })
    expect(screen.getByText('Nejlepší:').parentElement).toHaveTextContent('Nejlepší: 12')
  })
})
