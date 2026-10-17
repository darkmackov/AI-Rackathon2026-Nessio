import { Accordion, Badge, Group, Stack, Text, Title } from '@mantine/core'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import Button from '../../components/ActionButton'
import { listCaseReceiptsOptions, listCasesOptions, listInboxOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, Message, Receipt } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { InboxStatus, SimulatedBadge } from '../../components/messages/MessageParts'
import { usePeople } from '../../components/people'
import { formatDateTime } from '../../time'
import InboxDetail from './InboxDetail'

type Row = { message: Message; item?: Case; receipts?: Receipt[]; receipt?: Receipt; todo: boolean }

const itemStyles = { item: { backgroundColor: 'var(--mantine-color-body)', borderColor: 'var(--mantine-color-default-border)' } }
const todoAccent = { borderLeft: '4px solid var(--mantine-color-orange-6)' }

function InboxRow({ row, actorId, opened }: { row: Row; actorId: string; opened: boolean }) {
    const { t, i18n } = useTranslation()
    const { names } = usePeople()
    const { message, item, receipts, receipt, todo } = row
    return <Accordion.Item value={message.id} style={todo && !receipt ? todoAccent : undefined}>
        <Accordion.Control>
            <Stack gap={2}>
                <Group justify="space-between" gap="xs" wrap="wrap">
                    <Group gap="xs" wrap="wrap">
                        <Text style={{ overflowWrap: 'anywhere' }}><Text span inherit fw={600}>{item?.patient_name || t('referral.unnamed')}</Text> · {t(`messages.kinds.${message.kind}`)}</Text>
                        <SimulatedBadge message={message} />
                    </Group>
                    <InboxStatus message={message} receipt={receipt} waiting={todo && receipts !== undefined} />
                </Group>
                <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                    {[message.subject, names[message.sender_id] ?? t('unavailable'), message.sent_at ? formatDateTime(message.sent_at, i18n.language) : t('unavailable')].join(' · ')}
                </Text>
            </Stack>
        </Accordion.Control>
        <Accordion.Panel>{opened && <InboxDetail message={message} item={item} actorId={actorId} receipts={receipts} />}</Accordion.Panel>
    </Accordion.Item>
}

/** The GP's inbox: what waits for their action first, the rest collapsed; each group keeps the API's newest-first order. */
export default function Inbox({ actorId }: { actorId: string }) {
    const { t } = useTranslation()
    const headers = actorHeaders(actorId)
    const doneId = useId()
    // The opened row stays in the group it was opened from, so confirming a receipt doesn't move it away.
    const [opened, setOpened] = useState<{ id: string; todo: boolean } | null>(null)
    const [showDone, setShowDone] = useState(false)
    const inbox = useQuery(listInboxOptions({ headers }))
    const cases = useQuery(listCasesOptions({ headers, query: { referring_doctor_id: actorId } }))
    const caseIds = [...new Set(inbox.data?.map((message) => message.case_id) ?? [])]
    const receipts = useQueries({ queries: caseIds.map((id) => listCaseReceiptsOptions({ headers, path: { case_id: id } })) })
    const receiptError = receipts.find((query) => query.isError)
    const { actors } = usePeople()
    // Unknown receipts or case state keep a message in the to-do group without inventing a status.
    const rows: Row[] = (inbox.data ?? []).map((message) => {
        const item = cases.data?.find((entry) => entry.id === message.case_id)
        const receiptQuery = receipts[caseIds.indexOf(message.case_id)]
        const caseReceipts = receiptQuery?.isSuccess ? receiptQuery.data : undefined
        const receipt = caseReceipts?.find((entry) => entry.message_id === message.id && entry.recipient_id === actorId)
        const todo = message.kind === 'mdt_result' ? !receipt : message.kind === 'case_returned' ? !item || item.state === 'vraceno_lekari' : false
        return { message, item, receipts: caseReceipts, receipt, todo: opened?.id === message.id ? opened.todo : todo }
    })
    const todo = rows.filter((row) => row.todo), done = rows.filter((row) => !row.todo)
    const pending = todo.filter((row) => row.message.kind === 'mdt_result' && row.receipts !== undefined && !row.receipt).length
    const list = (group: Row[], isTodo: boolean) => <Accordion variant="separated" value={opened?.id ?? null} onChange={(id) => setOpened(id ? { id, todo: isTodo } : null)} chevronPosition="right" styles={itemStyles}>
        {group.map((row) => <InboxRow key={row.message.id} row={row} actorId={actorId} opened={opened?.id === row.message.id} />)}
    </Accordion>
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
        {inbox.isSuccess && inbox.data.length > 0 && <>
            <Stack component="section" aria-labelledby="inbox-todo" gap="xs">
                <Title order={3} size="h5" id="inbox-todo">{t('messages.todo')}</Title>
                {todo.length ? list(todo, true) : <Text size="sm" c="dimmed">{t('messages.nothingToDo')}</Text>}
            </Stack>
            {done.length > 0 && <Stack gap="xs">
                <div><Button variant="subtle" color="gray" size="compact-sm" aria-expanded={showDone} aria-controls={doneId}
                    rightSection={showDone ? <IconChevronUp size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />}
                    onClick={() => setShowDone(!showDone)}>{t('messages.showDone', { count: done.length })}</Button></div>
                <div id={doneId} role="region" aria-label={t('messages.done')} hidden={!showDone}>{showDone && list(done, false)}</div>
            </Stack>}
        </>}
    </Stack>
}
