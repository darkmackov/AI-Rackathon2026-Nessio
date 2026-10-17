import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import { createReferralFromBundleMutation, getHandoverOptions, getJobQueryKey, listCasesOptions, listDocumentsOptions, listFindingsOptions } from '../client/@tanstack/react-query.gen'
import { changeLanguage } from '../i18n'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { expectApiResponse } from './api-contract'
import { renderApp } from './renderApp'
import { changeIdentity, openTab, signIn } from './shell'
import { demoState, server } from './setup'

beforeAll(async () => {
  const form = await new Response('a=b', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData()
  vi.stubGlobal('FormData', form.constructor)
  vi.stubGlobal('File', NodeFile)
  vi.stubGlobal('Blob', NodeBlob)
})
afterAll(() => vi.unstubAllGlobals())

const data = btoa('%PDF-1.4\nFictional local test attachment only.')
const attachment = { contentType: 'application/pdf', title: 'fiktivni-priloha.pdf', data }
const bundle = (attachments: unknown[] = [attachment]) => ({ resourceType: 'Bundle', type: 'collection', entry: [
  { resource: { resourceType: 'Patient', name: [{ family: 'Fiktivni-strukturovany-udaj' }] } },
  { resource: { resourceType: 'DocumentReference', content: attachments.map((item) => ({ attachment: item })) } },
] })
const fileOf = (value: unknown = bundle()) => new File([typeof value === 'string' ? value : JSON.stringify(value)], 'zadost.json', { type: 'application/fhir+json' })
function importer() {
  const client = createQueryClient()
  const mutation = client.getMutationCache().build(client, createReferralFromBundleMutation())
  return { client, send: (file = fileOf(), actor = 'pl-reznicek', koc = 'koc2-lipova') => mutation.execute({ headers: actorHeaders(actor), body: { file, koc_id: koc } }) }
}

describe('S9 referral exchange at the HTTP boundary', () => {
  it('creates a sent case in Nový with attachment jobs, no structured mapping and no validation stamp', async () => {
    const { client, send } = importer()
    const item = await send()
    expectApiResponse('create_referral_from_bundle', 201, item)
    expect(item).toMatchObject({ state: 'odeslano', queue: 'novy', patient_name: '', koc_id: 'koc2-lipova', referring_doctor_id: 'pl-reznicek' })
    expect(item.milestones?.referred_at).toBeTruthy()
    const options = { headers: actorHeaders('pl-reznicek'), path: { case_id: item.id } }
    const docs = await client.fetchQuery(listDocumentsOptions(options))
    expectApiResponse('list_documents', 200, docs)
    expect(docs).toMatchObject([{ filename: attachment.title, mime_type: attachment.contentType, case_id: item.id, uploaded_by: 'pl-reznicek' }])
    expect(await demoState.documents.original(docs[0].id)?.then((file) => file?.text())).toBe(atob(data))
    const handover = await client.fetchQuery(getHandoverOptions(options))
    expect(handover.patient?.last_name?.value).toBeUndefined()
    expect(handover.validated_by_referrer).toBeFalsy()
    expect(demoState.documents.listJobs(item.id, demoState.clock().now)).toMatchObject([{ status: 'queued', document_id: docs[0].id }])
    expect((await client.fetchQuery(listCasesOptions({ query: { koc_id: item.koc_id, queue: 'novy' } }))).map((entry) => entry.id)).toContain(item.id)
    expect((await client.fetchQuery(listCasesOptions({ headers: actorHeaders('pl-novakova'), query: { referring_doctor_id: 'pl-novakova' } }))).map((entry) => entry.id)).not.toContain(item.id)
    demoState.reset('empty')
    expect(demoState.getCases()).toEqual([])
    expect(demoState.documents.list(item.id)).toEqual([])
  })

  it('accepts DiagnosticReport attachments through a Bundle-local Binary by fullUrl or relative id', async () => {
    const payload = { resourceType: 'Bundle', entry: [
      { fullUrl: 'urn:uuid:local-pdf', resource: { resourceType: 'Binary', id: 'pdf', contentType: 'application/pdf', data } },
      { resource: { resourceType: 'DiagnosticReport', presentedForm: [{ title: 'a.pdf', url: 'urn:uuid:local-pdf' }, { title: 'b.pdf', url: 'Binary/pdf' }] } },
    ] }
    const first = await importer().send(fileOf(payload), 'pl-reznicek', 'koc1-severni')
    const second = await importer().send()
    expect(first.id).not.toBe(second.id)
    expect(demoState.documents.list(first.id).map((doc) => doc.filename)).toEqual(['a.pdf', 'b.pdf'])
    expect(demoState.documents.list(second.id).map((doc) => doc.filename)).toEqual([attachment.title])
    expect(demoState.documents.listJobs(first.id, demoState.clock().now)).toHaveLength(2)
  })

  it.each([
    ['broken JSON', 'not json', 422], ['wrong resource', { resourceType: 'Patient' }, 422],
    ['wrong entries', { resourceType: 'Bundle', entry: {} }, 422], ['no documents', bundle([]), 400],
    ['external URL', bundle([{ title: 'external.pdf', url: 'https://invalid.example/private.pdf' }]), 422],
    ['invalid base64', bundle([{ ...attachment, data: 'not-base64!' }]), 422],
    ['unsupported attachment after a valid one', bundle([attachment, { ...attachment, contentType: 'image/png', title: 'foto.png' }]), 415],
  ])('rejects %s without leaving any partial case or documents', async (_name, payload, status) => {
    demoState.reset('empty')
    await expect(importer().send(fileOf(payload))).rejects.toMatchObject({ status })
    expect(demoState.getCases()).toEqual([])
  })

  it('enforces referring doctor and receiving KOC at the HTTP boundary', async () => {
    const { send } = importer()
    await expect(send(fileOf(), 'koordinator')).rejects.toMatchObject({ status: 403 })
    await expect(send(fileOf(), 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(send(fileOf(), 'pl-reznicek', 'missing')).rejects.toMatchObject({ status: 400 })
    await expect(send(fileOf(), 'pl-reznicek', 'ordinace-reznicek')).rejects.toMatchObject({ status: 400 })
  })
})

async function openImport() {
  const user = userEvent.setup({ applyAccept: false })
  await signIn(user, 'referring_doctor')
  await user.click(screen.getByRole('button', { name: 'Nová žádost' }))
  const dialog = await screen.findByRole('dialog', { name: 'Nová žádost do KOC' })
  await user.click(await within(dialog).findByRole('radio', { name: 'Import z FHIR (JSON)' }))
  return { user, dialog }
}

describe('S9 doctor import UI', () => {
  it('requires KOC and a JSON file, supports removal, and sends only after explicit confirmation', async () => {
    let now = 0
    const state = createDemoState(() => now)
    state.reset('empty')
    server.use(...createHandlers(state))
    const { queryClient, router } = renderApp()
    const { user, dialog } = await openImport()
    await user.click(within(dialog).getByRole('button', { name: 'Importovat a odeslat' }))
    expect(within(dialog).getByRole('alert', { name: 'Zkontrolujte formulář' })).toHaveFocus()
    expect(within(dialog).getByRole('alert', { name: 'Zkontrolujte formulář' })).toHaveTextContent('Vyberte KOC ze seznamu.')
    await user.selectOptions(within(dialog).getByLabelText('Cílové KOC'), 'koc1-severni')
    await user.upload(within(dialog).getByLabelText('Vybrat FHIR JSON'), new File(['invalid'], 'zprava.pdf', { type: 'application/pdf' }))
    expect(within(dialog).getAllByText('Vyberte jeden neprázdný soubor JSON.').length).toBeGreaterThan(0)
    fireEvent.drop(within(dialog).getByText('Přetáhněte soubor FHIR Bundle sem nebo jej vyberte.'), { dataTransfer: { files: [fileOf()] } })
    expect(within(dialog).getByText(/zadost.json/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Odebrat soubor' }))
    expect(within(dialog).queryByText(/zadost.json/)).not.toBeInTheDocument()
    await user.upload(within(dialog).getByLabelText('Vybrat FHIR JSON'), fileOf())
    await user.click(within(dialog).getByRole('button', { name: 'Importovat a odeslat' }))
    let confirmation = await screen.findByRole('dialog', { name: 'Importovat a odeslat žádost?' })
    expect(confirmation).toHaveTextContent('KOC Nemocnice Severní')
    expect(state.getCases()).toEqual([])
    await user.click(within(confirmation).getByRole('button', { name: 'Zrušit' }))
    await user.click(within(dialog).getByRole('button', { name: 'Importovat a odeslat' }))
    confirmation = await screen.findByRole('dialog', { name: 'Importovat a odeslat žádost?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Importovat a odeslat' }))
    await screen.findByRole('heading', { level: 1, name: 'Pacient zatím neuveden' })
    const item = state.getCases()[0]
    expect(router.state.location.pathname).toBe(`/referrer/cases/${item.id}`)
    expect(item.koc_id).toBe('koc1-severni')
    expect(await screen.findByText('Čeká na zpracování')).toBeVisible()
    expect(screen.queryByLabelText('Vybrat soubory')).not.toBeInTheDocument()
    const job = state.documents.listJobs(item.id, state.clock().now)[0]
    const key = getJobQueryKey({ headers: actorHeaders('pl-reznicek'), path: { job_id: job.id } })
    now = 1500
    await act(async () => { await queryClient.refetchQueries({ queryKey: key }) })
    expect(await screen.findByText('Probíhá AI extrakce')).toBeVisible()
    now = 3500
    await act(async () => { await queryClient.refetchQueries({ queryKey: key }) })
    expect(await screen.findByText('Dokončeno')).toBeVisible()
    await openTab(user, 'Předávka')
    await user.click(screen.getByRole('button', { name: /^Anamnézy a stav/ }))
    expect(await screen.findByText('V ukázkové zprávě je uvedena únava.')).toBeVisible()
    const options = { path: { case_id: item.id }, headers: actorHeaders('pl-reznicek') }
    expect((await queryClient.fetchQuery(getHandoverOptions(options))).validated_by_referrer).toBeNull()
    expect(await queryClient.fetchQuery(listFindingsOptions(options))).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Validovat a odeslat' })).not.toBeInTheDocument()
  })

  it.each([400, 415, 422, 501, 500])('shows a safe %s import error and preserves the file and KOC for retry', async (status) => {
    demoState.reset('empty')
    server.use(http.post('*/api/referrals/fhir', () => HttpResponse.json({ detail: 'private technical details' }, { status })))
    renderApp()
    const { user, dialog } = await openImport()
    await user.selectOptions(within(dialog).getByLabelText('Cílové KOC'), 'koc2-lipova')
    await user.upload(within(dialog).getByLabelText('Vybrat FHIR JSON'), fileOf())
    await user.click(within(dialog).getByRole('button', { name: 'Importovat a odeslat' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Importovat a odeslat žádost?' })
    await user.click(within(confirmation).getByRole('button', { name: 'Importovat a odeslat' }))
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Importovat a odeslat žádost?' })).not.toBeInTheDocument())
    expect(within(dialog).getByLabelText('Cílové KOC')).toHaveValue('koc2-lipova')
    expect(within(dialog).getByText(/zadost.json/)).toBeVisible()
    expect(screen.queryByText('private technical details')).not.toBeInTheDocument()
    expect(demoState.getCases()).toEqual([])
    server.resetHandlers()
    await user.click(within(dialog).getByRole('button', { name: 'Importovat a odeslat' }))
    const retry = await screen.findByRole('dialog', { name: 'Importovat a odeslat žádost?' })
    await user.click(within(retry).getByRole('button', { name: 'Importovat a odeslat' }))
    await screen.findByRole('heading', { level: 1, name: 'Pacient zatím neuveden' })
  })

  it('blocks duplicate submissions and file changes while uploading, then handles a network failure', async () => {
    let release: (() => void) | undefined
    let calls = 0
    server.use(http.post('*/api/referrals/fhir', async ({ request }) => {
      calls++
      expect(request.headers.get('X-Actor-Id')).toBe('pl-reznicek')
      const form = await request.formData()
      expect(form.get('koc_id')).toBe('koc2-lipova')
      const file = form.get('file')
      expect(typeof file === 'object' && file?.name).toBe('zadost.json')
      await new Promise<void>((resolve) => { release = resolve })
      return HttpResponse.error()
    }))
    renderApp()
    const { user, dialog } = await openImport()
    await user.selectOptions(within(dialog).getByLabelText('Cílové KOC'), 'koc2-lipova')
    await user.upload(within(dialog).getByLabelText('Vybrat FHIR JSON'), fileOf())
    await user.click(within(dialog).getByRole('button', { name: 'Importovat a odeslat' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Importovat a odeslat žádost?' })
    const submit = within(confirmation).getByRole('button', { name: 'Importovat a odeslat' })
    await user.click(submit)
    await waitFor(() => expect(calls).toBe(1))
    expect(submit).toBeDisabled()
    expect(within(dialog).getByLabelText('Cílové KOC')).toBeDisabled()
    expect(within(dialog).getByLabelText('Vybrat FHIR JSON')).toBeDisabled()
    await user.click(submit)
    await user.keyboard('{Escape}')
    expect(confirmation).toBeVisible()
    expect(calls).toBe(1)
    await act(async () => { release?.() })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Spojení s API se nezdařilo.')
    expect(within(dialog).getByText(/zadost.json/)).toBeVisible()
  })

  it('rejects an empty JSON and multiple dropped files before any upload', async () => {
    renderApp()
    const { user, dialog } = await openImport()
    await user.upload(within(dialog).getByLabelText('Vybrat FHIR JSON'), new File([], 'empty.json', { type: 'application/json' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Vyberte jeden neprázdný soubor JSON.')
    fireEvent.drop(within(dialog).getByText('Přetáhněte soubor FHIR Bundle sem nebo jej vyberte.'), { dataTransfer: { files: [fileOf(), fileOf()] } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Vyberte jeden neprázdný soubor JSON.')
    expect(within(dialog).queryByText(/zadost.json/)).not.toBeInTheDocument()
  })

  it('keeps the selected file on language change and clears it when the dialog closes or identity changes', async () => {
    renderApp()
    const { user, dialog } = await openImport()
    await user.selectOptions(within(dialog).getByLabelText('Cílové KOC'), 'koc2-lipova')
    await user.upload(within(dialog).getByLabelText('Vybrat FHIR JSON'), fileOf())
    await act(async () => { await changeLanguage('en') })
    expect(within(dialog).getByLabelText('Receiving KOC')).toHaveValue('koc2-lipova')
    expect(within(dialog).getByText(/zadost.json/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'New referral' }))
    const reopened = await screen.findByRole('dialog', { name: 'New KOC referral' })
    expect(within(reopened).getByRole('radio', { name: 'Attach documents' })).toBeChecked()
    expect(within(reopened).queryByText(/zadost.json/)).not.toBeInTheDocument()
    await user.click(within(reopened).getByRole('button', { name: 'Cancel' }))
    await act(async () => { await changeLanguage('cs') })
    await changeIdentity(user)
    await signIn(user, 'coordinator')
    expect(screen.queryByRole('button', { name: 'Nová žádost' })).not.toBeInTheDocument()
    expect(screen.queryByText(/zadost.json/)).not.toBeInTheDocument()
  })
})
