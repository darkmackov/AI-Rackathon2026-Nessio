import { Alert, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listInboxOptions } from '../../client/@tanstack/react-query.gen'
import LoadingState, { QueryError } from '../../components/DataState'
import PersonChip from '../../components/PersonChip'
import { formatDateTime } from '../../time'

// S3 uses only return notes; the full inbox and receipt workflow belong to S6.
export default function ReturnedNote({ caseId, actorId }: { caseId: string; actorId: string }) {
  const { t, i18n } = useTranslation()
  const inbox = useQuery(listInboxOptions({ headers: actorHeaders(actorId) }))
  const latest = inbox.data?.filter((message) => message.case_id === caseId && message.kind === 'case_returned' && message.recipient_ids.includes(actorId))
    .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''))[0]
  return <Alert color="orange" title={t('referral.returned')} role="status"><Stack gap="xs">
    <Text size="sm">{t('referral.returnedHelp')}</Text>
    {inbox.isPending && <LoadingState />}
    {inbox.isError && <QueryError error={inbox.error} pending={inbox.isFetching} retry={() => { void inbox.refetch() }} />}
    {inbox.isSuccess && !latest && <Text size="sm">{t('referral.noReturnNote')}</Text>}
    {latest && <><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{latest.body}</Text><PersonChip id={latest.sender_id} size="xs" />{latest.sent_at && <Text size="xs">{formatDateTime(latest.sent_at, i18n.language)}</Text>}</>}
  </Stack></Alert>
}
