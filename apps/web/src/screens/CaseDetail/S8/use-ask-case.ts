import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { actorHeaders } from '../../../api'
import { askCaseMutation, getJobOptions } from '../../../client/@tanstack/react-query.gen'
import { terminalJob } from '../../../components/documents/document-utils'
import { rememberJob } from '../../../components/documents/use-document-ingest'

/** Questions are read-only jobs: polling must not refresh or change clinical data. */
export function useAskCase(caseId: string, actorId: string, jobId: string | null) {
  const client = useQueryClient()
  const create = useMutation({
    ...askCaseMutation(),
    onSuccess: (job) => { rememberJob(client, actorId, job) },
  })
  const job = useQuery({
    ...getJobOptions({ headers: actorHeaders(actorId), path: { job_id: jobId ?? '' } }),
    enabled: !!jobId,
    refetchInterval: (query) => query.state.error || query.state.data && terminalJob(query.state.data) ? false : 1000,
  })
  return { create, job, options: { path: { case_id: caseId }, headers: actorHeaders(actorId) } }
}
