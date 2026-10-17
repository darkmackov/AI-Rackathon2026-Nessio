import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { actorHeaders } from '../api'
import { createMdtSnapshotMutation } from '../client/@tanstack/react-query.gen'
import type { HttpValidationError } from '../client/types.gen'
import { i18n } from '../i18n'
import { s4CaseId } from '../mocks/coordinator-state'
import * as notifications from '../notifications/notify'
import { completeCase, mutation, resolveBlockers } from './mdt-fixtures'
import { renderApp } from './renderApp'
import { openTab, signIn, type User } from './shell'
import { demoState, server } from './setup'
import * as mdtSteps from '../screens/CaseDetail/Mdt/NextStep'

async function openMdt(user: User) {
    await signIn(user)
    await user.click(await screen.findByRole('link', { name: 'Fiktivní pacient S4' }))
    await screen.findByRole('heading', { level: 1, name: 'Fiktivní pacient S4' })
    return openTab(user, 'MDT')
}

async function openRecord(user: User) {
    completeCase(); resolveBlockers()
    await mutation(createMdtSnapshotMutation(), { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId }, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
    renderApp(); await openMdt(user)
    await user.click(await screen.findByRole('button', { name: 'Upravit zápis' }))
    return within(await screen.findByRole('region', { name: 'Upravit zápis' }))
}

async function openRoster(user: User) {
    completeCase(); renderApp(); await openMdt(user)
    await user.click(await screen.findByRole('button', { name: 'Upravit členy týmu' }))
    return within(await screen.findByRole('dialog', { name: 'Členové MDT' }))
}

describe('MDT field notifications', () => {
    it.each([409, 500])('keeps background controls stable while snapshot confirmation is pending, then shows the %s error in a popup', async (status) => {
        completeCase()
        const { queryClient } = renderApp('/', { notifications: true })
        const user = userEvent.setup()
        await openMdt(user)
        await user.click(await screen.findByRole('button', { name: 'Připravit podklad pro MDT' }))
        const dialog = await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' })
        const progressRender = vi.spyOn(mdtSteps, 'MdtProgress')
        const background = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
            .filter((button) => !button.closest('[role="dialog"]'))
            .map((button) => ({ button, disabled: button.disabled, text: button.textContent, content: button.querySelector('.mantine-Button-inner') }))
        let respond = () => {}
        const response = new Promise<void>((resolve) => { respond = resolve })
        const request = vi.fn(async () => {
            await response
            return HttpResponse.json({ detail: status === 409 ? 'unresolved blockers: finding-1' : 'private backend detail' }, { status })
        })
        server.use(http.post('*/api/cases/:id/mdt/snapshot', request))
        const confirm = within(dialog).getByRole('button', { name: 'Potvrdit a připravit' })
        const layout = Array.from(confirm.parentElement!.parentElement!.children)
        const date = screen.getByLabelText('Datum MDT')
        const dateValue = date.getAttribute('value')
        const calendar = date.closest('.mantine-InputWrapper-root')!.querySelector('[data-calendar-icon]')!
        expect(calendar).toBeVisible()
        expect(within(dialog).queryByText('Zobrazit k řešení')).not.toBeInTheDocument()
        expect(layout).toHaveLength(3)
        await user.click(confirm)
        try {
            await waitFor(() => expect(request).toHaveBeenCalledOnce())
            expect(queryClient.isMutating()).toBe(1)
            expect(confirm).toHaveAttribute('aria-busy', 'true')
            expect(confirm).not.toHaveAttribute('data-loading')
            expect(confirm).toHaveTextContent('Potvrdit a připravit')
            expect(confirm.querySelector('.mantine-Button-loader')).not.toBeInTheDocument()
            expect(confirm).toBeDisabled()
            expect(within(dialog).getByRole('button', { name: 'Zrušit' })).toBeDisabled()
            expect(Array.from(confirm.parentElement!.parentElement!.children)).toEqual(layout)
            expect(within(dialog).queryByText('Zobrazit k řešení')).not.toBeInTheDocument()
            expect(progressRender).not.toHaveBeenCalled()
            expect(screen.getByLabelText('Datum MDT')).toBe(date)
            expect(date).toHaveAttribute('type', 'date')
            expect(date).toBeDisabled()
            expect(date).toHaveAttribute('data-pending', 'true')
            expect(date.closest('.mantine-InputWrapper-root')!.querySelector('[data-calendar-icon]')).toBe(calendar)
            expect(calendar).toBeVisible()
            for (const { button, disabled, text, content } of background) {
                expect(button).toBeInTheDocument()
                expect(button.textContent).toBe(text)
                if (content) expect(button.querySelector('.mantine-Button-inner')).toBe(content)
                expect(button).not.toHaveAttribute('data-loading')
                if (!disabled && button.disabled) expect(button).toHaveAttribute('data-pending', 'true')
            }
            await user.click(confirm)
            expect(request).toHaveBeenCalledOnce()
            await user.keyboard('{Escape}')
            expect(dialog).toBeVisible()
        } finally {
            await act(async () => { respond(); await response })
        }
        expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t(status === 409 ? 'notices.blockers' : 'notices.server'))
        expect(dialog).toBeVisible()
        expect(confirm).toBeEnabled()
        expect(confirm).not.toHaveAttribute('aria-busy')
        expect(Array.from(confirm.parentElement!.parentElement!.children)).toEqual(layout)
        const recovery = screen.queryByRole('button', { name: 'Zobrazit k řešení' })
        expect(recovery !== null).toBe(status === 409)
        if (recovery) expect(recovery.closest('[data-notification]')).toBeInTheDocument()
        expect(progressRender).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Datum MDT')).toBe(date)
        expect(date).toHaveValue(dateValue)
        expect(date).toBeEnabled()
        expect(demoState.mdt.snapshot(s4CaseId)).toBeUndefined()
        expect(document.body).not.toHaveTextContent('private backend detail')
        for (const { button, disabled } of background) expect(button.disabled).toBe(disabled)

        // A retry must keep the same compact dialog and the contextual popup action.
        let finishRetry = () => {}
        const retryResponse = new Promise<void>((resolve) => { finishRetry = resolve })
        server.use(http.post('*/api/cases/:id/mdt/snapshot', async () => {
            await retryResponse
            return HttpResponse.json({ detail: 'private backend detail' }, { status: 500 })
        }))
        await user.click(confirm)
        try {
            await waitFor(() => expect(confirm).toHaveAttribute('aria-busy', 'true'))
            expect(Array.from(confirm.parentElement!.parentElement!.children)).toEqual(layout)
            if (recovery) expect(recovery).toBeDisabled()
            expect(calendar).toBeVisible()
            expect(progressRender).not.toHaveBeenCalled()
        } finally {
            await act(async () => { finishRetry(); await retryResponse })
        }
        await waitFor(() => expect(confirm).toBeEnabled())
        expect(Array.from(confirm.parentElement!.parentElement!.children)).toEqual(layout)
    })

    it('reports every missing record row field without naming valid fields and validates on blur', async () => {
        const warning = vi.spyOn(notifications, 'notifyWarning').mockImplementation(() => { })
        const user = userEvent.setup(), editor = await openRecord(user)
        fireEvent.change(editor.getByLabelText('Jméno a příjmení (1)'), { target: { value: '' } })
        expect(editor.getByLabelText('Jméno a příjmení (1)')).not.toHaveAttribute('aria-invalid', 'true')
        fireEvent.blur(editor.getByLabelText('Jméno a příjmení (1)'))
        expect(editor.getByLabelText('Jméno a příjmení (1)')).toHaveAttribute('aria-invalid', 'true')
        expect(warning).not.toHaveBeenCalled()
        await user.click(editor.getByRole('button', { name: 'Přidat člena' }))
        const memberNames = editor.getAllByLabelText(/^Jméno a příjmení \(/)
        const memberNumber = memberNames.length
        await user.click(editor.getByRole('button', { name: 'Přidat výsledek' }))
        fireEvent.change(editor.getByLabelText('Datum vyšetření (1)'), { target: { value: '2026-10-20' } })
        fireEvent.change(editor.getByLabelText('Vyšetření (1)'), { target: { value: 'Fiktivní vyšetření' } })
        await user.click(editor.getByRole('button', { name: 'Přidat výsledek' }))
        fireEvent.change(editor.getByLabelText('Výsledek (2)'), { target: { value: 'Fiktivní výsledek' } })
        await user.click(editor.getByRole('button', { name: 'Uložit' }))
        const summary = editor.getByRole('alert')
        const fields = ['Jméno a příjmení (1)', `Jméno a příjmení (${memberNumber})`, `Odbornost (${memberNumber})`, 'Výsledek (1)', 'Datum vyšetření (2)', 'Vyšetření (2)']
        expect(within(summary).getAllByRole('listitem')).toHaveLength(fields.length)
        for (const field of fields) expect(summary).toHaveTextContent(`${field}:`)
        expect(summary).not.toHaveTextContent('Odbornost (1):')
        expect(summary).not.toHaveTextContent('Datum vyšetření (1):')
        expect(summary).not.toHaveTextContent('Vyšetření (1):')
        expect(summary).not.toHaveTextContent('Výsledek (2):')
        expect(summary).toHaveFocus()
        expect(warning).toHaveBeenCalledExactlyOnceWith(`form:mdt-record:${s4CaseId}`, i18n.t('notices.formFields', { fields: fields.join(', ') }))
        expect(editor.getByLabelText('Datum vyšetření (2)')).toHaveAttribute('aria-invalid', 'true')
        expect(editor.getByLabelText('Výsledek (1)')).toHaveAttribute('aria-invalid', 'true')
        expect(editor.getByLabelText('Výsledek (2)')).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('reports exact roster fields across rows and keeps valid names out of the warning', async () => {
        const warning = vi.spyOn(notifications, 'notifyWarning').mockImplementation(() => { })
        const user = userEvent.setup(), roster = await openRoster(user)
        fireEvent.change(roster.getByLabelText('Odbornost (1)'), { target: { value: '' } })
        expect(roster.getByLabelText('Odbornost (1)')).not.toHaveAttribute('aria-invalid', 'true')
        fireEvent.blur(roster.getByLabelText('Odbornost (1)'))
        expect(roster.getByLabelText('Odbornost (1)')).toHaveAttribute('aria-invalid', 'true')
        expect(warning).not.toHaveBeenCalled()
        await user.click(roster.getByRole('button', { name: 'Přidat člena' }))
        const memberNumber = roster.getAllByLabelText(/^Jméno a příjmení \(/).length
        await user.click(roster.getByRole('button', { name: 'Uložit' }))
        const summary = roster.getByRole('alert')
        const fields = ['Odbornost (1)', `Jméno a příjmení (${memberNumber})`, `Odbornost (${memberNumber})`]
        expect(within(summary).getAllByRole('listitem')).toHaveLength(fields.length)
        for (const field of fields) expect(summary).toHaveTextContent(`${field}:`)
        expect(summary).not.toHaveTextContent('Jméno a příjmení (1):')
        expect(summary).toHaveFocus()
        expect(warning).toHaveBeenCalledExactlyOnceWith('form:mdt-roster:mdt-git-lipova', i18n.t('notices.formFields', { fields: fields.join(', ') }))
    })

    it('still saves an empty roster without adding a required-member rule', async () => {
        const warning = vi.spyOn(notifications, 'notifyWarning').mockImplementation(() => { })
        const user = userEvent.setup(), roster = await openRoster(user)
        while (roster.queryAllByLabelText(/^Jméno a příjmení \(/).length) {
            await user.click(roster.getByRole('button', { name: i18n.t('mdt.removeMember', { number: 1 }) }))
        }
        await user.click(roster.getByRole('button', { name: 'Uložit' }))
        expect(await screen.findByText('Členové MDT týmu byli uloženi.')).toBeVisible()
        expect(demoState.mdt.boards().find((board) => board.id === 'mdt-git-lipova')?.members).toEqual([])
        expect(warning).not.toHaveBeenCalled()
    })

    it('maps backend record errors to nested fields and local aliases without losing the draft', async () => {
        const user = userEvent.setup(), editor = await openRecord(user)
        const question = 'Rozepsaná fiktivní otázka'
        fireEvent.change(editor.getByLabelText(i18n.t('mdt.question')), { target: { value: question } })
        await user.click(editor.getByRole('button', { name: 'Přidat výsledek' }))
        fireEvent.change(editor.getByLabelText('Datum vyšetření (1)'), { target: { value: '2026-10-20' } })
        fireEvent.change(editor.getByLabelText('Vyšetření (1)'), { target: { value: 'Fiktivní kontrola' } })
        fireEvent.change(editor.getByLabelText('Výsledek (1)'), { target: { value: 'Rozepsaný fiktivní výsledek' } })
        server.use(http.patch('*/api/cases/:id/mdt/record', () => HttpResponse.json<HttpValidationError>({
            detail: [
                { loc: ['body', 'members', 0, 'specialty'], type: 'string_type', msg: 'private backend detail' },
                { loc: ['body', 'results', 0, 'result'], type: 'string_type', msg: 'private backend detail' },
                { loc: ['body', 'mdt_question'], type: 'string_type', msg: 'private backend detail' },
                { loc: ['body', 'diagnosis_name'], type: 'string_type', msg: 'private backend detail' },
                { loc: ['body', 'diagnosis_code'], type: 'string_type', msg: 'private backend detail' },
            ]
        }, { status: 422 })))
        await user.click(editor.getByRole('button', { name: 'Uložit' }))
        const problem = await editor.findByText(`Odbornost (1): ${i18n.t('notices.invalidField', { field: 'Odbornost (1)' })}`)
        expect(problem).toBeVisible()
        expect(editor.getByLabelText('Odbornost (1)')).toHaveAttribute('aria-invalid', 'true')
        expect(editor.getByLabelText('Výsledek (1)')).toHaveValue('Rozepsaný fiktivní výsledek')
        expect(editor.getByLabelText('Výsledek (1)')).toHaveAttribute('aria-invalid', 'true')
        for (const field of ['mdt.question', 'mdt.diagnosis', 'mdt.code']) expect(editor.getByLabelText(i18n.t(field))).toHaveAttribute('aria-invalid', 'true')
        expect(editor.getByLabelText(i18n.t('mdt.question'))).toHaveValue(question)
        expect(editor.getByLabelText('Datum vyšetření (1)')).not.toHaveAttribute('aria-invalid', 'true')
        expect(editor.queryByText(/private backend detail/)).not.toBeInTheDocument()
    })

    it('maps backend roster errors without replacing entered members', async () => {
        const user = userEvent.setup(), roster = await openRoster(user)
        fireEvent.change(roster.getByLabelText('Jméno a příjmení (1)'), { target: { value: 'Fiktivní rozepsaný člen' } })
        server.use(http.put('*/api/mdt-boards/:id/members', () => HttpResponse.json<HttpValidationError>({
            detail: [
                { loc: ['body', 'members', 0, 'specialty'], type: 'missing', msg: 'private backend detail' },
            ]
        }, { status: 422 })))
        await user.click(roster.getByRole('button', { name: 'Uložit' }))
        expect(await roster.findByText(`Odbornost (1): ${i18n.t('notices.requiredField', { field: 'Odbornost (1)' })}`)).toBeVisible()
        expect(roster.getByLabelText('Odbornost (1)')).toHaveAttribute('aria-invalid', 'true')
        expect(roster.getByLabelText('Jméno a příjmení (1)')).toHaveValue('Fiktivní rozepsaný člen')
        expect(roster.getByLabelText('Jméno a příjmení (1)')).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('names board and date on invalid snapshot submission and excludes a corrected board', async () => {
        completeCase()
        const warning = vi.spyOn(notifications, 'notifyWarning').mockImplementation(() => { })
        renderApp(); const user = userEvent.setup(); await openMdt(user)
        const board = await screen.findByLabelText('MDT tým'), date = screen.getByLabelText('Datum MDT')
        fireEvent.change(board, { target: { value: '' } })
        fireEvent.change(date, { target: { value: '' } })
        expect(date).not.toHaveAttribute('aria-invalid', 'true')
        fireEvent.blur(date)
        expect(date).toHaveAttribute('aria-invalid', 'true')
        expect(warning).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
        let summary = screen.getByRole('alert')
        expect(within(summary).getAllByRole('listitem')).toHaveLength(2)
        expect(summary).toHaveTextContent('MDT tým:')
        expect(summary).toHaveTextContent('Datum MDT:')
        expect(warning).toHaveBeenLastCalledWith(`form:mdt-snapshot:${s4CaseId}`, i18n.t('notices.formFields', { fields: 'MDT tým, Datum MDT' }))
        fireEvent.change(board, { target: { value: 'mdt-git-lipova' } })
        fireEvent.blur(board)
        await user.click(screen.getByRole('button', { name: 'Připravit podklad pro MDT' }))
        summary = screen.getByRole('alert')
        expect(within(summary).getAllByRole('listitem')).toHaveLength(1)
        expect(summary).not.toHaveTextContent('MDT tým:')
        expect(warning).toHaveBeenLastCalledWith(`form:mdt-snapshot:${s4CaseId}`, i18n.t('notices.formFields', { fields: 'Datum MDT' }))
    })

    it('preserves snapshot values and backend field messages after closing the confirmation', async () => {
        completeCase(); renderApp('/', { notifications: true }); const user = userEvent.setup(); await openMdt(user)
        server.use(http.post('*/api/cases/:id/mdt/snapshot', () => HttpResponse.json<HttpValidationError>({
            detail: [
                { loc: ['body', 'board_id'], type: 'string_type', msg: 'private backend detail' },
                { loc: ['body', 'mdt_date'], type: 'string_type', msg: 'private backend detail' },
            ]
        }, { status: 422 })))
        await user.click(await screen.findByRole('button', { name: 'Připravit podklad pro MDT' }))
        const dialog = within(await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' }))
        await user.click(dialog.getByRole('button', { name: 'Potvrdit a připravit' }))
        expect(await screen.findByText(i18n.t('notices.validation'))).toBeVisible()
        await user.click(dialog.getByRole('button', { name: 'Zrušit' }))
        expect(await screen.findByText(`MDT tým: ${i18n.t('notices.invalidField', { field: 'MDT tým' })}`)).toBeVisible()
        expect(screen.getByLabelText('MDT tým')).toHaveValue('mdt-git-lipova')
        expect(screen.getByLabelText('Datum MDT')).toHaveValue('2026-10-21')
        expect(screen.getByLabelText('MDT tým')).toHaveAccessibleDescription(i18n.t('notices.invalidField', { field: 'MDT tým' }))
        expect(screen.getByLabelText('Datum MDT')).toHaveAccessibleDescription(i18n.t('notices.invalidField', { field: 'Datum MDT' }))
        expect(screen.queryByText(/private backend detail/)).not.toBeInTheDocument()
    })

    it.each([
        { detail: 'unresolved blockers: finding-1', blockers: true },
        { detail: 'documents still processing: job-1', blockers: false },
        { detail: 'the handover uses documents received after 2026-10-21: doc-1', blockers: false },
        { detail: 'unrecognized conflict', blockers: false },
    ])('shows the findings action only for normalized blockers: $detail', async ({ detail, blockers }) => {
        completeCase(); renderApp('/', { notifications: true }); const user = userEvent.setup(); await openMdt(user)
        server.use(http.post('*/api/cases/:id/mdt/snapshot', () => HttpResponse.json({ detail }, { status: 409 })))
        await user.click(await screen.findByRole('button', { name: 'Připravit podklad pro MDT' }))
        const dialog = within(await screen.findByRole('dialog', { name: 'Potvrdit podklad pro MDT?' }))
        await user.click(dialog.getByRole('button', { name: 'Potvrdit a připravit' }))
        const problem = await screen.findByRole('alert')
        expect(problem).not.toHaveTextContent(i18n.t('mdt.snapshotBlocked'))
        expect(dialog.queryByRole('button', { name: 'Zobrazit k řešení' }) !== null).toBe(blockers)
        if (blockers) {
            expect(within(problem).getByRole('button', { name: 'Zobrazit k řešení' })).toBeVisible()
            await user.click(dialog.getByRole('button', { name: 'Zobrazit k řešení' }))
            expect(await screen.findByRole('article', { name: 'Fiktivní ukázka: chybí ECOG / Karnofsky.' })).toBeVisible()
        }
    })
})
