import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listActorsOptions, listOrganizationsOptions, listTaskSetsQueryKey } from '../../client/@tanstack/react-query.gen'
import type { Priority, TaskStatus } from '../../client/types.gen'
import LoadingState, { QueryError } from '../DataState'
import { refreshCaseResults } from '../documents/use-document-ingest'

export const priorityValue = (value: string): Priority => ['high', 'urgent'].find((key): key is 'high' | 'urgent' => key === value) ?? 'normal'
export const statusValue = (value: string): TaskStatus => ['booked', 'done', 'cancelled'].find((key): key is 'booked' | 'done' | 'cancelled' => key === value) ?? 'planned'
export const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)
export function useWorkflowRefresh(caseId: string) {
  const client = useQueryClient()
  return async () => {
    await refreshCaseResults(client, caseId)
    await client.invalidateQueries({ queryKey: listTaskSetsQueryKey() })
    await client.invalidateQueries({ predicate: (query) => { const key = query.queryKey[0]; return !!key && typeof key === 'object' && '_id' in key && key._id === 'listNotifications' } })
  }
}
export function useOwnerChoices(peopleOnly = false) {
  const actors = useQuery(listActorsOptions()), organizations = useQuery(listOrganizationsOptions())
  return { choices: [...actors.data ?? [], ...(peopleOnly ? [] : organizations.data ?? [])].map((item) => ({ value: item.id, label: item.name })),
    state: actors.isPending || !peopleOnly && organizations.isPending ? <LoadingState /> : actors.isError ? <QueryError error={actors.error} retry={() => { void actors.refetch() }} /> : !peopleOnly && organizations.isError ? <QueryError error={organizations.error} retry={() => { void organizations.refetch() }} /> : null }
}
export function usePriorityChoices() { const { t } = useTranslation(); return ['normal', 'high', 'urgent'].map((value) => ({ value, label: t(`priorities.${value}`) })) }
