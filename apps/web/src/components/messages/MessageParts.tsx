import { Badge, Group, Text } from '@mantine/core'
import { IconCircleCheck, IconClockHour4 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Message, Receipt } from '../../client/types.gen'
import { formatDateTime } from '../../time'

const kindColor: Record<string, string> = { mdt_result: 'blue', case_returned: 'orange', patient_notice: 'grape' }

export function KindBadge({ message }: { message: Message }) {
    const { t } = useTranslation()
    return <Group gap={4}>
        <Badge size="sm" variant="light" color={kindColor[message.kind] ?? 'gray'} c="dark.9">{t(`messages.kinds.${message.kind}`)}</Badge>
        <SimulatedBadge message={message} />
    </Group>
}

export function SimulatedBadge({ message }: { message: Message }) {
    const { t } = useTranslation()
    return message.simulated ? <Badge size="sm" variant="outline" color="gray" c="dark.9">{t('messages.simulated')}</Badge> : null
}

/** The inbox owner's own receipt of an MDT result: waiting for it, or received on a date. */
export function InboxStatus({ message, receipt, waiting }: { message: Message; receipt?: Receipt; waiting: boolean }) {
    const { t, i18n } = useTranslation()
    if (message.kind !== 'mdt_result') return null
    if (receipt) return <Group gap={4} wrap="nowrap"><IconCircleCheck size={14} color="var(--mantine-color-dimmed)" aria-hidden /><Text size="xs" c="dimmed">{t('messages.received', { date: formatDateTime(receipt.confirmed_at, i18n.language) })}</Text></Group>
    return waiting ? <Group gap={4} wrap="nowrap"><IconClockHour4 size={16} color="var(--mantine-color-orange-8)" aria-hidden /><Text size="sm" fw={500} c="orange.9">{t('messages.waitingYou')}</Text></Group> : null
}

/** Receipt state of one recipient; only an MDT result asks for one. */
export function ReceiptStatus({ message, receipts, recipient }: { message: Message; receipts?: Receipt[]; recipient: string }) {
    const { t, i18n } = useTranslation()
    if (message.kind !== 'mdt_result' || receipts === undefined) return null
    const receipt = receipts?.find((entry) => entry.message_id === message.id && entry.recipient_id === recipient)
    return receipt
        ? <Group gap={4} wrap="nowrap"><IconCircleCheck size={16} color="var(--mantine-color-green-8)" aria-hidden /><Text size="sm" c="green.9">{t('messages.received', { date: formatDateTime(receipt.confirmed_at, i18n.language) })}</Text></Group>
        : <Group gap={4} wrap="nowrap"><IconClockHour4 size={16} color="var(--mantine-color-orange-8)" aria-hidden /><Text size="sm" c="orange.9">{t('messages.waiting')}</Text></Group>
}
