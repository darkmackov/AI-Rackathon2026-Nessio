import { apiMode } from './config'

// Await this before rendering so the first request cannot escape the selected mode.
export async function initializeApi(mode: typeof apiMode = apiMode) {
  if (mode === 'real') return
  const { worker } = await import('./mocks/browser')
  await worker.start({ quiet: true, onUnhandledRequest: 'bypass' })
}
