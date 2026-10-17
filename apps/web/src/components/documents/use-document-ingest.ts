import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getCaseQueryKey, getHandoverQueryKey, getJobOptions, getJobQueryKey, getTimeToTreatmentQueryKey,
  listCaseJobsQueryKey, listCasesQueryKey, listDocumentsQueryKey, listFindingsQueryKey,
  listTasksQueryKey, listAuditQueryKey, reextractCaseMutation, getMdtRecordQueryKey, getMdtConclusionQueryKey,
  listCodeCandidatesQueryKey,
} from '../../client/@tanstack/react-query.gen'
import type { Job } from '../../client/types.gen'
import { actorHeaders } from '../../api'
import { i18n } from '../../i18n'
import { notifyJobFailure, notifyWarning } from '../../notifications/notify'
import { terminalJob, usableDraft } from './document-utils'

function notifyInvalidDraft(job: Job) {
  if (job.kind === 'draft' && job.status === 'done' && !usableDraft(job.draft, job.params?.kind)) {
    notifyWarning(`draft-result:${job.id}`, i18n.t('mdt.draftMissing'))
  }
}

export async function refreshCaseResults(client: QueryClient, caseId: string) {
  const options = { path: { case_id: caseId } }
  // Omitting headers here invalidates all cached actor/snapshot variants of this case.
  await Promise.all([
    listDocumentsQueryKey(options), getHandoverQueryKey(options), listFindingsQueryKey(options), listCodeCandidatesQueryKey(options),
    getCaseQueryKey(options), listTasksQueryKey(options), listAuditQueryKey(options), getTimeToTreatmentQueryKey(options), listCasesQueryKey(), getMdtRecordQueryKey(options), getMdtConclusionQueryKey(options),
  ].map((queryKey) => client.invalidateQueries({ queryKey })))
}

export function rememberJob(client: QueryClient, actorId: string, job: Job) {
  const headers = actorHeaders(actorId)
  const previous = client.getQueryData<Job>(getJobQueryKey({ headers, path: { job_id: job.id } }))
  client.setQueryData(getJobQueryKey({ headers, path: { job_id: job.id } }), job)
  client.setQueryData<Job[]>(listCaseJobsQueryKey({ headers, path: { case_id: job.case_id } }),
    (jobs = []) => [...jobs.filter((item) => item.id !== job.id), job])
  if (job.status === 'failed' && previous?.status !== 'failed') notifyJobFailure(job)
  if (job.status === 'done' && previous?.status !== 'done') notifyInvalidDraft(job)
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
        if (current.status === 'failed') notifyJobFailure(current)
        if (current.status === 'done') notifyInvalidDraft(current)
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
