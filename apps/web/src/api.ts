import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { client } from './client/client.gen'
import { ApiError } from './api-error'
import { isRecord } from './notifications/normalize-error'
import { allowNotificationRecovery, notifyApiError } from './notifications/notify'
import type { NotificationAction } from './notifications/notification-action'
export { ApiError } from './api-error'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { notificationAction?: (error: unknown) => NotificationAction | undefined }
    // `notify: false` leaves the failure to the caller, which reports it with its own message.
    queryMeta: { notify?: false }
  }
}

export function configureClient(baseUrl = '/api') {
  client.setConfig({ baseUrl })
  client.interceptors.error.clear()
  client.interceptors.error.use((error, response, request, options) => {
    const operation = options.method === 'GET' ? 'load' : options.body instanceof FormData || options.url.includes('/documents') && options.method === 'POST' || options.url.endsWith('/upload') ? 'upload' : /\/(send|feedback|confirm)$/u.test(options.url) ? 'send' : 'save'
    return new ApiError(response?.status, error, operation, request?.url ?? options.url)
  })
}

export function createQueryClient() {
  const failingReads = new Set<string>()
  return new QueryClient({
    queryCache: new QueryCache({
      onSuccess: (_data, query) => { if (failingReads.delete(query.queryHash)) allowNotificationRecovery(query.queryHash) },
      onError: (error, query) => {
        const key = query.queryKey[0]
        const id = isRecord(key) ? key._id : undefined
        if (error instanceof ApiError && error.status === 404 && ['getHandover', 'getMdtRecord', 'getMdtConclusion'].includes(String(id))) return
        if (query.meta?.notify === false) return
        failingReads.add(query.queryHash)
        notifyApiError(error, { scope: query.queryHash, automatic: true })
      }
    }),
    mutationCache: new MutationCache({ onError: (error, _variables, _context, mutation) => {
      notifyApiError(error, { action: mutation.meta?.notificationAction?.(error) })
    } }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

export function actorHeaders(actorId: string) {
  return { 'X-Actor-Id': actorId }
}
