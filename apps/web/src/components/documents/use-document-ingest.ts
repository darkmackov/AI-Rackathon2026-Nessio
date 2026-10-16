import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getCaseQueryKey, getHandoverQueryKey, getJobOptions, getJobQueryKey, getTimeToTreatmentQueryKey,
  listCaseJobsQueryKey, listCasesQueryKey, listDocumentsQueryKey, listFindingsQueryKey,
  listTasksQueryKey, listAuditQueryKey, reextractCaseMutation,
} from '../../client/@tanstack/react-query.gen'
import type { Job } from '../../client/types.gen'
import { actorHeaders } from '../../api'
import { terminalJob } from './document-utils'

export async function refreshCaseResults(client: QueryClient, caseId: string) {
  const options = { path: { case_id: caseId } }
  // Omitting headers here invalidates all cached actor/snapshot variants of this case.
  await Promise.all([
    listDocumentsQueryKey(options), getHandoverQueryKey(options), listFindingsQueryKey(options),
    getCaseQueryKey(options), listTasksQueryKey(options), listAuditQueryKey(options), getTimeToTreatmentQueryKey(options), listCasesQueryKey(),
  ].map((queryKey) => client.invalidateQueries({ queryKey })))
}

export function rememberJob(client: QueryClient, actorId: string, job: Job) {
  const headers = actorHeaders(actorId)
  client.setQueryData(getJobQueryKey({ headers, path: { job_id: job.id } }), job)
  client.setQueryData<Job[]>(listCaseJobsQueryKey({ headers, path: { case_id: job.case_id } }),
    (jobs = []) => [...jobs.filter((item) => item.id !== job.id), job])
}

export function useIngestJob(job: Job, actorId: string) {
  const client = useQueryClient()
  const options = getJobOptions({ headers: actorHeaders(actorId), path: { job_id: job.id } })
  const generatedQuery = options.queryFn
  return useQuery({
    ...options,
    initialData: job,
    refetchOnMount: !terminalJob(job),
    queryFn: async (context) => {
      if (typeof generatedQuery !== 'function') throw new Error('Missing generated job query')
      const previous = client.getQueryData<Job>(options.queryKey)
      const current = await generatedQuery(context)
      if (context.signal.aborted) return current
      client.setQueryData<Job[]>(listCaseJobsQueryKey({ headers: actorHeaders(actorId), path: { case_id: current.case_id } }),
        (jobs = []) => jobs.map((item) => item.id === current.id ? current : item))
      if (terminalJob(current) && previous?.status !== current.status) {
        await refreshCaseResults(client, current.case_id)
        await client.invalidateQueries({ queryKey: listCaseJobsQueryKey({ path: { case_id: current.case_id } }) })
      }
      return current
    },
    refetchInterval: (query) => query.state.error || (query.state.data && terminalJob(query.state.data)) ? false : 1000,
  })
}

export function useReextract(caseId: string, actorId: string) {
  const client = useQueryClient()
  return useMutation({
    ...reextractCaseMutation(),
    onSuccess: async (job) => {
      rememberJob(client, actorId, job)
      if (terminalJob(job)) await refreshCaseResults(client, caseId)
    },
  })
}
