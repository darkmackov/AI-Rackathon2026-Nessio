import { Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listAuditOptions } from '../../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import PersonChip from '../../components/PersonChip'
import { useSession } from '../../session'
import { formatDateTime } from '../../time'

export default function AuditTab({ caseId }: { caseId: string }) {
  const { t, i18n } = useTranslation(), { actorId } = useSession()
  const audit = useQuery(listAuditOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }))
  return <Stack component="section" aria-labelledby="audit-heading" gap="sm">
    <Title order={2} size="h4" id="audit-heading">{t('workflow.audit')}</Title>
    {audit.isPending && <LoadingState rows={3} />}
    {audit.isError && <QueryError error={audit.error} retry={() => { void audit.refetch() }} />}
    {audit.isSuccess && !audit.data.length && <EmptyState title={t('workflow.noAudit')} />}
    {audit.data?.map((event) => <Paper key={event.id} component="article" withBorder p="sm"><Stack gap={4}>
      <Text size="sm" fw={600}>{t(`workflow.actions.${event.action}`, { defaultValue: event.action })}</Text>
      <Text size="xs" c="dimmed"><time dateTime={event.at}>{formatDateTime(event.at, i18n.language)}</time></Text>
      <PersonChip id={event.actor_id} size="xs" />
      {event.detail && <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{event.detail}</Text>}
    </Stack></Paper>)}
  </Stack>
}
