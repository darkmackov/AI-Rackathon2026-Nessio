import { Accordion, Badge, Group, Stack, Text, Title } from '@mantine/core'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listCaseReceiptsOptions, listCasesOptions, listInboxOptions } from '../../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { KindBadge, ReceiptStatus } from '../../components/messages/MessageParts'
import { usePeople } from '../../components/people'
import { formatDateTime } from '../../time'
import InboxDetail from './InboxDetail'

/** The GP's inbox: MDT results to confirm and returned referrals, newest first as the API lists them. */
export default function Inbox({ actorId }: { actorId: string }) {
    const { t, i18n } = useTranslation()
    const headers = actorHeaders(actorId)
    const [opened, setOpened] = useState<string | null>(null)
    const inbox = useQuery(listInboxOptions({ headers }))
    const cases = useQuery(listCasesOptions({ headers, query: { referring_doctor_id: actorId } }))
    const caseIds = [...new Set(inbox.data?.map((message) => message.case_id) ?? [])]
    const receipts = useQueries({ queries: caseIds.map((id) => listCaseReceiptsOptions({ headers, path: { case_id: id } })) })
    const allReceipts = receipts.flatMap((query) => query.data ?? [])
    const receiptError = receipts.find((query) => query.isError)
    const { names, actors } = usePeople()
    const receiptsReady = receipts.every((query) => query.isSuccess)
    const pending = receiptsReady ? inbox.data?.filter((message) => message.kind === 'mdt_result' && !allReceipts.some((receipt) => receipt.message_id === message.id && receipt.recipient_id === actorId)).length ?? 0 : 0
    return <Stack component="section" aria-labelledby="inbox-heading" gap="sm">
        <Group gap="xs">
            <Title order={2} size="h3" id="inbox-heading">{t('messages.inbox')}</Title>
            {pending > 0 && <Badge variant="filled" color="orange.8">{t('messages.toConfirm', { count: pending })}</Badge>}
        </Group>
        {inbox.isPending && <LoadingState rows={2} />}
        {inbox.isError && <QueryError error={inbox.error} pending={inbox.isFetching} retry={() => { void inbox.refetch() }} />}
        {receiptError?.isError && <QueryError error={receiptError.error} retry={() => { void receiptError.refetch() }} />}
        {inbox.data?.length ? <>
            {(cases.isPending || actors.isPending || receipts.some((query) => query.isPending)) && <LoadingState rows={1} />}
            {cases.isError && <QueryError error={cases.error} retry={() => { void cases.refetch() }} />}
            {actors.isError && <QueryError error={actors.error} retry={() => { void actors.refetch() }} />}
        </> : null}
        {inbox.isSuccess && !inbox.data.length && <EmptyState title={t('messages.emptyInbox')} />}
        {inbox.isSuccess && inbox.data.length > 0 && <Accordion variant="separated" value={opened} onChange={setOpened} chevronPosition="right">
            {inbox.data.map((message) => {
                const item = cases.data?.find((entry) => entry.id === message.case_id)
                const receiptQuery = receipts[caseIds.indexOf(message.case_id)]
                const caseReceipts = receiptQuery?.isSuccess ? receiptQuery.data : undefined
                return <Accordion.Item key={message.id} value={message.id}>
                    <Accordion.Control>
                        <Stack gap={4}>
                            <Group justify="space-between" gap="xs" wrap="wrap">
                                <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{item?.patient_name || t('referral.unnamed')}</Text>
                                <ReceiptStatus message={message} receipts={caseReceipts} recipient={actorId} />
                            </Group>
                            <Group gap="xs" wrap="wrap"><KindBadge message={message} /><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{message.subject}</Text></Group>
                            <Text size="xs" c="dimmed">{t('messages.from')}: {names[message.sender_id] ?? t('unavailable')} · {message.sent_at ? formatDateTime(message.sent_at, i18n.language) : t('unavailable')}</Text>
                        </Stack>
                    </Accordion.Control>
                    <Accordion.Panel>{opened === message.id && <InboxDetail message={message} item={item} actorId={actorId} receipts={caseReceipts} />}</Accordion.Panel>
                </Accordion.Item>
            })}
        </Accordion>}
    </Stack>
}
