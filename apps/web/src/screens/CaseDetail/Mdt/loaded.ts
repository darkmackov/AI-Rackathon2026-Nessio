import type { UseQueryResult } from '@tanstack/react-query'
import { ApiError } from '../../../api'

/** An MDT record or conclusion as the tab shows it: a 404 means it is not created yet. */
export type Loaded<T> = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; error: unknown } | { kind: 'ready'; data: T }

export const missing = (error: unknown) => error instanceof ApiError && error.status === 404

export function loaded<T>(query: UseQueryResult<T, unknown>): Loaded<T> {
  if (query.data !== undefined) return { kind: 'ready', data: query.data }
  if (query.isError) return missing(query.error) ? { kind: 'missing' } : { kind: 'error', error: query.error }
  // TanStack Query resets a refetched query without data to pending. Keep the last "not created yet" view
  // instead of a loader, so open forms and draft polling below it are not unmounted by a refresh.
  return query.isFetched ? { kind: 'missing' } : { kind: 'loading' }
}
