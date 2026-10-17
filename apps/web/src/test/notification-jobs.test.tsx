import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { PropsWithChildren } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../api'
import type { Job } from '../client/types.gen'
import DocumentUploader from '../components/documents/DocumentUploader'
import JobProgress from '../components/documents/JobProgress'
import { rememberJob, useIngestJob } from '../components/documents/use-document-ingest'
import { i18n } from '../i18n'
import AppNotifications from '../notifications/AppNotifications'
import { s8Case } from '../mocks/s8-data'
import * as notices from '../notifications/notify'
import ConclusionUpload from '../screens/CaseDetail/Mdt/ConclusionUpload'
import DraftAssist from '../screens/CaseDetail/Mdt/DraftAssist'
import { useAskCase } from '../screens/CaseDetail/S8/use-ask-case'
import { theme } from '../theme'
import { renderApp } from './renderApp'
import { field, openTab, signIn } from './shell'
import { server } from './setup'

const sensitive = 'private backend trace with patient details'
const actorId = 'koordinator'
function job(kind: Job['kind'], status: Job['status'] = 'running'): Job {
    return { id: `notification-${kind}`, kind, case_id: 'notification-case', status, created_at: '2026-10-21T09:00:00', error: status === 'failed' ? sensitive : null }
}
function harness() {
    const client = createQueryClient()
    function Wrapper({ children }: PropsWithChildren) {
        return <MantineProvider theme={theme} env="test"><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>{children}</QueryClientProvider></I18nextProvider></MantineProvider>
    }
    return { client, wrapper: Wrapper }
}
function entries() {
    const state = notices.notificationStore.getState()
    return [...state.notifications, ...state.queue]
}
function expectSafeNotice(key: 'jobAsk' | 'jobDraft' | 'jobIngest', wrapper: ReturnType<typeof harness>['wrapper']) {
    expect(entries()).toHaveLength(1)
    expect(entries()[0].autoClose).toBe(false)
    const view = render(<>{entries()[0].message}</>, { wrapper })
    expect(within(view.container).getByText(i18n.t(`notices.${key}`))).toBeVisible()
    expect(view.container).not.toHaveTextContent(sensitive)
}

beforeEach(() => notices.clearNotifications())
afterEach(() => notices.clearNotifications())

describe('incomplete draft results', () => {
    it('warns once for a newly completed draft without usable content, including an immediate result', async () => {
        let current: Job = { ...job('draft'), params: { kind: 'mdt_question' } }
        server.use(http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(current)))
        const { client, wrapper } = harness()
        rememberJob(client, actorId, current)
        const { result, rerender } = renderHook(() => useIngestJob(current, actorId), { wrapper })
        await waitFor(() => expect(result.current.isFetching).toBe(false))
        current = { ...current, status: 'done', draft: null }
        await act(async () => { await result.current.refetch() })
        expect(entries()).toHaveLength(1)
        expect(entries()[0].message).toBe(i18n.t('mdt.draftMissing'))
        expect(entries()[0].autoClose).toBe(false)
        await act(async () => { await result.current.refetch() })
        rerender()
        expect(entries()[0]['data-occurrences']).toBe(1)
        notices.clearNotifications()
        rememberJob(client, actorId, { ...current, id: 'immediate-draft' })
        expect(entries()).toHaveLength(1)
    })

    it('keeps a historical incomplete result quiet and offers retry without an embedded warning', async () => {
        const current: Job = { ...job('draft', 'done'), params: { kind: 'mdt_question' } }
        const onUse = vi.fn()
        const create = vi.fn(() => HttpResponse.json<Job>({ ...current, id: 'new-draft' }, { status: 202 }))
        server.use(
            http.get('*/api/cases/:id/jobs', () => HttpResponse.json<Job[]>([current])),
            http.post('*/api/cases/:id/drafts', create),
        )
        const { wrapper } = harness()
        render(<><DraftAssist caseId={current.case_id} actorId={actorId} kind="mdt_question" onUse={onUse} /><AppNotifications /></>, { wrapper })
        const retry = await screen.findByRole('button', { name: i18n.t('retry') })
        expect(entries()).toHaveLength(0)
        expect(screen.queryByText(i18n.t('mdt.draftMissing'))).not.toBeInTheDocument()
        await userEvent.setup().click(retry)
        expect(await screen.findAllByRole('alert')).toHaveLength(1)
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('mdt.draftMissing'))
        expect(document.querySelector('.mantine-Alert-root')).not.toBeInTheDocument()
        expect(onUse).not.toHaveBeenCalled()
        expect(create).toHaveBeenCalledOnce()
        await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('notices.close') }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        expect(screen.queryByText(i18n.t('mdt.draftMissing'))).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: i18n.t('retry') })).toBeEnabled()
    })
})

describe('safe job failure notifications', () => {
    it.each(['ingest_document', 'draft'] as const)('notifies once when an HTTP 200 %s job fails, not on repeated fetches or renders', async (kind) => {
        const failure = vi.spyOn(notices, 'notifyJobFailure')
        let current = job(kind)
        const read = vi.fn(() => HttpResponse.json<Job>(current))
        server.use(http.get('*/api/jobs/:id', read))
        const { client, wrapper } = harness()
        rememberJob(client, actorId, current)
        const { result, rerender } = renderHook(() => useIngestJob(job(kind), actorId), { wrapper })
        await waitFor(() => expect(read).toHaveBeenCalled())
        await waitFor(() => expect(result.current.isFetching).toBe(false))
        expect(failure).not.toHaveBeenCalled()
        current = job(kind, 'failed')
        await act(async () => { await result.current.refetch() })
        await waitFor(() => expect(result.current.data?.status).toBe('failed'))
        expect(failure).toHaveBeenCalledTimes(1)
        await act(async () => { await result.current.refetch(); await result.current.refetch() })
        rerender()
        expect(failure).toHaveBeenCalledTimes(1)
        expectSafeNotice(kind === 'draft' ? 'jobDraft' : 'jobIngest', wrapper)
    })

    it('notifies once for a failed answer received while polling without changing clinical data', async () => {
        const failure = vi.spyOn(notices, 'notifyJobFailure')
        let current = job('ask_case')
        server.use(http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(current)))
        const { client, wrapper } = harness()
        const invalidate = vi.spyOn(client, 'invalidateQueries')
        const { result, rerender } = renderHook(() => useAskCase(current.case_id, actorId, current.id), { wrapper })
        await waitFor(() => expect(result.current.job.data?.status).toBe('running'))
        current = job('ask_case', 'failed')
        await act(async () => { await result.current.job.refetch() })
        await act(async () => { await result.current.job.refetch(); await result.current.job.refetch() })
        rerender()
        expect(failure).toHaveBeenCalledTimes(1)
        expect(invalidate).not.toHaveBeenCalled()
        expectSafeNotice('jobAsk', wrapper)
    })

    it('notifies for an initially failed submission only once even when fetched again', async () => {
        const failure = vi.spyOn(notices, 'notifyJobFailure')
        const current = job('ask_case', 'failed')
        server.use(http.get('*/api/jobs/:id', () => HttpResponse.json<Job>(current)))
        const { client, wrapper } = harness()
        rememberJob(client, actorId, current)
        rememberJob(client, actorId, current)
        const { result } = renderHook(() => useAskCase(current.case_id, actorId, current.id), { wrapper })
        await act(async () => { await result.current.job.refetch() })
        expect(failure).toHaveBeenCalledTimes(1)
        expectSafeNotice('jobAsk', wrapper)
    })

    it('keeps only the status of historical failed extraction jobs without notifying on mount', () => {
        const failure = vi.spyOn(notices, 'notifyJobFailure')
        const { wrapper } = harness()
        render(<JobProgress job={job('ingest_document', 'failed')} actorId={actorId} documents={[]} />, { wrapper })
        expect(screen.getByRole('status')).toHaveTextContent(i18n.t('documents.jobStatus.failed'))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.queryByText(i18n.t('notices.jobIngest'))).not.toBeInTheDocument()
        expect(document.body).not.toHaveTextContent(sensitive)
        expect(failure).not.toHaveBeenCalled()
        expect(entries()).toHaveLength(0)
    })

    it('keeps only the status of historical failed drafts without notifying on mount', async () => {
        const failure = vi.spyOn(notices, 'notifyJobFailure')
        const current: Job = { ...job('draft', 'failed'), params: { kind: 'mdt_question' } }
        server.use(http.get('*/api/cases/:id/jobs', () => HttpResponse.json<Job[]>([current])))
        const { wrapper } = harness()
        render(<DraftAssist caseId={current.case_id} actorId={actorId} kind="mdt_question" onUse={vi.fn()} />, { wrapper })
        expect(await screen.findByText(i18n.t('documents.jobStatus.failed'))).toBeVisible()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.queryByText(i18n.t('notices.jobDraft'))).not.toBeInTheDocument()
        expect(document.body).not.toHaveTextContent(sensitive)
        expect(failure).not.toHaveBeenCalled()
        expect(entries()).toHaveLength(0)
    })

    it('does not turn a polling HTTP error into a failed-job notification', async () => {
        const failure = vi.spyOn(notices, 'notifyJobFailure')
        server.use(http.get('*/api/jobs/:id', () => HttpResponse.json({ detail: sensitive }, { status: 503 })))
        const { wrapper } = harness()
        const current = job('ask_case')
        const { result } = renderHook(() => useAskCase(current.case_id, actorId, current.id), { wrapper })
        await waitFor(() => expect(result.current.job.isError).toBe(true))
        expect(failure).not.toHaveBeenCalled()
        expect(entries().filter((entry) => entry.id === `job:${current.id}`)).toHaveLength(0)
    })
})

describe('local upload warnings', () => {
    it('warns once with all rejected names and keeps supported files ready to upload', async () => {
        const warning = vi.spyOn(notices, 'notifyWarning')
        const { wrapper } = harness()
        render(<DocumentUploader caseId="notification-case" actorId={actorId} />, { wrapper })
        const files = [new File(['invalid'], 'first.txt'), new File(['invalid'], '<private>.exe'), new File(['%PDF'], 'valid.pdf', { type: 'application/pdf' })]
        fireEvent.drop(screen.getByText(i18n.t('documents.drop')), { dataTransfer: { files } })
        expect(warning).toHaveBeenCalledTimes(1)
        expect(entries()).toHaveLength(1)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.queryByText('first.txt')).not.toBeInTheDocument()
        const message = render(<>{entries()[0].message}</>, { wrapper })
        expect(within(message.container).getByText('first.txt')).toBeVisible()
        expect(within(message.container).getByText('<private>.exe')).toBeVisible()
        expect(message.container.querySelector('private')).toBeNull()
        expect(screen.getByRole('button', { name: i18n.t('documents.upload') })).toBeEnabled()
        expect(screen.getByText('valid.pdf')).toBeVisible()
    })

    it('warns for an unsupported MDT conclusion without uploading it', async () => {
        const warning = vi.spyOn(notices, 'notifyWarning')
        const { wrapper } = harness()
        render(<ConclusionUpload caseId="notification-case" actorId={actorId} />, { wrapper })
        const user = userEvent.setup({ applyAccept: false })
        await user.upload(screen.getByLabelText(i18n.t('mdt.chooseFile')), new File(['invalid'], 'unsupported.txt', { type: 'text/plain' }))
        expect(warning).toHaveBeenCalledTimes(1)
        expect(entries()).toHaveLength(1)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        const message = render(<>{entries()[0].message}</>, { wrapper })
        expect(within(message.container).getByText('unsupported.txt')).toBeVisible()
        expect(screen.getByRole('button', { name: i18n.t('mdt.uploadAction') })).toBeDisabled()
    })
})

describe('code candidate error classification', () => {
    it.each([
        [400, 'no embedding model is configured', 'codesUnavailable'],
        [409, 'the MKN-10 code list is not loaded', 'codesUnavailable'],
        [400, 'the handover has no diagnosis', 'diagnosisRequired'],
    ] as const)('does not label a %s %s rejection as stale', async (status, detail, key) => {
        server.use(http.get('*/api/cases/:id/handover/code-candidates', () => HttpResponse.json({ detail }, { status })))
        renderApp('/', { notifications: true })
        const user = userEvent.setup()
        await signIn(user)
        await user.click(await screen.findByRole('link', { name: s8Case.patient_name }))
        await screen.findByRole('heading', { level: 1, name: s8Case.patient_name })
        await openTab(user, i18n.t('caseDetail.tabs.handover'))
        await user.click(within(field('MKN-10')).getByRole('button', { name: i18n.t('s8.suggest') }))
        expect(await screen.findByText(i18n.t(`notices.${key}`))).toBeVisible()
        expect(screen.queryByText(i18n.t('s8.stale'))).not.toBeInTheDocument()
    })
})
