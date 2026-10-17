import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { askCaseMutation, getJobOptions } from '../../../client/@tanstack/react-query.gen'
import type { Job } from '../../../client/types.gen'
import { terminalJob } from '../../../components/documents/document-utils'
import { rememberJob } from '../../../components/documents/use-document-ingest'
import { notifyJobFailure, notifyWarning } from '../../../notifications/notify'

/** Questions are read-only jobs: polling must not refresh or change clinical data. */
export function useAskCase(caseId: string, actorId: string, jobId: string | null) {
  const client = useQueryClient()
  const { t } = useTranslation()
  const notifyInvalidAnswer = (job: Job) => {
    if (job.status === 'done' && job.answer?.found !== false && !(job.answer?.found && job.answer.quotes?.length)) {
      notifyWarning(`ask-answer:${job.id}`, t('s8.invalidAnswer'))
    }
  }
  const create = useMutation({
    ...askCaseMutation(),
    onSuccess: (job) => { rememberJob(client, actorId, job); notifyInvalidAnswer(job) },
  })
  const jobOptions = getJobOptions({ headers: actorHeaders(actorId), path: { job_id: jobId ?? '' } })
  const generatedQuery = jobOptions.queryFn
  const job = useQuery({
    ...jobOptions,
    enabled: !!jobId,
    queryFn: async (context) => {
      if (typeof generatedQuery !== 'function') throw new Error('Missing generated job query')
      const previous = client.getQueryData<Job>(jobOptions.queryKey)
      const current = await generatedQuery(context)
      if (!context.signal.aborted && current.status === 'failed' && previous?.status !== 'failed') notifyJobFailure(current)
      if (!context.signal.aborted && previous?.status !== 'done') notifyInvalidAnswer(current)
      return current
    },
    refetchInterval: (query) => query.state.error || query.state.data && terminalJob(query.state.data) ? false : 1000,
  })
  return { create, job, options: { path: { case_id: caseId }, headers: actorHeaders(actorId) } }
}
