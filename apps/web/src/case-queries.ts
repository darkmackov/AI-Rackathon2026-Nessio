import type { Query } from '@tanstack/react-query'

// Generated operation ids, covering every identity-scoped cache entry of a case, its documents and jobs.
const operations = new Set([
  'getCase', 'getHandover', 'listFindings', 'listTasks', 'listDocuments', 'documentText', 'getDocumentFile', 'getTimeToTreatment',
  'listCaseJobs', 'getJob', 'listAudit', 'listNotifications', 'listTaskSets', 'getMdtRecord', 'getMdtConclusion', 'getMdtRecordPdf', 'getMdtConclusionPdf',
  'listInbox', 'listCaseMessages', 'listCaseReceipts',
])
export function isCaseQuery(query: Query) {
  const key = query.queryKey[0]
  return !!key && typeof key === 'object' && '_id' in key && typeof key._id === 'string' && operations.has(key._id)
}
