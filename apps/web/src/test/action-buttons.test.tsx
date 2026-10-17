import { MantineProvider, Modal, NativeSelect, TextInput } from '@mantine/core'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ActionButton from '../components/ActionButton'
import ActionIconButton from '../components/ActionIconButton'
import { pendingControlProps } from '../components/pending-control'
import AppNotifications from '../notifications/AppNotifications'
import { i18n } from '../i18n'
import { theme } from '../theme'

function Providers({ children }: { children: ReactNode }) {
  return <MantineProvider theme={theme} env="test"><I18nextProvider i18n={i18n}>{children}</I18nextProvider></MantineProvider>
}

describe('stable action feedback', () => {
  it.each(['filled', 'outline', 'light', 'subtle', 'default'])('keeps the same label and icon in a pending %s button and prevents repeat clicks', async (variant) => {
    const click = vi.fn()
    function Control() {
      const [pending, setPending] = useState(false)
      return <ActionButton pending={pending} variant={variant} leftSection={<svg data-testid="icon" aria-hidden />} onClick={() => { click(); setPending(true) }}>Potvrdit a připravit</ActionButton>
    }
    render(<Control />, { wrapper: Providers })
    const button = screen.getByRole('button', { name: 'Potvrdit a připravit' })
    const label = button.querySelector('.mantine-Button-label')
    const icon = screen.getByTestId('icon')
    await userEvent.setup().dblClick(button)
    expect(click).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('data-pending', 'true')
    expect(button.querySelector('.mantine-Button-label')).toBe(label)
    expect(screen.getByTestId('icon')).toBe(icon)
    expect(button).toHaveTextContent('Potvrdit a připravit')
    expect(button).not.toHaveAttribute('data-loading')
    expect(button.querySelector('.mantine-Button-loader')).not.toBeInTheDocument()
    await userEvent.setup().keyboard('{Enter} ')
    expect(click).toHaveBeenCalledOnce()
  })

  it('keeps unavailable actions disabled after unrelated pending work finishes', () => {
    const view = render(<ActionButton disabled pending>Unavailable</ActionButton>, { wrapper: Providers })
    const button = screen.getByRole('button', { name: 'Unavailable' })
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('data-pending')
    view.rerender(<ActionButton disabled pending={false}>Unavailable</ActionButton>)
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBe(button)
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('keeps an icon action unchanged while pending', () => {
    const click = vi.fn()
    const view = render(<ActionIconButton aria-label="Send" onClick={click}><svg data-testid="arrow" aria-hidden /></ActionIconButton>, { wrapper: Providers })
    const button = screen.getByRole('button', { name: 'Send' })
    const icon = screen.getByTestId('arrow')
    view.rerender(<ActionIconButton aria-label="Send" pending onClick={click}><svg data-testid="arrow" aria-hidden /></ActionIconButton>)
    fireClick(button)
    expect(click).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBe(button)
    expect(screen.getByTestId('arrow')).toBe(icon)
    expect(button).toBeDisabled()
    expect(button.querySelector('.mantine-ActionIcon-loader')).not.toBeInTheDocument()
  })

  it('shows one floating progress status for multiple pending controls inside a dialog and removes it on completion', async () => {
    const view = render(<>
      <Modal opened onClose={() => {}} title="Editor">
        <ActionButton pending>Save</ActionButton><ActionButton pending>Cancel</ActionButton>
        <TextInput label="Draft" defaultValue="Preserved" {...pendingControlProps(true)} />
        <NativeSelect label="Choice" data={['A', 'B']} {...pendingControlProps(true)} />
      </Modal><AppNotifications />
    </>, { wrapper: Providers })
    const dialog = await screen.findByRole('dialog', { name: 'Editor' })
    const status = await within(dialog).findByRole('status')
    expect(status).toHaveTextContent(i18n.t('notices.working'))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(dialog.querySelector('.mantine-Modal-body')).not.toContainElement(status)
    const input = screen.getByLabelText('Draft')
    expect(input).toHaveValue('Preserved')
    expect(input).toBeDisabled()
    view.rerender(<>
      <Modal opened onClose={() => {}} title="Editor">
        <ActionButton>Save</ActionButton><ActionButton>Cancel</ActionButton>
        <TextInput label="Draft" defaultValue="Preserved" {...pendingControlProps(false)} />
        <NativeSelect label="Choice" data={['A', 'B']} {...pendingControlProps(false)} />
      </Modal><AppNotifications />
    </>)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Draft')).toBe(input)
    expect(input).toHaveValue('Preserved')
    expect(input).toBeEnabled()
  })
})

function fireClick(button: HTMLElement) { act(() => { button.click() }) }
