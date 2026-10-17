import { Button, MantineProvider, Modal } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createQueryClient } from '../api'
import { getCaseOptions, getMdtRecordOptions } from '../client/@tanstack/react-query.gen'
import { QueryError } from '../components/DataState'
import { i18n } from '../i18n'
import AppNotifications from '../notifications/AppNotifications'
import { allowNotificationRecovery, clearNotifications, notificationStore, notifyApiError, notifyJobFailure, notifyWarning } from '../notifications/notify'
import { referenceCases } from '../mocks/reference'
import { http, HttpResponse } from 'msw'
import { server } from './setup'

function Host({ dialog = false }: { dialog?: boolean }) {
    const [open, setOpen] = useState(dialog)
    return <MantineProvider><I18nextProvider i18n={i18n}>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Modal opened={open} onClose={() => setOpen(false)} title="Editor" closeButtonProps={{ 'aria-label': 'Close editor' }}><Button>Save</Button></Modal>
        <AppNotifications />
    </I18nextProvider></MantineProvider>
}

function all() {
    const state = notificationStore.getState()
    return [...state.notifications, ...state.queue]
}

describe('notification delivery', () => {
    it('shows query failures only in the popup and preserves the local retry after dismissal', async () => {
        const error = new ApiError(503, { detail: 'private exception' })
        const retry = vi.fn()
        render(<MantineProvider><I18nextProvider i18n={i18n}>
            <QueryError error={error} retry={retry} />
            <QueryError error={error} />
            <AppNotifications />
        </I18nextProvider></MantineProvider>)
        act(() => notifyApiError(error))
        expect(await screen.findAllByRole('alert')).toHaveLength(1)
        expect(document.querySelector('.mantine-Alert-root')).not.toBeInTheDocument()
        const user = userEvent.setup({ delay: null })
        await user.click(screen.getByRole('button', { name: 'Zavřít oznámení' }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        await user.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
        expect(retry).toHaveBeenCalledOnce()
    })

    it('shows persistent error and warning notifications and dismisses them with their close buttons', async () => {
        render(<Host />)
        act(() => { notifyWarning('missing', 'Vyplňte pole Název a Datum.'); notifyApiError(new ApiError(503, { detail: 'private exception' })) })
        expect(await screen.findByText('Vyplňte pole Název a Datum.')).toBeVisible()
        expect(all()).toHaveLength(2)
        expect(screen.getAllByRole('alert')).toHaveLength(2)
        expect(all().every((entry) => entry.autoClose === false)).toBe(true)
        expect(document.body).not.toHaveTextContent('private exception')
        const user = userEvent.setup({ delay: null })
        await user.click(screen.getAllByRole('button', { name: 'Zavřít oznámení' })[0])
        await waitFor(() => expect(all()).toHaveLength(1))
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Zavřít oznámení' })).toHaveLength(1))
        await user.click(screen.getByRole('button', { name: 'Zavřít oznámení' }))
        await waitFor(() => expect(all()).toHaveLength(0))
    })

    it('updates repeated errors, bounds the queue and retains a visible overflow summary', () => {
        notifyApiError(new ApiError(503, 'a'))
        notifyApiError(new ApiError(503, 'b'))
        expect(all()).toHaveLength(1)
        expect(all()[0]['data-occurrences']).toBe(2)
        for (let index = 0; index < 30; index++) notifyWarning(`warning-${index}`, `Problem ${index}`)
        expect(all()).toHaveLength(10)
        expect(all().some((entry) => entry.id === 'notification-overflow')).toBe(true)
    })

    it('opens the queue inside a dialog with unique React keys and one live region per toast', async () => {
        const errors = vi.spyOn(console, 'error')
        render(<Host dialog />)
        await screen.findByRole('dialog', { name: 'Editor' })
        act(() => { for (let index = 0; index < 4; index++) notifyWarning(`queued-${index}`, `Problem ${index}`) })
        const expand = await screen.findByRole('button', { name: 'Zobrazit všechna' })
        await userEvent.setup({ delay: null }).click(expand)
        await waitFor(() => expect(notificationStore.getState().limit).toBe(11))
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(4))
        expect(errors.mock.calls.some((args) => args.some((value) => String(value).includes('same key')))).toBe(false)
    })

    it('does not reopen dismissed automatic errors or the same failed job', () => {
        const job = { id: 'job-once', case_id: 'case', kind: 'ask_case' as const, status: 'failed' as const, created_at: '2026-10-17T09:00:00' }
        notifyJobFailure(job)
        notifications.hide('job:job-once', notificationStore)
        notifyJobFailure(job)
        expect(all()).toHaveLength(0)
        notifyApiError(new ApiError(503, 'first'), { automatic: true })
        notifications.hide('api:connection:unavailable', notificationStore)
        notifyApiError(new ApiError(503, 'second'), { automatic: true })
        expect(all()).toHaveLength(0)
        notifyApiError(new ApiError(503, 'explicit retry'))
        expect(all()).toHaveLength(1)
    })

    it('makes dismissal reachable inside the active modal without closing that modal', async () => {
        render(<Host dialog />)
        const dialog = await screen.findByRole('dialog', { name: 'Editor' })
        act(() => notifyWarning('modal', 'Doplňte Název.'))
        const close = await within(dialog).findByRole('button', { name: 'Zavřít oznámení' })
        close.focus()
        await userEvent.setup({ delay: null }).keyboard('{Enter}')
        await waitFor(() => expect(all()).toHaveLength(0))
        expect(dialog).toBeVisible()
    })

    it.each([
        { dialog: false, method: 'mouse' },
        { dialog: false, method: 'keyboard' },
        { dialog: true, method: 'mouse' },
        { dialog: true, method: 'keyboard' },
    ])('restores focus without scrolling after $method dismissal (dialog: $dialog)', async ({ dialog, method }) => {
        render(<Host dialog={dialog} />)
        const editor = dialog ? await screen.findByRole('dialog', { name: 'Editor' }) : null
        const destination = editor
            ? within(editor).getByRole('button', { name: 'Close editor' })
            : screen.getByRole('button', { name: 'Open' })
        const focus = vi.spyOn(destination, 'focus')
        act(() => notifyWarning('scroll-position', 'Doplňte Název.'))
        const close = await screen.findByRole('button', { name: 'Zavřít oznámení' })
        const user = userEvent.setup({ delay: null })
        if (method === 'keyboard') {
            close.focus()
            await user.keyboard('{Enter}')
        } else await user.click(close)
        await waitFor(() => expect(all()).toHaveLength(0))
        expect(destination).toHaveFocus()
        expect(focus).toHaveBeenCalledWith({ preventScroll: true })
        if (editor) expect(editor).toBeVisible()
    })

    it('reports a dismissed query error again after explicit retry or recovery', async () => {
        let recovered = false
        server.use(http.get('*/api/cases/:id', () => recovered
            ? HttpResponse.json(referenceCases[0])
            : HttpResponse.json({ detail: 'private failure' }, { status: 500 })))
        const client = createQueryClient()
        const options = getCaseOptions({ path: { case_id: referenceCases[0].id } })
        const fail = () => expect(client.fetchQuery(options)).rejects.toBeInstanceOf(ApiError)
        await fail()
        notifications.hide(all()[0].id ?? '', notificationStore)
        await fail()
        expect(all()).toHaveLength(0)
        allowNotificationRecovery()
        await fail()
        expect(all()).toHaveLength(1)
        notifications.hide(all()[0].id ?? '', notificationStore)
        recovered = true
        await client.fetchQuery(options)
        recovered = false
        await fail()
        expect(all()).toHaveLength(1)
        client.clear()
    })

    it('ignores cancellations and expected missing MDT records but reports unexpected read failures', async () => {
        server.use(http.get('*/api/cases/:id/mdt/record', () => HttpResponse.json({ detail: 'no MDT record yet' }, { status: 404 })),
            http.get('*/api/cases/:id', () => HttpResponse.json({ detail: 'private sql failure' }, { status: 500 })))
        const client = createQueryClient()
        await expect(client.fetchQuery(getMdtRecordOptions({ path: { case_id: 'case' } }))).rejects.toBeInstanceOf(ApiError)
        notifyApiError(new ApiError(undefined, new DOMException('cancelled', 'AbortError')))
        expect(all()).toHaveLength(0)
        await expect(client.fetchQuery(getCaseOptions({ path: { case_id: 'case' } }))).rejects.toBeInstanceOf(ApiError)
        expect(all()).toHaveLength(1)
        client.clear()
    })

    it('keeps errors after time advances and clears them on explicit reset', async () => {
        vi.useFakeTimers()
        try {
            notifyApiError(new ApiError(500, 'private'))
            await vi.advanceTimersByTimeAsync(120_000)
            expect(all()).toHaveLength(1)
            clearNotifications()
            expect(all()).toHaveLength(0)
        } finally { vi.useRealTimers() }
    })
})
