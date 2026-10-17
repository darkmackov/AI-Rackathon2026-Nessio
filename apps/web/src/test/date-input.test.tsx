import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DateInput from '../components/DateInput'
import { pendingControlProps } from '../components/pending-control'
import { theme } from '../theme'

describe('stable date fields', () => {
  it.each(['date', 'datetime-local'] as const)('keeps the same %s input and calendar when a write is locked and released', (type) => {
    const value = type === 'date' ? '2026-10-21' : '2026-10-21T09:00'
    const field = (pending: boolean) => <MantineProvider theme={theme} env="test">
      <DateInput type={type} label="Date" defaultValue={value} {...pendingControlProps(pending)} />
    </MantineProvider>
    const view = render(field(false))
    const input = screen.getByLabelText('Date')
    const calendar = view.container.querySelector('[data-calendar-icon]')
    expect(calendar).toBeVisible()
    for (const pending of [true, false, true, false]) {
      view.rerender(field(pending))
      expect(screen.getByLabelText('Date')).toBe(input)
      expect(input).toHaveValue(value)
      expect(input).toHaveAttribute('type', type)
      expect(input).toHaveProperty('disabled', pending)
      expect(view.container.querySelectorAll('[data-calendar-icon]')).toHaveLength(1)
      expect(view.container.querySelector('[data-calendar-icon]')).toBe(calendar)
      expect(calendar).toBeVisible()
    }
  })

  it('keeps the calendar visible on a business-disabled date field without enabling the field', () => {
    const view = render(<MantineProvider theme={theme} env="test"><DateInput label="Date" {...pendingControlProps(true, true)} /></MantineProvider>)
    expect(screen.getByLabelText('Date')).toBeDisabled()
    expect(view.container.querySelector('[data-calendar-icon]')).toBeVisible()
    expect(screen.getByLabelText('Date')).not.toHaveAttribute('data-pending')
  })
})
