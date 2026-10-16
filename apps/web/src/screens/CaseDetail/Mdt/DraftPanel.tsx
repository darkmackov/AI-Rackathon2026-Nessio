import { Alert, Badge, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconSparkles } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { createDraftMutation, listCaseJobsOptions } from '../../../client/@tanstack/react-query.gen'
import type { DraftKind, Job } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import { terminalJob } from '../../../components/documents/document-utils'
import { rememberJob, useIngestJob } from '../../../components/documents/use-document-ingest'
import { CopySection } from '../../../components/handover/ClinicalValue'

function DraftResult({ job, actorId, onUse }: { job: Job; actorId: string; onUse?: (text: string) => void }) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  const query = useIngestJob(job, actorId), current = query.data ?? job
  const text = typeof current.result?.text === 'string' ? current.result.text : null
  return <Stack gap="xs">
    <Group role="status">{!terminalJob(current) && !query.isError && <LoadingState />}<Badge color={current.status === 'failed' ? 'red' : 'blue'} variant="light">{t(`documents.jobStatus.${current.status ?? 'queued'}`)}</Badge></Group>
    {query.isError && <QueryError error={query.error} retry={() => { void query.refetch() }} />}
    {current.status === 'failed' && <Alert color="red" role="alert">{t('errorOther')}</Alert>}
    {current.status === 'done' && (text ? <>
      <Badge variant="light" color="violet" leftSection={<IconSparkles size={14} aria-hidden />}>{t('mdt.ai')}</Badge>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</Text>
      <Group align="flex-start"><CopySection text={() => text} />{onUse && <Button variant="outline" size="compact-sm" disabled={busy} onClick={() => onUse(text)}>{t('mdt.useDraft')}</Button>}</Group>
    </> : <Alert color="orange" role="status">{t('mdt.draftMissing')}</Alert>)}
  </Stack>
}

export default function DraftPanel({ caseId, actorId, kind, onUse }: { caseId: string; actorId: string; kind: DraftKind; onUse?: (text: string) => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId) }
  const jobs = useQuery(listCaseJobsOptions(options))
  const job = [...jobs.data ?? []].reverse().find((job) => job.kind === 'draft' && job.params?.kind === kind)
  const create = useMutation({ ...createDraftMutation(), onSuccess: (value) => { rememberJob(client, actorId, value) } })
  const label = { epicrisis_summary: 'finalEpicrisis', mdt_question: 'question', mdt_results: 'results', mdt_conclusion: 'conclusion' } satisfies Record<DraftKind, string>
  return <Paper component="section" aria-label={t('mdt.draftFor', { field: t(`mdt.${label[kind]}`) })} withBorder p="sm"><Stack gap="xs">
    <Text size="xs" c="dimmed">{t('mdt.draftHelp')}</Text>
    {jobs.isPending && <LoadingState />}
    {jobs.isError && <QueryError error={jobs.error} retry={() => { void jobs.refetch() }} />}
    {jobs.isSuccess && !job && <EmptyState title={t('mdt.noDraft')} />}
    {job && <DraftResult key={job.id} job={job} actorId={actorId} onUse={onUse} />}
    <Button size="compact-sm" variant="outline" leftSection={<IconSparkles size={14} aria-hidden />} disabled={busy || !!job && !terminalJob(job)} loading={create.isPending}
      onClick={() => create.mutate({ ...options, body: { kind } })}>{t('mdt.draft')}</Button>
    {create.isError && <QueryError error={create.error} />}
  </Stack></Paper>
}
