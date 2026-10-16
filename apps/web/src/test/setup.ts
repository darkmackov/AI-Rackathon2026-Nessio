import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { configureClient } from '../api'
import { changeLanguage } from '../i18n'
import { createDemoState, createHandlers } from '../mocks/handlers'

export const demoState = createDemoState()
export const server = setupServer(...createHandlers(demoState))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
})
window.scrollTo = vi.fn()
globalThis.ResizeObserver = class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(async () => {
  configureClient('http://localhost:5173/api')
  demoState.reset('reference_at_mdt')
  await changeLanguage('cs')
})
afterEach(() => { cleanup(); server.resetHandlers(); vi.restoreAllMocks() })
afterAll(() => server.close())
