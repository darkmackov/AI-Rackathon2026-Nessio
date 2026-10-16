import { QueryClient } from '@tanstack/react-query'
import { client } from './client/client.gen'

// A local transport error, not a new API response model (Q-K7).
export class ApiError extends Error {
  status: number | undefined
  detail: unknown

  constructor(status: number | undefined, detail: unknown) {
    super('API request failed')
    this.status = status
    this.detail = detail
  }
}

export function configureClient(baseUrl = '/api') {
  client.setConfig({ baseUrl })
  client.interceptors.error.clear()
  client.interceptors.error.use((error, response) => new ApiError(response?.status, error))
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

export function actorHeaders(actorId: string) {
  return { 'X-Actor-Id': actorId }
}
