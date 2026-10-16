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
import {
  documentTextOptions, getDocumentFileOptions, getHandoverOptions, getHandoverQueryKey, getJobOptions,
  listCaseJobsOptions, listCasesQueryKey, listDocumentsOptions, listDocumentsQueryKey, listFindingsOptions,
  listFindingsQueryKey, reextractCaseMutation, resetDemoMutation, updateDocumentMutation, uploadDocumentMutation,
} from '../client/@tanstack/react-query.gen'
import { actorHeaders } from '../api'
import type { Case, CaseState, DocumentMeta, Handover, Job } from '../client/types.gen'
import DocumentUploader from '../components/documents/DocumentUploader'
import { supportedFile, validDocumentDate } from '../components/documents/document-utils'
import { changeLanguage, i18n } from '../i18n'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { demoDocumentText, demoExtraction } from '../mocks/documents'
import { referenceCases } from '../mocks/reference'
import { referenceDocuments, referenceHandover } from '../mocks/reference-data'
import DocumentsTab from '../screens/CaseDetail/DocumentsTab'
import HandoverTab from '../screens/CaseDetail/HandoverTab'
import SourcePanel from '../screens/CaseDetail/SourcePanel'
import SessionProvider from '../SessionProvider'
import { useSession } from '../session'
import { theme } from '../theme'
import { expectApiResponse } from './api-contract'
import { renderApp } from './renderApp'
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

function renderDocuments(node?: ReactNode, initialCaseId = caseId, selectedActorId = actorId) {
  const queryClient = createQueryClient()
  const openSource = vi.fn()
  function Wrapper({ children }: PropsWithChildren) {
    return <MantineProvider theme={theme} env="test"><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
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
    expect(await screen.findByText('Nahráno, stav AI níže')).toBeVisible()
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
    renderDocuments(<DocumentUploader caseId="case-a" actorId={actorId} />)
    const drop = screen.getByText('Přetáhněte dokumenty sem nebo vyberte soubory.').closest('div')!
    fireEvent.drop(drop, { dataTransfer: { files: [pdf(), new File(['x'], 'scan.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('PDF, DOCX nebo PPTX')
    expect(screen.getByRole('list', { name: 'Vybrané soubory' })).toHaveTextContent('zprava.pdf')
    expect(uploads).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Odebrat zprava.pdf' }))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' })).toBeDisabled()
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
    await waitFor(() => expect(screen.getAllByText('Uploaded, AI status below')).toHaveLength(2))
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
    renderDocuments(<DocumentUploader caseId="case-b" actorId={actorId} />)
    await userEvent.upload(screen.getByLabelText('Vybrat soubory'), [pdf(), docx()])
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.queryByText('internal sensitive error')).not.toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    await waitFor(() => expect(screen.getAllByText('Nahráno, stav AI níže')).toHaveLength(2))
    expect(names).toEqual(['zprava.pdf', 'kontrola.docx', 'kontrola.docx'])
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
    expect(await screen.findByText('Probíhá AI extrakce', {}, { timeout: 3000 })).toBeVisible()
    now = 4000
    expect(await screen.findByText('Dokončeno', {}, { timeout: 3000 })).toBeVisible()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listDocumentsQueryKey({ path: { case_id: caseId } }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getHandoverQueryKey({ path: { case_id: caseId } }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listFindingsQueryKey({ path: { case_id: caseId } }) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listCasesQueryKey() })
    // The refreshed document list shows what the server now holds for the upload.
    expect(await screen.findByText('Fiktivní ukázka dokumentu')).toBeVisible()
    const completedPolls = polls
    await new Promise((resolve) => setTimeout(resolve, 1200))
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
    expect(screen.getByRole('alert')).toHaveTextContent('Dokument se nepodařilo zpracovat.')
    expect(screen.queryByText('internal stack')).not.toBeInTheDocument()
    const retry = screen.getAllByRole('button', { name: 'Znovu spustit extrakci' })
    expect(retry).toHaveLength(1)
    await userEvent.click(retry[0])
    await waitFor(() => expect(retried).toBe(actorId))
  })

  it('shows honest 501 job failures without blocking uploads', async () => {
    server.use(http.get('*/api/cases/:caseId/jobs', () => HttpResponse.json({ detail: 'not implemented' }, { status: 501 })))
    renderDocuments()
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
    expect(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' })).toBeDisabled()
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
    renderDocuments()
    await openPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    expect(screen.getByText('Probíhá AI extrakce')).toBeVisible()
    expect(screen.queryByText('private stack')).not.toBeInTheDocument()
    job = { ...job, status: 'done' }; failing = false
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Zkusit znovu' }))
    expect(await screen.findByText('Dokončeno')).toBeVisible()
  })

  it('shows retryable source-text and original-file failures without losing the source panel', async () => {
    server.use(
      http.get('*/api/documents/doc-a/text', () => HttpResponse.json({ detail: 'private error' }, { status: 500 })),
      http.get('*/api/documents/doc-a/file', () => HttpResponse.json({ detail: 'not implemented' }, { status: 501 })),
    )
    renderDocuments(<SourcePanel document={{ id: 'doc-a', filename: 'original.pdf' }} close={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Při zpracování požadavku nastala chyba.')
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout originál' }))
    expect(await screen.findByText('Originální soubor se nepodařilo stáhnout.')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('dialog', { name: 'Zdrojový dokument' })).toBeVisible()
    expect(screen.queryByText('private error')).not.toBeInTheDocument()
  })

  it('shows manual provenance, zero and empty contract values explicitly without inventing clinical data', async () => {
    const entered = { by: actorId, at: '2026-10-16T09:00:00' }
    const handover: Handover = {
      ...demoExtraction(caseId, 'source-a', '2026-10-16T09:00:00').handover,
      symptoms: { status: 'found', origin: 'manual', value: '', entered },
      comorbidities: { status: 'found', origin: 'manual', value: [], entered },
      weight_kg: { status: 'found', origin: 'manual', value: 0, entered },
    }
    expectApiResponse('get_handover', 200, handover)
    renderDocuments(<HandoverTab handover={handover} names={{ [actorId]: 'Bc. Lucie Dvořáková' }} sources={{ documentNames: {}, openSource: () => {}, selection: null }} findings={[]} showFinding={() => {}} open={['history']} setOpen={() => {}} />)
    expect(screen.getAllByText('Prázdná hodnota.')).toHaveLength(2)
    expect(screen.getByText('0', { selector: 'p' })).toBeVisible()
    expect(screen.getAllByText('Ruční zadání')).toHaveLength(3)
    expect(await screen.findAllByText('Bc. Lucie Dvořáková')).toHaveLength(3)
  })

  it('uploads from the case detail Documents tab, the only document entry point, and clears drafts on reset', async () => {
    server.use(...createHandlers(state))
    const { router } = renderApp()
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Role'), 'coordinator')
    await user.selectOptions(await screen.findByLabelText('Osoba'), actorId)
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }))
    await screen.findByRole('link', { name: 'Alena Procházková' })
    expect(screen.queryByRole('button', { name: 'Dokumenty' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Alena Procházková' }))
    await user.click(await screen.findByRole('tab', { name: 'Dokumenty' }))
    expect(router.state.location.search).toMatchObject({ tab: 'documents' })
    expect(await screen.findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(referenceDocuments.length)
    await user.upload(screen.getByLabelText('Vybrat soubory'), pdf())
    await user.click(screen.getByRole('button', { name: 'Nahrát vybrané dokumenty' }))
    await screen.findByText('Nahráno, stav AI níže')
    expect(await screen.findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(referenceDocuments.length + 1)
    await user.click(screen.getByRole('button', { name: 'Demo' }))
    const demo = screen.getByRole('dialog', { name: 'Ovládání dema' })
    await user.click(within(demo).getByRole('button', { name: 'Obnovit referenci' }))
    const confirm = screen.getByRole('dialog', { name: 'Obnovit demo?' })
    await user.click(within(confirm).getByRole('button', { name: 'Obnovit data' }))
    await within(demo).findByText('Demo bylo obnoveno.')
    expect(router.state.location.pathname).toBe('/coordinator')
    await user.click(within(demo).getByRole('button', { name: 'Zavřít' }))
    await user.click(await screen.findByRole('link', { name: 'Alena Procházková' }))
    await user.click(await screen.findByRole('tab', { name: 'Dokumenty' }))
    expect(await screen.findAllByRole('button', { name: 'Stáhnout originál' })).toHaveLength(referenceDocuments.length)
    expect(screen.queryByRole('list', { name: 'Vybrané soubory' })).not.toBeInTheDocument()
  })

  it('keeps synthetic fixtures within existing OpenAPI models and preserves missing/conflicting values', () => {
    const result = demoExtraction('any-case', 'any-document', '2026-10-16T09:00:00')
    expectApiResponse('get_handover', 200, result.handover)
    expectApiResponse('list_findings', 200, result.findings)
    expect(result.handover.performance_status?.value).toBeNull()
    expect(result.handover.weight_kg?.status).toBe('conflict')
    expect(result.handover.weight_kg?.evidence?.every((item) => demoDocumentText.includes(item.quote))).toBe(true)
    expect(result.handover.validated_by_referrer).toBeNull()
  })
})

describe('S2 dummy HTTP boundary using generated API helpers', () => {
  it('preserves upload/job/metadata/result contracts and original bytes for arbitrary case IDs', async () => {
    const base = state.getCases()[0]
    server.use(...createHandlers({ ...state, getCases: () => [{ ...base, id: 'case-a' }, { ...base, id: 'case-b' }] }))
    const client = createQueryClient()
    const headers = actorHeaders(actorId)
    const options = { headers, path: { case_id: 'case-a' } }
    const upload = client.getMutationCache().build(client, uploadDocumentMutation())
    const result = await upload.execute({ ...options, body: { file: pdf(), received_at: '2026-10-02T14:00:00' } })
    expectApiResponse('upload_document', 201, result)
    expect(result.document.received_at).toBe('2026-10-02T14:00:00')
    expect(result.document.case_id).toBe('case-a')
    expect(result.job.status).toBe('queued')
    expectApiResponse('list_case_jobs', 200, await client.fetchQuery(listCaseJobsOptions(options)))
    expect(await client.fetchQuery(listDocumentsOptions({ headers, path: { case_id: 'case-b' } }))).toEqual([])
    const second = await upload.execute({ headers, path: { case_id: 'case-b' }, body: { file: docx() } })
    expect(second.document.case_id).toBe('case-b')
    expect(await client.fetchQuery(listDocumentsOptions(options))).toHaveLength(1)
    expect(await client.fetchQuery(listDocumentsOptions({ headers, path: { case_id: 'case-b' } }))).toMatchObject([{ filename: 'kontrola.docx' }])
    now = 1000
    const jobOptions = getJobOptions({ headers, path: { job_id: result.job.id } })
    expect(await client.fetchQuery(jobOptions)).toMatchObject({ status: 'running' })
    now = 4000
    const completed = await client.fetchQuery(jobOptions)
    expect(completed.status).toBe('done')
    expectApiResponse('get_job', 200, completed)
    expectApiResponse('list_documents', 200, await client.fetchQuery(listDocumentsOptions(options)))
    const handover = await client.fetchQuery(getHandoverOptions(options))
    expectApiResponse('get_handover', 200, handover)
    expect(handover.case_id).toBe('case-a')
    expectApiResponse('list_findings', 200, await client.fetchQuery(listFindingsOptions(options)))
    const documentOptions = { headers, path: { document_id: result.document.id } }
    expectApiResponse('document_text', 200, await client.fetchQuery(documentTextOptions(documentOptions)))
    const original = await client.fetchQuery(getDocumentFileOptions({ ...documentOptions, parseAs: 'blob' }))
    expect(await original.text()).toBe(await pdf().text())
    const update = client.getMutationCache().build(client, updateDocumentMutation())
    const corrected = await update.execute({ ...documentOptions, body: { doc_type: 'lab', facility: 'Testovací pracoviště', document_date: null } })
    expectApiResponse('update_document', 200, corrected)
    expect(corrected).toMatchObject({ doc_type: 'lab', facility: 'Testovací pracoviště', document_date: null })
    const reextract = client.getMutationCache().build(client, reextractCaseMutation())
    expectApiResponse('reextract_case', 202, await reextract.execute(options))
    const reset = client.getMutationCache().build(client, resetDemoMutation())
    await reset.execute({ body: { scenario: 'reference_at_mdt' } })
    expect(await client.fetchQuery(listDocumentsOptions(options))).toEqual([])
    expect(await client.fetchQuery(listCaseJobsOptions(options))).toEqual([])
    await expect(client.fetchQuery(getHandoverOptions(options))).rejects.toMatchObject({ status: 404 })
    await expect(client.fetchQuery(getDocumentFileOptions({ ...documentOptions, parseAs: 'blob' }))).rejects.toMatchObject({ status: 404 })
  })

  it('adds uploads to the reference case without replacing its reference extraction', async () => {
    const reference = referenceHandover.case_id
    const client = createQueryClient()
    const headers = actorHeaders(actorId)
    const options = { headers, path: { case_id: reference } }
    const upload = client.getMutationCache().build(client, uploadDocumentMutation())
    const result = await upload.execute({ ...options, body: { file: pdf() } })
    now = 4000
    expect(await client.fetchQuery(getJobOptions({ headers, path: { job_id: result.job.id } }))).toMatchObject({ status: 'done' })
    expect(await client.fetchQuery(getHandoverOptions(options))).toEqual(referenceHandover)
    expect(await client.fetchQuery(listDocumentsOptions(options))).toHaveLength(referenceDocuments.length + 1)
    expect(await client.fetchQuery(documentTextOptions({ headers, path: { document_id: result.document.id } }))).toMatchObject({ text: demoDocumentText })
  })

  it('enforces format, actor, case scope and datetime checks at the mock HTTP boundary', async () => {
    const client = createQueryClient()
    const upload = client.getMutationCache().build(client, uploadDocumentMutation())
    const options = { headers: actorHeaders(actorId), path: { case_id: referenceHandover.case_id } }
    await expect(upload.execute({ ...options, body: { file: new File(['x'], 'bad.png', { type: 'image/png' }) } })).rejects.toMatchObject({ status: 400 })
    await expect(upload.execute({ ...options, headers: actorHeaders('koord-severni'), body: { file: pdf() } })).rejects.toMatchObject({ status: 403 })
    await expect(upload.execute({ ...options, headers: actorHeaders('pl-reznicek'), body: { file: pdf() } })).rejects.toMatchObject({ status: 409 })
    await expect(upload.execute({ ...options, path: { case_id: 'unknown' }, body: { file: pdf() } })).rejects.toMatchObject({ status: 404 })
    await expect(upload.execute({ ...options, body: { file: pdf(), received_at: 'invalid date' } })).rejects.toMatchObject({ status: 422 })
    const result = await upload.execute({ ...options, body: { file: pdf() } })
    await expect(client.fetchQuery(documentTextOptions({ headers: actorHeaders('koord-severni'), path: { document_id: result.document.id } }))).rejects.toMatchObject({ status: 403 })
  })
})
