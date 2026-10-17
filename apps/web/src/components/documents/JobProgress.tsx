import { Badge, Group, Loader, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { DocumentMeta, Job } from '../../client/types.gen'
import { QueryError } from '../DataState'
import { terminalJob } from './document-utils'
import { useIngestJob } from './use-document-ingest'

export default function JobProgress({ job: initial, actorId, documents }: { job: Job; actorId: string; documents: DocumentMeta[] }) {
  const { t } = useTranslation()
  const query = useIngestJob(initial, actorId)
  const job = query.data ?? initial
  return <Stack gap={4}>
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{documents.find((item) => item.id === job.document_id)?.filename ?? t('documents.caseExtraction')}</Text>
      <Group role="status" gap={6} wrap="nowrap">
        {!query.isError && !terminalJob(job) && <Loader size="xs" />}
        <Badge size="sm" color={job.status === 'failed' ? 'red' : job.status === 'done' ? 'green' : 'blue'} c="dark.9" variant="light">{t(`documents.jobStatus.${job.status ?? 'queued'}`)}</Badge>
      </Group>
    </Group>
    {query.isError && <QueryError error={query.error} retry={() => { void query.refetch() }} pending={query.isFetching} />}
  </Stack>
}
