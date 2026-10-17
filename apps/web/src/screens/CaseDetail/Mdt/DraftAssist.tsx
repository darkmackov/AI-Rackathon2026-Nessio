import Button from '../../../components/ActionButton'
import { Badge, Group, Paper, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconFileText, IconSparkles } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { createDraftMutation, listCaseJobsOptions } from '../../../client/@tanstack/react-query.gen'
import type { DraftKind, DraftResult as Draft, Job } from '../../../client/types.gen'
import LoadingState, { QueryError } from '../../../components/DataState'
import { terminalJob, usableDraft } from '../../../components/documents/document-utils'
import { rememberJob, useIngestJob } from '../../../components/documents/use-document-ingest'
import { CopySection } from '../../../components/handover/ClinicalValue'
import { formatDate } from '../../../time'

// The conclusion prefill restates the record and is not AI (Q-F37); every other draft is an AI proposal.
const prefill = (kind: DraftKind) => kind === 'mdt_conclusion'

function DraftBody({ draft }: { draft: Draft }) {
  const { t, i18n } = useTranslation()
  if (draft.kind === 'mdt_results') return <Stack gap={4}>
    {(draft.rows ?? []).map((row, index) => <Text key={index} size="sm" style={{ overflowWrap: 'anywhere' }}><Text component="span" inherit fw={600}>{formatDate(row.date, i18n.language)} · {row.examination}: </Text>{row.result}</Text>)}
    {!draft.rows?.length && <Text size="sm">{t('unavailable')}</Text>}
  </Stack>
  if (draft.kind === 'mdt_conclusion') {
    const fields = draft.fields
    const values = [['diagnosis', fields?.diagnosis_name], ['definitiveCode', fields?.diagnosis_code], ['date', fields?.date ? formatDate(fields.date, i18n.language) : null], ['place', fields?.place], ['copyTo', fields?.copy_to?.join('\n')]] as const
    return <Stack gap={4}>{values.map(([label, value]) => <Text key={label} size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><Text component="span" inherit fw={600}>{t(`mdt.${label}`)}: </Text>{value || t('unavailable')}</Text>)}</Stack>
  }
  return <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{draft.text}</Text>
}

function draftText(draft: Draft) {
  if (draft.kind === 'mdt_results') return (draft.rows ?? []).map((row) => `${row.date} · ${row.examination}: ${row.result}`).join('\n')
  return draft.text ?? ''
}

function DraftResult({ job, actorId, kind, onUse, retry }: { job: Job; actorId: string; kind: DraftKind; onUse: (draft: Draft) => void; retry: () => void }) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  const query = useIngestJob(job, actorId), current = query.data ?? job
  const draft = current.draft
  return <Stack gap="xs">
    <Group role="status">{!terminalJob(current) && !query.isError && <LoadingState />}<Badge color={current.status === 'failed' ? 'red' : 'blue'} variant="light">{t(current.status === 'running' ? (prefill(kind) ? 'mdt.prefillRunning' : 'mdt.draftRunning') : `documents.jobStatus.${current.status ?? 'queued'}`)}</Badge></Group>
    {query.isError && <QueryError error={query.error} retry={() => { void query.refetch() }} />}
    {current.status === 'done' && (usableDraft(draft, kind) ? <>
      {prefill(kind)
        ? <Badge variant="light" color="gray" leftSection={<IconFileText size={14} aria-hidden />}>{t('mdt.prefillBadge')}</Badge>
        : <Badge variant="light" color="violet" leftSection={<IconSparkles size={14} aria-hidden />}>{t('mdt.ai')}</Badge>}
      <DraftBody draft={draft} />
      <Group align="flex-start"><Button size="compact-sm" pending={busy} onClick={() => onUse(draft)}>{t(kind === 'mdt_results' ? 'mdt.useRows' : 'mdt.useDraft')}</Button>{!prefill(kind) && <CopySection text={() => draftText(draft)} />}</Group>
    </> : <Button size="compact-sm" variant="outline" pending={busy} onClick={retry}>{t('retry')}</Button>)}
  </Stack>
}

/** Drafts and the prefill live inside the open editor: using one fills the form, nothing is saved until the coordinator saves. */
export default function DraftAssist({ caseId, actorId, kind, help, onUse }: { caseId: string; actorId: string; kind: DraftKind; help?: string; onUse: (draft: Draft) => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId) }
  const jobs = useQuery(listCaseJobsOptions(options))
  const job = [...jobs.data ?? []].reverse().find((job) => job.kind === 'draft' && job.params?.kind === kind)
  const create = useMutation({ ...createDraftMutation(), onSuccess: (value) => { rememberJob(client, actorId, value) } })
  const createDraft = () => create.mutate({ ...options, body: { kind } })
  const label = { epicrisis_summary: 'finalEpicrisis', mdt_question: 'question', mdt_results: 'results', mdt_conclusion: 'conclusion' } satisfies Record<DraftKind, string>
  const Icon = prefill(kind) ? IconFileText : IconSparkles
  return <Paper component="section" aria-label={t(prefill(kind) ? 'mdt.prefillFor' : 'mdt.draftFor', { field: t(`mdt.${label[kind]}`) })} withBorder p="sm" bg="gray.0"><Stack gap="xs">
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
      <Text size="xs" c="dimmed" maw={520}>{help ?? t(prefill(kind) ? 'mdt.prefillHelp' : 'mdt.draftHelp')}</Text>
      <Button size="compact-sm" variant="light" color={prefill(kind) ? 'gray' : 'violet'} leftSection={<Icon size={14} aria-hidden />} pending={busy || !!job && !terminalJob(job) || create.isPending}
        onClick={createDraft}>{t(prefill(kind) ? 'mdt.prefill' : 'mdt.draft')}</Button>
    </Group>
    {jobs.isPending && <LoadingState />}
    {jobs.isError && <QueryError error={jobs.error} retry={() => { void jobs.refetch() }} />}
    {job && <DraftResult key={job.id} job={job} actorId={actorId} kind={kind} onUse={onUse} retry={createDraft} />}
    {create.isError && <QueryError error={create.error} />}
  </Stack></Paper>
}
