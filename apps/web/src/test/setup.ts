import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { configureClient } from '../api'
import { changeLanguage } from '../i18n'
import { createDemoState, createHandlers } from '../mocks/handlers'
import { clearNotifications } from '../notifications/notify'

export const demoState = createDemoState()
export const server = setupServer(...createHandlers(demoState))

// Narrow layout by default; a test opts into the wide layout with wideScreen() from ./shell.
const narrowScreen = (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
  removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
})
Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(narrowScreen) })
// Mantine's autosizing textarea observes browser font-loading events.
Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: vi.fn(), removeEventListener: vi.fn() } })
window.scrollTo = vi.fn()
globalThis.ResizeObserver = class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(async () => {
  clearNotifications()
  vi.mocked(window.matchMedia).mockImplementation(narrowScreen)
  configureClient('http://localhost:5173/api')
  demoState.reset('reference_at_mdt')
  sessionStorage.clear()
  await changeLanguage('cs')
})
afterEach(() => { cleanup(); clearNotifications(); server.resetHandlers(); vi.restoreAllMocks() })
afterAll(() => server.close())
