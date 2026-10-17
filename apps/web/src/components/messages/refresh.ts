import type { QueryClient } from '@tanstack/react-query'
import { listCaseMessagesQueryKey, listCaseReceiptsQueryKey } from '../../client/@tanstack/react-query.gen'
import { refreshCaseResults } from '../documents/use-document-ingest'

/** After a feedback, notice or receipt: the case, its overviews, audit, messages, receipts and every cached inbox. */
export async function refreshMessages(client: QueryClient, caseId: string) {
    const options = { path: { case_id: caseId } }
    await Promise.all([
        refreshCaseResults(client, caseId),
        client.invalidateQueries({ queryKey: listCaseMessagesQueryKey(options) }),
        client.invalidateQueries({ queryKey: listCaseReceiptsQueryKey(options) }),
        client.invalidateQueries({ predicate: (query) => { const key = query.queryKey[0]; return !!key && typeof key === 'object' && '_id' in key && key._id === 'listInbox' } }),
    ])
}
