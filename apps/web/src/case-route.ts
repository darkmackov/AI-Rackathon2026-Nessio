export const detailTabs = ['overview', 'handover', 'findings', 'documents', 'tasks'] as const
export type DetailTab = typeof detailTabs[number]
export function detailSearch(search: Record<string, unknown>): { tab: DetailTab } {
  return { tab: detailTabs.find((tab) => tab === search.tab) ?? 'overview' }
}
