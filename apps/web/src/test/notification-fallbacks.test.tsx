import { MantineProvider } from '@mantine/core'
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import DownloadFile from '../components/documents/DownloadFile'
import { CopySection } from '../components/handover/ClinicalValue'
import { i18n } from '../i18n'
import AppNotifications from '../notifications/AppNotifications'
import { createAppRouter } from '../router'

describe('popup-only technical failures', () => {
    it('shows clipboard failures only in a dismissible popup and permits another copy attempt', async () => {
        const user = userEvent.setup()
        const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('private clipboard failure'))
        render(<MantineProvider><I18nextProvider i18n={i18n}>
            <CopySection text={() => 'Clinical text'} /><AppNotifications />
        </I18nextProvider></MantineProvider>)
        await user.click(screen.getByRole('button', { name: i18n.t('caseDetail.copy') }))
        expect(await screen.findAllByRole('alert')).toHaveLength(1)
        expect(document.body).not.toHaveTextContent('private clipboard failure')
        await user.click(screen.getByRole('button', { name: i18n.t('notices.close') }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        expect(screen.queryByText(i18n.t('caseDetail.copyError'))).not.toBeInTheDocument()
        copy.mockResolvedValue()
        await user.click(screen.getByRole('button', { name: i18n.t('caseDetail.copy') }))
        expect(copy).toHaveBeenCalledTimes(2)
        expect(copy).toHaveBeenLastCalledWith('Clinical text')
        expect(screen.getAllByRole('status').some((status) => status.textContent?.includes(i18n.t('caseDetail.copied')))).toBe(true)
    })

    it.each([new Error('private download failure'), new ApiError(500, { detail: 'private download failure' })])('keeps download failures out of the content and allows retry after dismissing the popup (%s)', async (error) => {
        const load = vi.fn().mockRejectedValue(error)
        render(<MantineProvider><I18nextProvider i18n={i18n}>
            <DownloadFile load={load} pending={false} filename="test.pdf" label="Download" />
            <AppNotifications />
        </I18nextProvider></MantineProvider>)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Download' }))
        expect(await screen.findAllByRole('alert')).toHaveLength(1)
        expect(document.body).not.toHaveTextContent('private download failure')
        await user.click(screen.getByRole('button', { name: 'Zavřít oznámení' }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        expect(screen.queryByText(i18n.t('caseDetail.downloadError'))).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Download' }))
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('reports route failures once in a popup and retains the retry outside it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const router = createAppRouter(createMemoryHistory({ initialEntries: ['/coordinator'] }))
        let failing = true
        router.routeTree.update({ component: Outlet })
        router.routesById['/coordinator'].update({
            component: () => {
                if (failing) throw new Error('private route failure')
                return <p>Recovered</p>
            }
        })
        render(<MantineProvider><I18nextProvider i18n={i18n}>
            <RouterProvider router={router} /><AppNotifications />
        </I18nextProvider></MantineProvider>)
        expect(await screen.findByText(i18n.t('notices.pageFailed'))).toBeVisible()
        expect(screen.getAllByRole('alert')).toHaveLength(1)
        expect(document.querySelector('.mantine-Alert-root')).not.toBeInTheDocument()
        expect(document.body).not.toHaveTextContent('private route failure')
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Zavřít oznámení' }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        failing = false
        await user.click(screen.getByRole('button', { name: 'Zkusit znovu' }))
        expect(await screen.findByText('Recovered')).toBeVisible()
    })
})
