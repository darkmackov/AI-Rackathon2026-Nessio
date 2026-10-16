import type { Query } from '@tanstack/react-query'

// Generated operation ids, covering every identity-scoped S1 cache entry.
const operations = new Set(['getCase', 'getHandover', 'listFindings', 'listTasks', 'listDocuments', 'documentText', 'getDocumentFile', 'getTimeToTreatment'])
export function isCaseQuery(query: Query) {
  const key = query.queryKey[0]
  return !!key && typeof key === 'object' && '_id' in key && typeof key._id === 'string' && operations.has(key._id)
}
