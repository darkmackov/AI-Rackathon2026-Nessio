import { Alert, Badge, Button, Drawer, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useIsMutating, useMutationState, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listActorsOptions, listCaseJobsOptions, listDocumentsOptions } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta } from '../../client/types.gen'
import { apiMode } from '../../config'
import { demoResetMutationKey } from '../../demo-clock'
import { useSession } from '../../session'
import { formatDateTime } from '../../time'
import LoadingState, { EmptyState, QueryError } from '../DataState'
import { formatDocumentDate, terminalJob, type SourceSelection } from './document-utils'
import DocumentMetadataForm from './DocumentMetadataForm'
import DocumentUploader from './DocumentUploader'
import ExtractionResults from './ExtractionResults'
import JobProgress from './JobProgress'
import SourceDocument from './SourceDocument'
import { useReextract } from './use-document-ingest'

export type DocumentIngestProps = { caseId: string; receivedAt?: string }

function DocumentIngestPanel({ caseId, receivedAt, actorId }: DocumentIngestProps & { actorId: string }) {
  const { t, i18n } = useTranslation()
  const headingId = useId()
  const busy = useIsMutating() > 0
  const [source, setSource] = useState<SourceSelection | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const options = { headers: actorHeaders(actorId), path: { case_id: caseId } }
  const documents = useQuery(listDocumentsOptions(options))
  const actors = useQuery(listActorsOptions())
  const jobs = useQuery({
    ...listCaseJobsOptions(options),
    refetchInterval: (query) => !query.state.error && query.state.data?.some((job) => job.kind === 'ingest_document' && !terminalJob(job)) ? 2000 : false,
  })
  const reextract = useReextract(caseId, actorId)
  const ingestJobs = jobs.data?.filter((job) => job.kind === 'ingest_document') ?? []
  const processing = ingestJobs.some((job) => !terminalJob(job))
  const editing = documents.data?.find((item) => item.id === editingId)
  const retry = () => reextract.mutate({ headers: actorHeaders(actorId), path: { case_id: caseId } })

  function displayDocument(document: DocumentMeta) {
    return <Paper withBorder p="md" key={document.id} component="article" aria-label={document.filename}>
      <Stack gap="sm">
        <div><Text fw={600}>{document.title ?? document.filename}</Text>{document.title && <Text size="sm" c="dimmed">{document.filename}</Text>}</div>
        <Group gap="xs"><Badge variant="light">{t('documents.docType')}: {document.doc_type ? t(`documents.types.${document.doc_type}`) : t('unavailable')}</Badge></Group>
        <Text size="sm">{t('documents.documentDate')}: {document.document_date ? formatDocumentDate(document.document_date, i18n.language) : t('unavailable')}</Text>
        <Text size="sm">{t('documents.metadata.facility')}: {document.facility ?? t('unavailable')}</Text>
        <Text size="sm">{t('documents.metadata.author')}: {document.author ?? t('unavailable')}</Text>
        {document.department && <Text size="sm">{t('documents.metadata.department')}: {document.department}</Text>}
        {document.ordered_by && <Text size="sm">{t('documents.metadata.ordered_by')}: {document.ordered_by}</Text>}
        <Text size="sm">{t('documents.receivedAt')}: {document.received_at ? formatDateTime(document.received_at, i18n.language) : t('unavailable')}</Text>
        <Text size="sm">{t('documents.uploadedBy')}: {actors.data?.find((actor) => actor.id === document.uploaded_by)?.name ?? document.uploaded_by ?? t('unavailable')}
          {actors.data?.find((actor) => actor.id === document.uploaded_by)?.role === 'referring_doctor' && ` · ${t('referring_doctor')}`}</Text>
        <Group><Button variant="outline" size="compact-sm" onClick={() => setSource({ documentId: document.id })}>{t('documents.view')}</Button>
          <Button variant="subtle" size="compact-sm" disabled={busy || processing} onClick={() => setEditingId(document.id)}>{t('documents.edit')}</Button></Group>
      </Stack>
    </Paper>
  }

  return <Stack component="section" aria-labelledby={headingId} gap="lg">
    <Title order={2} size="h3" id={headingId}>{t('documents.title')}</Title>
    {apiMode === 'mock' && <Alert color="blue" role="status" title={t('demoData')}>{t('documents.demoHelp')}</Alert>}
    <DocumentUploader caseId={caseId} actorId={actorId} receivedAt={receivedAt} />
    <Stack component="section" gap="sm" aria-label={t('documents.processing')}>
      <Title order={3} size="h4">{t('documents.processing')}</Title>
      {jobs.isPending && <LoadingState />}
      {jobs.isError && <QueryError error={jobs.error} retry={() => { void jobs.refetch() }} />}
      {jobs.isSuccess && !ingestJobs.length && <EmptyState title={t('documents.noJobs')} />}
      {ingestJobs.map((job) => <JobProgress key={job.id} job={job} actorId={actorId} documents={documents.data ?? []} onRetry={retry} retryDisabled={busy || processing} />)}
      <Button variant="outline" onClick={retry} loading={reextract.isPending} disabled={busy || processing || !documents.data?.length}>{t('documents.reextract')}</Button>
      {reextract.isError && <QueryError error={reextract.error} retry={retry} />}
    </Stack>
    <Stack component="section" gap="sm" aria-label={t('documents.list')}>
      <Title order={3} size="h4">{t('documents.list')}</Title>
      {documents.isPending && <LoadingState />}
      {documents.isError && <QueryError error={documents.error} retry={() => { void documents.refetch() }} />}
      {documents.isSuccess && (!documents.data.length ? <EmptyState title={t('documents.empty')} description={t('documents.emptyHelp')} /> : documents.data.map(displayDocument))}
    </Stack>
    <ExtractionResults caseId={caseId} actorId={actorId} documents={documents.data ?? []} onSource={setSource} />
    <SourceDocument selection={source} documents={documents.data ?? []} actorId={actorId} onClose={() => setSource(null)} />
    <Drawer stackId={`${headingId}-metadata`} opened={!!editing} onClose={() => { if (!busy) setEditingId(null) }} title={t('documents.edit')} position="right" size="md"
      closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {editing && <DocumentMetadataForm key={editing.id} document={editing} caseId={caseId} actorId={actorId} onClose={() => setEditingId(null)} />}
    </Drawer>
  </Stack>
}

export default function DocumentIngest(props: DocumentIngestProps) {
  const { actor } = useSession()
  const resets = useMutationState({ filters: { mutationKey: demoResetMutationKey, status: 'success' }, select: (mutation) => mutation.state.submittedAt })
  if (!actor || !props.caseId) return null
  return <DocumentIngestPanel key={`${actor.id}-${props.caseId}-${resets.at(-1) ?? 0}`} {...props} actorId={actor.id} />
}
