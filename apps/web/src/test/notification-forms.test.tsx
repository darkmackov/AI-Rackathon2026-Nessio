import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import FormErrorSummary from '../components/FormErrorSummary'
import WorkflowForm from '../components/workflow/WorkflowForm'
import HandoverFieldForm from '../components/handover/HandoverFieldForm'
import DocumentMetadataForm from '../components/documents/DocumentMetadataForm'
import ExaminationForm from '../screens/Referral/ExaminationForm'
import TaskSetsDialog from '../screens/CaseDetail/TaskSetsDialog'
import SessionProvider from '../SessionProvider'
import type { TaskSet } from '../client/types.gen'
import { http, HttpResponse } from 'msw'
import { i18n } from '../i18n'
import { clearNotifications, notificationStore } from '../notifications/notify'
import { referenceDocuments } from '../mocks/reference-data'
import { server } from './setup'
import { renderApp } from './renderApp'
import { signIn } from './shell'

beforeEach(() => clearNotifications())

function renderForm(node: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return render(<MantineProvider env="test"><I18nextProvider i18n={i18n}><QueryClientProvider client={client}>{node}</QueryClientProvider></I18nextProvider></MantineProvider>)
}

describe('form error summaries', () => {
    it('focuses once per failed submit without stealing focus when errors change', () => {
        const view = render(<FormErrorSummary errors={['Title: Required']} focusKey={1} />, {
            wrapper: ({ children }) => <MantineProvider env="test"><I18nextProvider i18n={i18n}>{children}<input aria-label="Draft" /></I18nextProvider></MantineProvider>,
        })
        expect(screen.getByRole('alert')).toHaveFocus()
        screen.getByLabelText('Draft').focus()
        fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'preserved' } })
        view.rerender(<FormErrorSummary errors={['Owner: Required']} focusKey={1} />)
        expect(screen.getByLabelText('Draft')).toHaveFocus()
        view.rerender(<FormErrorSummary errors={[]} focusKey={1} />)
        view.rerender(<FormErrorSummary errors={['Owner: Required']} focusKey={1} />)
        expect(screen.getByLabelText('Draft')).toHaveFocus()
        view.rerender(<FormErrorSummary errors={['Owner: Required']} focusKey={2} />)
        expect(screen.getByRole('alert')).toHaveFocus()
        expect(screen.getByLabelText('Draft')).toHaveValue('preserved')
    })

    it('keeps the errors-only prop compatible, including duplicate messages', () => {
        render(<MantineProvider env="test"><FormErrorSummary errors={['Required', 'Required']} /></MantineProvider>)
        expect(screen.getAllByRole('listitem')).toHaveLength(2)
        expect(screen.getByRole('alert')).toHaveFocus()
    })
})

describe('workflow form validation', () => {
    it('lists every invalid label, warns only on submit and refocuses on a repeat failure', async () => {
        const submit = vi.fn()
        renderForm(<WorkflowForm fields={[{ name: 'title', label: 'Task title', required: true }, { name: 'owner', label: 'Assigned doctor', required: true }]} initial={{ title: '', owner: '' }} submit={submit} onSaved={vi.fn()} />)
        await userEvent.click(screen.getByLabelText('Task title', { exact: false }))
        await userEvent.tab()
        expect(notificationStore.getState().notifications).toHaveLength(0)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        const summary = screen.getByRole('alert')
        expect(summary).toHaveFocus()
        expect(within(summary).getAllByRole('listitem').map((item) => item.textContent)).toEqual([`Task title: ${i18n.t('workflow.required')}`, `Assigned doctor: ${i18n.t('workflow.required')}`])
        expect(notificationStore.getState().notifications).toHaveLength(1)
        expect(notificationStore.getState().notifications[0].message).toContain('Task title, Assigned doctor')
        await userEvent.type(screen.getByLabelText('Task title', { exact: false }), 'Draft title')
        expect(screen.getByLabelText('Task title', { exact: false })).toHaveFocus()
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        expect(screen.getByRole('alert')).toHaveFocus()
        expect(within(screen.getByRole('alert')).getAllByRole('listitem')).toHaveLength(1)
        expect(screen.getByRole('alert')).toHaveTextContent('Assigned doctor:')
        expect(submit).not.toHaveBeenCalled()
    })

    it('validates a required multi-select on blur without a toast', async () => {
        renderForm(<WorkflowForm fields={[{ name: 'dependencies', label: 'Dependencies', type: 'multi', required: true, choices: [{ value: 'task1', label: 'Task 1' }] }]} initial={{ dependencies: '' }} submit={vi.fn()} onSaved={vi.fn()} />)
        await userEvent.click(screen.getByRole('combobox', { name: /Dependencies/ }))
        await userEvent.tab()
        expect(screen.getByText(i18n.t('workflow.required'))).toBeVisible()
        expect(notificationStore.getState().notifications).toHaveLength(0)
    })

    it('maps backend owner errors without exposing rejected input and keeps the draft', async () => {
        const submit = vi.fn().mockRejectedValue(new ApiError(422, { detail: [{ loc: ['body', 'owner_id'], type: 'string_type', msg: 'private diagnosis', input: 'secret input' }] }))
        renderForm(<WorkflowForm fields={[{ name: 'owner', label: 'Assigned doctor' }]} initial={{ owner: 'draft-owner' }} submit={submit} onSaved={vi.fn()} />)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        expect(await screen.findByText(/^Assigned doctor:/)).toBeVisible()
        expect(screen.getByLabelText('Assigned doctor')).toHaveValue('draft-owner')
        expect(document.body).not.toHaveTextContent('private diagnosis')
        expect(document.body).not.toHaveTextContent('secret input')
        expect(notificationStore.getState().notifications).toHaveLength(0)
    })

    it('maps local workflow names and explicit task-set role aliases', async () => {
        const names = { owner: 'Owner', coordinator: 'Coordinator', board: 'Board', date: 'MDT date', document: 'Result document', dependencies: 'Dependencies', role0: 'Assigned coordinator' }
        const paths = ['owner_id', 'coordinator_id', 'mdt_board_id', 'mdt_date', 'result_document_id', 'depends_on', 'owners.coordinator']
        const submit = vi.fn().mockRejectedValue(new ApiError(422, { detail: paths.map((path) => ({ loc: ['body', ...path.split('.')], type: 'string_type', msg: 'Rejected input' })) }))
        renderForm(<WorkflowForm fields={Object.entries(names).map(([name, label]) => ({ name, label }))} initial={Object.fromEntries(Object.keys(names).map((name) => [name, 'Draft']))} errorAliases={{ 'owners.coordinator': 'role0' }} submit={submit} onSaved={vi.fn()} />)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        await screen.findByText(/^Assigned coordinator:/)
        expect(within(screen.getAllByRole('alert')[0]).getAllByRole('listitem')).toHaveLength(7)
        for (const label of Object.values(names)) expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    })

    it('validates impossible calendar dates with the existing date helper', async () => {
        const submit = vi.fn()
        renderForm(<WorkflowForm fields={[{ name: 'date', label: 'MDT date', type: 'date' }]} initial={{ date: '2026-02-29' }} submit={submit} onSaved={vi.fn()} />)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        expect(screen.getByRole('alert')).toHaveTextContent(`MDT date: ${i18n.t('documents.invalidDate')}`)
        expect(submit).not.toHaveBeenCalled()
    })

    it('does not clear client errors when an unknown backend error arrives', async () => {
        let reject: (error: unknown) => void = () => { }
        const pending = new Promise((_, rejectPromise) => { reject = rejectPromise })
        renderForm(<WorkflowForm fields={[{ name: 'title', label: 'Task title', required: true }]} initial={{ title: 'Draft' }} submit={() => pending} onSaved={vi.fn()} />)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        await userEvent.clear(screen.getByLabelText(/Task title/))
        await userEvent.tab()
        expect(screen.getByLabelText(/Task title/)).toHaveAttribute('aria-invalid', 'true')
        await act(async () => { reject(new ApiError(500, { detail: 'private unknown backend error' })); await pending.catch(() => {}) })
        expect(screen.getByLabelText(/Task title/)).toHaveAttribute('aria-invalid', 'true')
        expect(document.body).not.toHaveTextContent('private unknown backend error')
    })
})

describe('clinical form validation', () => {
    it('reports only the invalid examination field, not all four fields', async () => {
        renderForm(<ExaminationForm caseId="case-a" actorId="koordinator" close={vi.fn()} saved={vi.fn()} />)
        fireEvent.change(screen.getByLabelText(i18n.t('referral.examDate')), { target: { value: '2026-10-17' } })
        await userEvent.type(screen.getByLabelText(i18n.t('referral.examType')), 'CT')
        await userEvent.type(screen.getByLabelText(i18n.t('referral.examResult')), 'Preserved clinical draft')
        expect(notificationStore.getState().notifications).toHaveLength(0)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('handoverEdit.save') }))
        const summary = screen.getByRole('alert')
        expect(summary).toHaveFocus()
        expect(within(summary).getAllByRole('listitem')).toHaveLength(1)
        expect(summary).toHaveTextContent(`${i18n.t('referral.examPlace')}:`)
        expect(notificationStore.getState().notifications[0].message).toBe(i18n.t('notices.formFields', { fields: i18n.t('referral.examPlace') }))
        expect(screen.getByLabelText(i18n.t('referral.examResult'))).toHaveValue('Preserved clinical draft')
    })

    it('lists all four invalid examination labels individually', async () => {
        renderForm(<ExaminationForm caseId="case-a" actorId="koordinator" close={vi.fn()} saved={vi.fn()} />)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('handoverEdit.save') }))
        const items = within(screen.getByRole('alert')).getAllByRole('listitem')
        expect(items).toHaveLength(4)
        for (const key of ['examDate', 'examPlace', 'examType', 'examResult']) expect(screen.getByRole('alert')).toHaveTextContent(`${i18n.t(`referral.${key}`)}:`)
    })

    it('uses the actual clinical field label for a missing handover value', async () => {
        renderForm(<HandoverFieldForm caseId="case-a" actorId="koordinator" path="performance_status" close={vi.fn()} saved={vi.fn()} />)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('handoverEdit.save') }))
        expect(screen.getByRole('alert')).toHaveTextContent(`${i18n.t('caseDetail.performance')}:`)
        expect(notificationStore.getState().notifications[0].message).toContain(i18n.t('caseDetail.performance'))
        await userEvent.click(screen.getByLabelText(i18n.t('handoverEdit.notAvailable')))
        expect(screen.getByRole('button', { name: i18n.t('handoverEdit.save') })).toBeEnabled()
    })

    it('maps rejected document dates to the date field without leaking backend text or losing metadata drafts', async () => {
        server.use(http.patch('*/api/documents/:id', () => HttpResponse.json({ detail: [{ loc: ['body', 'document_date'], type: 'date_parsing', msg: 'private backend data', input: 'private rejected date' }] }, { status: 422 })))
        renderForm(<DocumentMetadataForm document={referenceDocuments[0]} caseId="case-a" actorId="koordinator" onClose={vi.fn()} />)
        fireEvent.change(screen.getByLabelText(i18n.t('documents.documentDate')), { target: { value: '2026-10-17' } })
        await userEvent.clear(screen.getByLabelText(i18n.t('documents.metadata.title')))
        await userEvent.type(screen.getByLabelText(i18n.t('documents.metadata.title')), 'Preserved metadata draft')
        await userEvent.click(screen.getByRole('button', { name: i18n.t('documents.save') }))
        expect(await screen.findByText(new RegExp(`^${i18n.t('documents.documentDate')}:`))).toBeVisible()
        expect(screen.getByLabelText(i18n.t('documents.documentDate'))).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByLabelText(i18n.t('documents.metadata.title'))).toHaveValue('Preserved metadata draft')
        expect(document.body).not.toHaveTextContent('private backend data')
        expect(document.body).not.toHaveTextContent('private rejected date')
        expect(notificationStore.getState().notifications).toHaveLength(0)
    })
})

describe('task set, referral and clock validation', () => {
    it('keeps key, title, kind and owner errors distinct for each numbered step', async () => {
        const taskSet: TaskSet = { id: 'invalid-set', name: 'Draft set', steps: [{ key: '', title: '', kind: '', owner_role: '' }, { key: '', title: '', kind: '', owner_role: '' }] }
        server.use(http.get('*/api/task-sets', () => HttpResponse.json([taskSet])))
        renderForm(<SessionProvider><TaskSetsDialog caseId="case-a" opened onClose={vi.fn()} onSaved={vi.fn()} /></SessionProvider>)
        await userEvent.click(await screen.findByRole('button', { name: i18n.t('workflow.editSet') }))
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        const summary = screen.getByRole('alert')
        expect(summary).toHaveFocus()
        expect(within(summary).getAllByRole('listitem')).toHaveLength(8)
        for (const number of [1, 2]) for (const key of ['stepKey', 'title', 'kind', 'ownerRole']) {
            expect(summary).toHaveTextContent(`${i18n.t('notices.step', { number })}: ${i18n.t(`workflow.${key}`)}:`)
            expect(notificationStore.getState().notifications[0].message).toContain(`${i18n.t('notices.step', { number })}: ${i18n.t(`workflow.${key}`)}`)
        }
    })

    it('reports the steps list itself when a set has no steps', async () => {
        renderForm(<SessionProvider><TaskSetsDialog caseId="case-a" opened onClose={vi.fn()} onSaved={vi.fn()} /></SessionProvider>)
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.newSet') }))
        await userEvent.type(screen.getByLabelText(i18n.t('workflow.setName'), { exact: false }), 'Draft set')
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.removeStep') }))
        await userEvent.click(screen.getByRole('button', { name: i18n.t('workflow.save') }))
        expect(within(screen.getByRole('alert')).getAllByRole('listitem')).toHaveLength(1)
        expect(screen.getByRole('alert')).toHaveTextContent(`${i18n.t('workflow.steps')}:`)
        expect(notificationStore.getState().notifications[0].message).toContain(i18n.t('workflow.steps'))
    })

    it('labels a missing target KOC on submit without a blur toast', async () => {
        renderApp()
        const user = userEvent.setup()
        await signIn(user, 'referring_doctor')
        await user.click(screen.getByRole('button', { name: i18n.t('referral.create') }))
        const dialog = await screen.findByRole('dialog', { name: i18n.t('referral.createTitle') })
        await user.click(await within(dialog).findByLabelText(i18n.t('referral.koc')))
        await user.tab()
        expect(notificationStore.getState().notifications).toHaveLength(0)
        await user.click(within(dialog).getByRole('button', { name: i18n.t('referral.start') }))
        expect(within(dialog).getByRole('alert')).toHaveTextContent(`${i18n.t('referral.koc')}:`)
        expect(notificationStore.getState().notifications[0].message).toContain(i18n.t('referral.koc'))
    })

    it('labels the invalid demo time on submit', async () => {
        renderApp()
        const user = userEvent.setup()
        await signIn(user)
        await user.click(screen.getByRole('button', { name: 'Demo' }))
        const drawer = await screen.findByRole('dialog', { name: i18n.t('demoTitle') })
        await user.clear(await within(drawer).findByLabelText(i18n.t('dateTime')))
        await user.tab()
        expect(notificationStore.getState().notifications).toHaveLength(0)
        await user.click(within(drawer).getByRole('button', { name: i18n.t('applyTime') }))
        expect(within(drawer).getByRole('alert')).toHaveTextContent(`${i18n.t('dateTime')}:`)
        expect(notificationStore.getState().notifications[0].message).toContain(i18n.t('dateTime'))
    })
})
