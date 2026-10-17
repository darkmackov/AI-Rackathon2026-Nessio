import Button from '../ActionButton'
import { Group, Modal, Stack, Text, Title } from '@mantine/core'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listCaseJobsOptions } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../DataState'
import { terminalJob } from './document-utils'
import { pendingControlProps } from '../pending-control'
import JobProgress from './JobProgress'
import { useReextract } from './use-document-ingest'

// Each running job polls itself (WEB-19); this section only lists them and offers one re-extraction.
export default function DocumentJobs({ caseId, actorId, documents, disabled = false }: {
  caseId: string; actorId: string; documents: DocumentMeta[]; disabled?: boolean;
}) {
  const { t } = useTranslation()
  const busy = useIsMutating() > 0
  const headingId = useId()
  const options = { headers: actorHeaders(actorId), path: { case_id: caseId } }
  const jobs = useQuery(listCaseJobsOptions(options))
  const reextract = useReextract(caseId, actorId)
  const ingestJobs = jobs.data?.filter((job) => job.kind === 'ingest_document') ?? []
  const processing = ingestJobs.some((job) => !terminalJob(job))
  // Re-extraction can reopen findings people closed (their ids may change), so it asks first.
  const [opened, setOpened] = useState(false)
  const confirm = () => reextract.mutate(options, { onSettled: () => setOpened(false) })
  return <Stack component="section" aria-labelledby={headingId} gap="sm">
    <Title order={2} size="h4" id={headingId}>{t('documents.processing')}</Title>
    {jobs.isPending && <LoadingState />}
    {jobs.isError && <QueryError error={jobs.error} pending={jobs.isFetching} retry={() => { void jobs.refetch() }} />}
    {jobs.isSuccess && !ingestJobs.length && <EmptyState title={t('documents.noJobs')} />}
    {ingestJobs.map((job) => <JobProgress key={job.id} job={job} actorId={actorId} documents={documents} />)}
    <Button variant="outline" onClick={() => setOpened(true)} pending={busy || processing || reextract.isPending} disabled={disabled || !documents.length}>{t('documents.reextract')}</Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false) }} title={t('documents.reextractTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      <Stack>
        <Text>{t('documents.reextractText')}</Text>
        <Group><Button onClick={confirm} pending={busy || reextract.isPending} disabled={disabled}>{t('documents.reextract')}</Button><Button variant="default" onClick={() => setOpened(false)} pending={busy}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
  </Stack>
}
