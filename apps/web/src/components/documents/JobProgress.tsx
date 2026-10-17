import { Badge, Group, Loader, Paper, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { DocumentMeta, Job } from '../../client/types.gen'
import { QueryError } from '../DataState'
import { terminalJob } from './document-utils'
import { useIngestJob } from './use-document-ingest'

export default function JobProgress({ job: initial, actorId, documents }: { job: Job; actorId: string; documents: DocumentMeta[] }) {
  const { t } = useTranslation()
  const query = useIngestJob(initial, actorId)
  const job = query.data ?? initial
  return <Paper withBorder p="sm"><Stack gap="xs">
    <Text fw={600} size="sm">{documents.find((item) => item.id === job.document_id)?.filename ?? t('documents.caseExtraction')}</Text>
    <Group role="status" gap="sm">
      {!query.isError && !terminalJob(job) && <Loader size="xs" />}
      <Badge color={job.status === 'failed' ? 'red' : job.status === 'done' ? 'green' : 'blue'} variant="light">{t(`documents.jobStatus.${job.status ?? 'queued'}`)}</Badge>
    </Group>
    {query.isError && <QueryError error={query.error} retry={() => { void query.refetch() }} pending={query.isFetching} />}
  </Stack></Paper>
}
