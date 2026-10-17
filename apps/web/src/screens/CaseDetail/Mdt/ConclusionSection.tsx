import Button from '../../../components/ActionButton'
import { pendingControlProps } from '../../../components/pending-control'
import { Alert, Group, Paper, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { useIsMutating, type UseQueryResult } from '@tanstack/react-query'
import { IconFileUpload, IconPencil } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConclusionPrefill, DocumentMeta, Job, MdtConclusion, MdtRecord } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import JobProgress from '../../../components/documents/JobProgress'
import { JobsWithGame } from '../../../components/documents/DocumentJobs'
import { StampView, type Sources } from '../../../components/handover/ClinicalValue'
import ConclusionEditor from './ConclusionEditor'
import ConclusionUpload from './ConclusionUpload'
import ConclusionView from './ConclusionView'
import DraftAssist from './DraftAssist'
import PdfDownload from './PdfDownload'
import type { Loaded } from './loaded'

const focusEditor = (node: HTMLHeadingElement | null) => { node?.focus() }

/** The written form with the record prefill (Q-F37) inside it; the decision itself is always typed in. */
function WriteConclusion({ caseId, actorId, record, conclusion, close, saved }: { caseId: string; actorId: string; record: MdtRecord; conclusion?: MdtConclusion; close?: () => void; saved: () => void }) {
  const { t } = useTranslation()
  const [prefill, setPrefill] = useState<{ version: number; fields?: ConclusionPrefill } | null>(null)
  const title = t(conclusion ? 'mdt.editConclusion' : 'mdt.writeConclusion')
  return <Paper component="section" aria-label={title} withBorder p="sm" shadow="xs"><Stack gap="sm">
    <Title order={3} size="h5" tabIndex={-1} ref={close ? focusEditor : undefined}>{title}</Title>
    <DraftAssist caseId={caseId} actorId={actorId} kind="mdt_conclusion" onUse={(draft) => setPrefill((current) => ({ version: (current?.version ?? 0) + 1, fields: draft.fields ?? undefined }))} />
    <ConclusionEditor key={prefill?.version ?? 0} caseId={caseId} actorId={actorId} conclusion={conclusion} prefill={prefill?.fields} meetingDate={record.mdt_date} close={close} saved={saved} />
  </Stack></Paper>
}

export default function ConclusionSection({ caseId, actorId, record, conclusion, retry, jobs, ingest, pending, play, editable, documents, sources }: {
  caseId: string; actorId: string; record: MdtRecord; conclusion: Loaded<MdtConclusion>; retry: () => void; jobs: UseQueryResult<Job[], unknown>; ingest: Job[]; pending: boolean; play: () => void
  editable: boolean; documents: DocumentMeta[]; sources: Sources;
}) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  const [mode, setMode] = useState<'write' | 'upload'>('write'), [editing, setEditing] = useState<'write' | 'upload' | null>(null), [saved, setSaved] = useState(false)
  const close = (changed: boolean) => { setEditing(null); setSaved(changed) }
  const progress = <>
    {ingest.length > 0 && <JobsWithGame jobs={ingest.map((job) => <JobProgress key={job.id} job={job} actorId={actorId} documents={documents} />)} running={pending} play={play} />}
    {pending && <Alert color="blue" role="status">{t('mdt.pendingUpload')}</Alert>}
    {jobs.isError && <QueryError error={jobs.error} retry={() => { void jobs.refetch() }} />}
  </>
  if (conclusion.kind === 'loading') return <LoadingState rows={3} />
  if (conclusion.kind === 'error') return <QueryError error={conclusion.error} retry={retry} />
  // A save always drops the confirmation, so the notice is stale once the conclusion is confirmed again.
  const notice = saved && !(conclusion.kind === 'ready' && conclusion.data.confirmed) && <Alert color="green" role="status">{t('mdt.saved')}</Alert>
  if (conclusion.kind === 'missing') {
    if (!editable) return <EmptyState title={t('mdt.noConclusion')} />
    return <Stack gap="sm">
      {notice}
      <Text size="sm">{t('mdt.conclusionIntro')}</Text>
      <SegmentedControl aria-label={t('mdt.modeLabel')} value={mode} onChange={(value) => setMode(value === 'upload' ? 'upload' : 'write')} {...pendingControlProps(busy)} maw={460}
        data={[{ value: 'write', label: <Group gap={6} wrap="nowrap" justify="center"><IconPencil size={16} aria-hidden /><span>{t('mdt.modeWrite')}</span></Group> },
          { value: 'upload', label: <Group gap={6} wrap="nowrap" justify="center"><IconFileUpload size={16} aria-hidden /><span>{t('mdt.modeUpload')}</span></Group> }]} />
      <Text size="sm" c="dimmed">{t(mode === 'write' ? 'mdt.modeWriteHelp' : 'mdt.modeUploadHelp')}</Text>
      {mode === 'write'
        ? <WriteConclusion caseId={caseId} actorId={actorId} record={record} saved={() => close(true)} />
        : <ConclusionUpload caseId={caseId} actorId={actorId} processing={pending} />}
      {progress}
    </Stack>
  }
  const value = conclusion.data
  const source = value.document_id ? documents.some((document) => document.id === value.document_id) : null
  return <Stack gap="sm">
    {notice}
    {progress}
    {editing === 'write'
      ? <WriteConclusion caseId={caseId} actorId={actorId} record={record} conclusion={value} close={() => close(false)} saved={() => close(true)} />
      : <>
        <Group justify="space-between" align="flex-start" gap="sm">
          <Group gap="xs" align="flex-start">
            {editable && <Button variant="outline" size="compact-sm" leftSection={<IconPencil size={14} aria-hidden />} pending={busy || pending} onClick={() => { setSaved(false); setEditing('write') }}>{t('mdt.editConclusion')}</Button>}
            {editable && <Button variant="subtle" size="compact-sm" leftSection={<IconFileUpload size={14} aria-hidden />} pending={busy || pending} aria-expanded={editing === 'upload'} onClick={() => { setSaved(false); setEditing(editing === 'upload' ? null : 'upload') }}>{t('mdt.uploadOther')}</Button>}
            {value.document_id && <Button variant="subtle" size="compact-sm" disabled={!source} onClick={(event) => { if (value.document_id) sources.openSource({ documentId: value.document_id }, event.currentTarget) }}>{t('mdt.source')}</Button>}
            <PdfDownload caseId={caseId} actorId={actorId} kind="conclusion" />
          </Group>
          <Group gap="xs"><Text size="sm" c="dimmed">{t('mdt.confirmation')}:</Text><StampView stamp={value.confirmed} /></Group>
        </Group>
        {editable && value.confirmed && <Text size="sm" c="dimmed">{t('mdt.correctionHelp')}</Text>}
        {source === false && <Alert color="orange" role="status">{t('mdt.noSource')}</Alert>}
        {editing === 'upload' && <ConclusionUpload caseId={caseId} actorId={actorId} processing={pending} />}
        <ConclusionView conclusion={value} />
      </>}
  </Stack>
}
