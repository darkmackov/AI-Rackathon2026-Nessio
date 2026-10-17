import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import type { PropsWithChildren, ReactNode } from 'react'
import { createQueryClient } from '../api'
import { getHandoverQueryKey, listCasesQueryKey, listDocumentsQueryKey, listFindingsQueryKey } from '../client/@tanstack/react-query.gen'
import { actorHeaders } from '../api'
import type { Case, CaseState, DocumentMeta, Job } from '../client/types.gen'
import DocumentUploader from '../components/documents/DocumentUploader'
import { supportedFile, validDocumentDate } from '../components/documents/document-utils'
import { changeLanguage, i18n } from '../i18n'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { referenceCases } from '../mocks/reference'
import { referenceDocuments } from '../mocks/reference-data'
import DocumentsTab from '../components/documents/DocumentsTab'
import SourcePanel from '../components/handover/SourcePanel'
import SessionProvider from '../SessionProvider'
import { useSession } from '../session'
import { theme } from '../theme'
import AppNotifications from '../notifications/AppNotifications'
import { openReferenceCase, openTab } from './shell'
import { server } from './setup'

// A case without reference documents, so upload results are the only documents it has.
const caseId = 'case-new'
const newCase: Case = { ...referenceCases[0], id: caseId }
const actorId = 'koordinator'
const pdf = () => new File(['%PDF-1.4\nfictional test'], 'zprava.pdf', { type: 'application/pdf' })
const docx = () => new File(['fictional test'], 'kontrola.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

// Multipart tests use the same native Web API objects as Node's Fetch/MSW transport.
// Mixing JSDOM File with Undici's Request.formData fails its WebIDL brand checks.
beforeAll(async () => {
  const form = await new Response('a=b', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData()
  vi.stubGlobal('FormData', form.constructor)
  vi.stubGlobal('File', NodeFile)
  vi.stubGlobal('Blob', NodeBlob)
})
afterAll(() => vi.unstubAllGlobals())

let now = 0
let state = createDemoState(() => now)
beforeEach(() => {
  now = 0
  state = createDemoState(() => now)
  server.use(...createHandlers({ ...state, getCases: () => [...state.getCases(), newCase] }))
})

function renderDocuments(node?: ReactNode, initialCaseId = caseId, selectedActorId = actorId, notifications = false) {
  const queryClient = createQueryClient()
  const openSource = vi.fn()
  function Wrapper({ children }: PropsWithChildren) {
    return <MantineProvider theme={theme} env="test"><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
      {notifications && <AppNotifications />}
    </QueryClientProvider></I18nextProvider></MantineProvider>
  }
  function Panel({ id }: { id: string }) {
    const session = useSession()
    return <><button onClick={() => { void session.selectActor(selectedActorId) }}>{selectedActorId === actorId ? 'Select coordinator' : 'Select referrer'}</button>
      {session.actorId && <DocumentsTab item={{ ...newCase, id }} names={{}} openSource={openSource} />}</>
  }
  const view = render(node ?? <Panel id={initialCaseId} />, { wrapper: Wrapper })
  return { ...view, queryClient, openSource, changeCase: (id: string) => view.rerender(<Panel id={id} />) }
}

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: 'Select coordinator' }))
  await screen.findByRole('heading', { name: 'Nahrát dokumenty' })
  await screen.findByText('Případ zatím nemá žádné dokumenty.')
}

describe('S2 document upload and processing in the case documents tab', () => {
  it.each(['koncept', 'vraceno_lekari'] satisfies CaseState[])('lets the referring doctor upload to their own %s case using their session identity', async (caseState) => {
    const fixture = { ...newCase, id: `referrer-${caseState}`, state: caseState }
    server.use(...createHandlers({ ...state, getCases: () => [fixture] }))
    const { queryClient } = renderDocuments(undefined, fixture.id, fixture.referring_doctor_id)
    await userEvent.click(screen.getByRole('button', { name: 'Select referrer' }))
    await screen.findByText('Případ zatím nemá žádné dokumenty.')
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByText('Nahráno, stav AI je v seznamu dokumentů')).toBeVisible()
    expect(screen.getByText('Čeká na zpracování')).toBeVisible()
    expect(state.documents.list(fixture.id)).toMatchObject([{ case_id: fixture.id, filename: 'zprava.pdf', uploaded_by: fixture.referring_doctor_id }])
    await waitFor(() => expect(queryClient.getQueryData(listDocumentsQueryKey({ headers: actorHeaders(fixture.referring_doctor_id), path: { case_id: fixture.id } }))).toMatchObject([{ uploaded_by: fixture.referring_doctor_id }]))
  })

  it('validates formats and document dates', () => {
    expect(supportedFile(pdf())).toBe(true)
    expect(supportedFile(docx())).toBe(true)
    expect(supportedFile(new File(['x'], 'REPORT.PPTX'))).toBe(true)
    expect(supportedFile(new File(['x'], 'fake.pdf', { type: 'text/plain' }))).toBe(false)
    expect(supportedFile(new File(['x'], 'scan.png', { type: 'image/png' }))).toBe(false)
    expect(validDocumentDate('2024-02-29')).toBe(true)
    expect(validDocumentDate('2026-02-29')).toBe(false)
    expect(validDocumentDate('0000-01-01')).toBe(false)
  })

  it('supports drag/drop, file removal and accessible invalid-file feedback without a request', async () => {
    let uploads = 0
    server.use(http.post('*/api/cases/:caseId/documents', () => { uploads++; return HttpResponse.json({}, { status: 500 }) }))
    renderDocuments(<DocumentUploader caseId="case-a" actorId={actorId} />, caseId, actorId, true)
    const drop = screen.getByText('Přetáhněte dokumenty sem nebo vyberte soubory.').closest('div')!
    fireEvent.drop(drop, { dataTransfer: { files: [pdf(), new File(['x'], 'scan.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('PDF, DOCX nebo PPTX')
    expect(screen.getByRole('list', { name: 'Vybrané soubory' })).toHaveTextContent('zprava.pdf')
    expect(uploads).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat zprava.pdf' }))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nahrát vybrané dokumenty' })).not.toBeInTheDocument()
  })

  it('uploads multiple files one at a time with case, actor and optional received_at; preserves drafts across language changes', async () => {
    const requests: { url: string; actor: string | null; name: string | undefined; received: FormDataEntryValue | null }[] = []
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    server.use(http.post('*/api/cases/:caseId/documents', async ({ request, params }) => {
      const body = await request.formData()
      const file = body.get('file')
      requests.push({ url: request.url, actor: request.headers.get('X-Actor-Id'), name: file && typeof file !== 'string' ? file.name : undefined, received: body.get('received_at') })
      if (requests.length === 1) await held
      const id = String(requests.length)
      return HttpResponse.json({ document: { id, filename: file && typeof file !== 'string' ? file.name : '', case_id: params.caseId }, job: { id: `job-${id}`, kind: 'ingest_document', case_id: params.caseId, status: 'queued', created_at: '2026-10-16T09:00:00' } }, { status: 201 })
    }))
    renderDocuments(<DocumentUploader caseId="case-a" actorId={actorId} receivedAt="2026-10-02T14:00:00" />)
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), [pdf(), docx()])
    await act(async () => { await changeLanguage('en') })
    expect(screen.getByRole('list', { name: 'Selected files' })).toHaveTextContent('kontrola.docx')
    await userEvent.click(screen.getByRole('button', { name: 'Upload selected documents' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.getByText('Uploading…')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove kontrola.docx' })).toBeDisabled()
    await act(async () => { release?.() })
    await waitFor(() => expect(screen.getAllByText('Uploaded, AI status is in the document list')).toHaveLength(2))
    expect(requests.map((item) => item.name)).toEqual(['zprava.pdf', 'kontrola.docx'])
    expect(requests.every((item) => item.actor === actorId && item.url.includes('/case-a/') && item.received === '2026-10-02T14:00:00')).toBe(true)
  })

  it('keeps failed files retryable and does not resend files already uploaded successfully', async () => {
    const names: string[] = []
    let fail = true
    server.use(http.post('*/api/cases/:caseId/documents', async ({ request }) => {
      const body = await request.formData()
      const file = body.get('file')
      const name = file && typeof file !== 'string' ? file.name : ''
      names.push(name)
      if (name === 'kontrola.docx' && fail) return HttpResponse.json({ detail: 'internal sensitive error' }, { status: 500 })
      return HttpResponse.json({ document: { id: name, filename: name }, job: { id: name, kind: 'ingest_document', case_id: 'case-b', status: 'queued', created_at: '2026-10-16T09:00:00' } }, { status: 201 })
    }))
    renderDocuments(<DocumentUploader caseId="case-b" actorId={actorId} />, caseId, actorId, true)
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), [pdf(), docx()])
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.queryByText('internal sensitive error')).not.toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    await waitFor(() => expect(screen.getAllByText('Nahráno, stav AI je v seznamu dokumentů')).toHaveLength(2))
    expect(names).toEqual(['zprava.pdf', 'kontrola.docx', 'kontrola.docx'])
  })

  it('warns about a possible duplicate after the upload without blocking it (Q-I22)', async () => {
    server.use(http.post('*/api/cases/:caseId/documents', () => HttpResponse.json({
      document: { id: 'doc-2', filename: 'zprava.pdf' },
      job: { id: 'job-2', kind: 'ingest_document', case_id: 'case-b', status: 'queued', created_at: '2026-10-16T09:00:00' },
      duplicates: [{ document_id: 'doc-1', filename: 'CT_KOC1.pdf', kind: 'exact', similarity: 1 },
        { document_id: 'doc-0', filename: 'CT_PL.docx', kind: 'near', similarity: 0.86 }],
    }, { status: 201 })))
    renderDocuments(<DocumentUploader caseId="case-b" actorId={actorId} />)
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByText('Možná duplicita')).toBeInTheDocument()
    expect(screen.getByText('Nahráno, stav AI je v seznamu dokumentů')).toBeInTheDocument()
    expect(screen.getByText('Stejný soubor jako CT_KOC1.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Text se shoduje s CT_PL\.docx \(86\s?%\)/)).toBeInTheDocument()
  })

  it('flags an exact copy in the demo mock', async () => {
    renderDocuments(<DocumentUploader caseId={caseId} actorId={actorId} />)
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    await screen.findByText('Nahráno, stav AI je v seznamu dokumentů')
    expect(screen.queryByText('Možná duplicita')).not.toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByText('Stejný soubor jako zprava.pdf')).toBeInTheDocument()
  })

  it('polls queued/running jobs, refreshes server results on completion, and stops polling terminal jobs', async () => {
    const { queryClient, openSource } = renderDocuments()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    let polls = 0
    server.events.on('request:start', ({ request }) => { if (/\/api\/jobs\//.test(request.url)) polls++ })
    await openPanel()
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByText('Čeká na zpracování')).toBeVisible()
    now = 1000
    expect(await screen.findByText('Probíhá AI extrakce')).toBeVisible()
    now = 4000
    expect(await screen.findByText('Dokončeno')).toBeVisible()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listDocumentsQueryKey({ path: { case_id: caseId } }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getHandoverQueryKey({ path: { case_id: caseId } }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listFindingsQueryKey({ path: { case_id: caseId } }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listCasesQueryKey() })
    // The refreshed document list shows what the server now holds for the upload.
    expect(await screen.findByText('Fiktivní ukázka dokumentu')).toBeVisible()
    const completedPolls = polls
    await new Promise((resolve) => setTimeout(resolve, 200))  // several poll intervals
    expect(polls).toBe(completedPolls)
    await userEvent.click(screen.getByRole('button', { name: 'Zobrazit text' }))
    expect(openSource).toHaveBeenCalledWith({ documentId: state.documents.list(caseId)[0].id }, expect.any(HTMLButtonElement))
  })

  it('saves only edited metadata fields and preserves the date as missing', async () => {
    const document: DocumentMeta = { id: 'doc-a', case_id: caseId, filename: 'test.pdf', title: 'Původní název', doc_type: 'other', facility: 'Původní pracoviště', document_date: null }
    let current = document
    let body: unknown
    let header: string | null = null
    server.use(
      http.get('*/api/cases/:caseId/documents', () => HttpResponse.json([current])),
      http.patch('*/api/documents/doc-a', async ({ request }) => {
        body = await request.json(); header = request.headers.get('X-Actor-Id')
        current = { ...document, facility: 'Nové pracoviště', doc_type: 'lab' }
        return HttpResponse.json(current)
      }),
    )
    renderDocuments()
    await userEvent.click(screen.getByRole('button', { name: 'Select coordinator' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Opravit metadata' }))
    const dialog = screen.getByRole('dialog', { name: 'Opravit metadata' })
    await userEvent.clear(within(dialog).getByLabelText('Pracoviště'))
    await userEvent.type(within(dialog).getByLabelText('Pracoviště'), 'Nové pracoviště')
    await userEvent.selectOptions(within(dialog).getByLabelText('Typ dokumentu'), 'lab')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Uložit metadata' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Metadata byla uložena.')
    expect(body).toEqual({ facility: 'Nové pracoviště', doc_type: 'lab' })
    expect(header).toBe(actorId)
    expect(within(dialog).getByLabelText('Datum dokumentu')).toHaveValue('')
  })

  it('folds jobs finished before the view opened into one summary line and names the icon actions', async () => {
    const done: Job = { id: 'job-done', kind: 'ingest_document', case_id: caseId, document_id: 'doc-a', status: 'done', created_at: '2026-10-16T09:00:00' }
    server.use(
      http.get('*/api/cases/:caseId/documents', () => HttpResponse.json([{ id: 'doc-a', case_id: caseId, filename: 'a.pdf' }])),
      http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json([done, { ...done, id: 'job-done-2' }])),
    )
    renderDocuments()
    await userEvent.click(screen.getByRole('button', { name: 'Select coordinator' }))
    expect(await screen.findByText('AI zpracování dokončeno (2×)')).toBeVisible()
    expect(screen.queryByText('Dokončeno')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stáhnout originál' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Opravit metadata' })).toBeVisible()
  })

  it('shows failed extraction without exposing backend details and offers one retry via reextractCase', async () => {
    const failed: Job = { id: 'job-failed', kind: 'ingest_document', case_id: caseId, status: 'failed', error: 'internal stack', created_at: '2026-10-16T09:00:00' }
    let retried: string | null = null
    server.use(
      http.get('*/api/cases/:caseId/documents', () => HttpResponse.json([{ id: 'doc-a', case_id: caseId, filename: 'a.pdf' }])),
      http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json([failed])),
      http.post('*/api/cases/:caseId/extract', ({ request }) => { retried = request.headers.get('X-Actor-Id'); return HttpResponse.json({ ...failed, id: 'retry', status: 'queued' }, { status: 202 }) }),
      http.get('*/api/jobs/:jobId', () => HttpResponse.json({ ...failed, id: 'retry', status: 'queued' })),
    )
    renderDocuments()
    await userEvent.click(screen.getByRole('button', { name: 'Select coordinator' }))
    expect(await screen.findByText('Chyba zpracování')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('internal stack')).not.toBeInTheDocument()
    const retry = screen.getAllByRole('button', { name: 'Znovu spustit extrakci' })
    expect(retry).toHaveLength(1)
    await userEvent.click(retry[0])
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Znovu spustit extrakci?' })).getByRole('button', { name: 'Znovu spustit extrakci' }))
    await waitFor(() => expect(retried).toBe(actorId))
  })

  it('warns that closed findings may reopen and re-extracts only after confirmation', async () => {
    let requests = 0
    server.use(
      http.get('*/api/cases/:caseId/documents', () => HttpResponse.json([{ id: 'doc-a', case_id: caseId, filename: 'a.pdf' }])),
      http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json([])),
      http.post('*/api/cases/:caseId/extract', () => { requests++; return HttpResponse.json({ id: 'job-new', kind: 'ingest_document', case_id: caseId, status: 'queued', created_at: '2026-10-16T09:00:00' }, { status: 202 }) }),
      http.get('*/api/jobs/:jobId', () => HttpResponse.json({ id: 'job-new', kind: 'ingest_document', case_id: caseId, status: 'queued', created_at: '2026-10-16T09:00:00' })),
    )
    renderDocuments(undefined, caseId, actorId, true)
    await userEvent.click(screen.getByRole('button', { name: 'Select coordinator' }))
    const button = await screen.findByRole('button', { name: 'Znovu spustit extrakci' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'Znovu spustit extrakci?' })
    expect(dialog).toHaveTextContent('Ručně zadané hodnoty zůstanou.')
    expect(dialog).toHaveTextContent('se mohou znovu otevřít')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests).toBe(0)
    await userEvent.click(button)
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Znovu spustit extrakci?' })).getByRole('button', { name: 'Znovu spustit extrakci' }))
    await waitFor(() => expect(requests).toBe(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps extraction controls in place after a request failure and retries using the same action', async () => {
    let requests = 0
    server.use(
      http.get('*/api/cases/:caseId/documents', () => HttpResponse.json([{ id: 'doc-a', case_id: caseId, filename: 'a.pdf' }])),
      http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json([])),
      http.post('*/api/cases/:caseId/extract', () => {
        requests++
        return HttpResponse.json({ detail: 'private failure' }, { status: 500 })
      }),
    )
    renderDocuments(undefined, caseId, actorId, true)
    await userEvent.click(screen.getByRole('button', { name: 'Select coordinator' }))
    const button = await screen.findByRole('button', { name: 'Znovu spustit extrakci' })
    await waitFor(() => expect(button).toBeEnabled())
    const section = button.closest('section')!
    const children = Array.from(section.children)
    const confirm = async () => {
      await userEvent.click(button)
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Znovu spustit extrakci?' })).getByRole('button', { name: 'Znovu spustit extrakci' }))
    }
    await confirm()
    await screen.findByText('Při zpracování požadavku nastala chyba. Zkuste to znovu.')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(Array.from(section.children)).toEqual(children)
    expect(within(section).queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument()
    await confirm()
    await waitFor(() => expect(requests).toBe(2))
    await waitFor(() => expect(button).toBeEnabled())
    expect(Array.from(section.children)).toEqual(children)
  })

  it('shows honest 501 job failures without blocking uploads', async () => {
    server.use(http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json({ detail: 'not implemented' }, { status: 501 })))
    renderDocuments(undefined, caseId, actorId, true)
    await openPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Tato funkce zatím není implementována.')
    expect(screen.getByRole('button', { name: 'Vybrat soubory' })).toBeEnabled()
  })

  it('resets selected files when caseId changes and never sends them to another case', async () => {
    const view = renderDocuments()
    await openPanel()
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    view.changeCase('another-case')
    await screen.findByRole('heading', { name: 'Nahrát dokumenty' })
    expect(screen.queryByRole('list', { name: 'Vybrané soubory' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nahrát vybrané dokumenty' })).not.toBeInTheDocument()
  })

  it('also resets the standalone uploader on a case or actor change and allows choosing a removed file again', async () => {
    const file = pdf()
    const view = renderDocuments(<DocumentUploader caseId="case-a" actorId={actorId} />)
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat zprava.pdf' }))
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), file)
    expect(screen.getByRole('list')).toHaveTextContent('zprava.pdf')
    view.rerender(<DocumentUploader caseId="case-b" actorId={actorId} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), file)
    view.rerender(<DocumentUploader caseId="case-b" actorId="another-actor" />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('contains a polling HTTP failure, displays the last known status and retries the same job', async () => {
    let job: Job = { id: 'job-error', kind: 'ingest_document', case_id: caseId, status: 'running', created_at: '2026-10-16T09:00:00' }
    let failing = true
    server.use(
      http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json([job])),
      http.get('*/api/jobs/job-error', () => failing ? HttpResponse.json({ detail: 'private stack' }, { status: 500 }) : HttpResponse.json(job)),
    )
    renderDocuments(undefined, caseId, actorId, true)
    await openPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.getByText('Probíhá AI extrakce')).toBeVisible()
    expect(screen.queryByText('private stack')).not.toBeInTheDocument()
    job = { ...job, status: 'done' }; failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findByText('Dokončeno')).toBeVisible()
  })

  it('shows retryable source-text and original-file failures without losing the source panel', async () => {
    server.use(
      http.get('*/api/documents/doc-a/text', () => HttpResponse.json({ detail: 'private error' }, { status: 500 })),
      http.get('*/api/documents/doc-a/file', () => HttpResponse.json({ detail: 'not implemented' }, { status: 501 })),
    )
    renderDocuments(<SourcePanel document={{ id: 'doc-a', filename: 'original.pdf' }} close={() => { }} />, caseId, actorId, true)
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout originál' }))
    expect(await screen.findByText('Tato funkce zatím není implementována.')).toBeVisible()
    expect(screen.queryByText('Originální soubor se nepodařilo stáhnout.')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Zdrojový dokument' })).toBeVisible()
    expect(screen.queryByText('private error')).not.toBeInTheDocument()
  })

  it('lists every case document, marks only the actual GP upload and opens its full text', async () => {
    server.use(...createHandlers(state))
    const { router, user } = await openReferenceCase()
    const panel = await openTab(user, 'Dokumenty')
    expect(router.state.location.search).toMatchObject({ tab: 'documents' })
    expect(await within(panel).findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(referenceDocuments.length)
    expect(within(panel).getAllByText('Předal odesílající lékař')).toHaveLength(1)
    await user.click(within(panel).getAllByRole('button', { name: 'Zobrazit text' })[0])
    const source = await screen.findByRole('dialog', { name: 'Zdrojový dokument' })
    const text = await within(source).findByTestId('document-text')
    expect(text).toHaveTextContent('Kardiologická ambulance')
    expect(text).not.toHaveTextContent('<!-- source')
  })

  it('retries an original download and revokes its URL when leaving the case', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-original')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })
    server.use(http.get('*/api/documents/:id/file', () => HttpResponse.json({ detail: 'failed' }, { status: 500 })), ...createHandlers(state))
    const { user } = await openReferenceCase({ notifications: true })
    const panel = await openTab(user, 'Dokumenty')
    const first = (await within(panel).findAllByRole('button', { name: 'Stáhnout originál' }))[0]
    await user.click(first)
    expect(await screen.findByText('Při zpracování požadavku nastala chyba. Zkuste to znovu.')).toBeVisible()
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    server.resetHandlers()
    server.use(...createHandlers(state))
    await user.click(first)
    await waitFor(() => expect(clicked).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith(expect.any(Blob))
    expect(within(panel).queryByText('Originální soubor se nepodařilo stáhnout.')).not.toBeInTheDocument()
    expect(within(panel).queryByText('Originální soubor byl připraven ke stažení.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /Zpět na pracovní frontu/ }))
    expect(revoke).toHaveBeenCalledWith('blob:test-original')
  })

  it('isolates a failed document list and retries it without losing the case', async () => {
    server.use(http.get('*/api/cases/:id/documents', () => HttpResponse.json({ detail: 'failed' }, { status: 500 })), ...createHandlers(state))
    const { user } = await openReferenceCase({ notifications: true })
    const panel = await openTab(user, 'Dokumenty')
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Alena Procházková' })).toBeVisible()
    server.resetHandlers()
    server.use(...createHandlers(state))
    await user.click(within(panel).getByRole('button', { name: 'Zkusit znovu' }))
    expect(await within(panel).findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(referenceDocuments.length)
  })
})
