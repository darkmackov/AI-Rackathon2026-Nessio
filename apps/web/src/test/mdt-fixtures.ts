import type { UseMutationOptions } from '@tanstack/react-query'
import { createQueryClient } from '../api'
import { s4CaseId } from '../mocks/coordinator-state'
import { demoState } from './setup'

export function mutation<T, E, V>(options: UseMutationOptions<T, E, V>, variables: V) {
  const query = createQueryClient()
  return query.getMutationCache().build(query, options).execute(variables)
}
export function completeCase(state = demoState) {
  const item = state.getCases().find((item) => item.id === s4CaseId)
  if (!item) throw new Error('Missing S4 fixture')
  const complete = { ...item, state: 'kompletni', coordinator_id: 'koordinator', mdt_board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } as const
  state.saveCase(complete)
  return complete
}
export function resolveBlockers(state = demoState) {
  const result = state.documents.result(s4CaseId)
  if (!result) throw new Error('Missing handover fixture')
  state.documents.saveResult(s4CaseId, { ...result, findings: result.findings.map((finding) => finding.severity === 'blocker' ? { ...finding, resolved: true, resolution: { kind: 'overridden', note: 'Fiktivní rozhodnutí koordinátora.', by: 'koordinator', at: '2026-10-21T08:30:00' } } : finding) })
}
