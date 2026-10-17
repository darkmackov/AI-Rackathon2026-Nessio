import { pendingControlProps } from '../../components/pending-control'
import Button from '../../components/ActionButton'
import { Alert, Group, List, Modal, Paper, Spoiler, Stack, Text, Title } from '@mantine/core'
import { IconMessageCircle, IconSend } from '@tabler/icons-react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { createPatientNoticeMutation, getMdtConclusionOptions, getMdtRecordOptions, listCaseMessagesOptions, listCaseReceiptsOptions, listDocumentsOptions, sendFeedbackMutation } from '../../client/@tanstack/react-query.gen'
import type { Case } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import PersonChip from '../../components/PersonChip'
import { KindBadge, ReceiptStatus } from '../../components/messages/MessageParts'
import { refreshMessages } from '../../components/messages/refresh'
import WorkflowForm from '../../components/workflow/WorkflowForm'
import { useSession } from '../../session'
import { formatDate, formatDateTime } from '../../time'

// Mirrors when the backend records a patient notice: after the take-over, until the case is closed.
const noticeStates = ['v_triage', 'vraceno_lekari', 'ceka_na_podklady', 'kompletni', 'pripraveno_k_mdt', 'zaver_mdt', 'zpetna_vazba_odeslana']

export default function CommunicationTab({ item }: { item: Case }) {
    const { t, i18n } = useTranslation(), { actorId } = useSession(), client = useQueryClient(), busy = useIsMutating() > 0
    const options = { path: { case_id: item.id }, headers: actorHeaders(actorId ?? '') }
    const [dialog, setDialog] = useState<'send' | 'notify' | null>(null), [feedback, setFeedback] = useState<'sent' | 'notified' | null>(null)
    const messages = useQuery(listCaseMessagesOptions(options))
    const receipts = useQuery(listCaseReceiptsOptions(options))
    const sendable = item.state === 'zaver_mdt'
    const conclusion = useQuery({ ...getMdtConclusionOptions(options), enabled: sendable })
    const record = useQuery({ ...getMdtRecordOptions(options), enabled: sendable && dialog === 'send' })
    const documents = useQuery({ ...listDocumentsOptions(options), enabled: dialog === 'send' && !!conclusion.data?.document_id })
    const send = useMutation(sendFeedbackMutation()), notice = useMutation(createPatientNoticeMutation())
    const canSend = sendable && !!conclusion.data?.confirmed, canNotify = noticeStates.includes(item.state ?? '')
    const result = messages.data?.find((message) => message.kind === 'mdt_result')
    const uploaded = conclusion.data?.document_id ? documents.data?.find((document) => document.id === conclusion.data?.document_id) : undefined
    const open = (value: 'send' | 'notify') => { setFeedback(null); setDialog(value) }
    const done = (value: 'sent' | 'notified') => { setDialog(null); setFeedback(value) }
    return <Stack component="section" aria-labelledby="communication-heading" gap="md">
        <Group justify="space-between" align="flex-start">
            <Title order={2} size="h4" id="communication-heading">{t('caseDetail.tabs.communication')}</Title>
            <Group gap="xs">
                <Button size="xs" leftSection={<IconSend size={16} aria-hidden />} pending={busy} disabled={!canSend} onClick={() => open('send')}>{t('messages.sendGp')}</Button>
                <Button size="xs" variant="outline" leftSection={<IconMessageCircle size={16} aria-hidden />} pending={busy} disabled={!canNotify} onClick={() => open('notify')}>{t('messages.notify')}</Button>
            </Group>
        </Group>
        {sendable && conclusion.isError && <QueryError error={conclusion.error} retry={() => { void conclusion.refetch() }} />}
        {!canSend && !result && <Text size="sm" c="dimmed">{t('messages.sendUnavailable')}</Text>}
        {feedback && <Alert color="green" role="status">{t(`messages.${feedback}`)}</Alert>}
        <Paper withBorder p="sm" component="section" aria-labelledby="receipt-heading"><Stack gap="xs">
            <Title order={3} size="h5" id="receipt-heading">{t('messages.handoverState')}</Title>
            {messages.isPending && <LoadingState rows={1} />}
            {messages.isSuccess && !result && <Text size="sm">{t('messages.notSent')}</Text>}
            {result && <Group gap="lg" align="flex-start" wrap="wrap">
                {result.recipient_ids.map((recipient) => <Stack key={recipient} gap={4}>
                    <Group gap={6}><Text size="xs" c="dimmed">{t('messages.to')}:</Text><PersonChip id={recipient} size="xs" /></Group>
                    {receipts.isPending ? <LoadingState rows={1} /> : <ReceiptStatus message={result} receipts={receipts.isSuccess ? receipts.data : undefined} recipient={recipient} />}
                </Stack>)}
                <div><Text size="xs" c="dimmed">{t('messages.sentAt')}</Text><Text size="sm">{result.sent_at ? formatDateTime(result.sent_at, i18n.language) : t('unavailable')}</Text></div>
            </Group>}
            {receipts.isError && <QueryError error={receipts.error} retry={() => { void receipts.refetch() }} />}
        </Stack></Paper>
        <Title order={3} size="h5">{t('messages.history')}</Title>
        {messages.isPending && <LoadingState rows={3} />}
        {messages.isError && <QueryError error={messages.error} retry={() => { void messages.refetch() }} />}
        {messages.isSuccess && !messages.data.length && <EmptyState title={t('messages.noMessages')} />}
        {messages.data?.map((message) => <Paper key={message.id} component="article" withBorder p="sm" aria-label={message.subject}><Stack gap={6}>
            <Group justify="space-between" align="flex-start" gap="xs">
                <Stack gap={2}><KindBadge message={message} /><Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{message.subject}</Text></Stack>
                <Text size="xs" c="dimmed">{message.sent_at ? formatDateTime(message.sent_at, i18n.language) : t('unavailable')}</Text>
            </Group>
            <Group gap="md" wrap="wrap">
                <Group gap={6}><Text size="xs" c="dimmed">{t('messages.from')}:</Text><PersonChip id={message.sender_id} size="xs" /></Group>
                <Group gap={6}><Text size="xs" c="dimmed">{t('messages.to')}:</Text>{message.recipient_ids.length ? message.recipient_ids.map((id) => <PersonChip key={id} id={id} size="xs" />) : <Text size="sm">{t('messages.recipientPatient')}</Text>}</Group>
            </Group>
            {message.body ? <Spoiler maxHeight={60} showLabel={t('caseDetail.showMore')} hideLabel={t('caseDetail.showLess')}><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</Text></Spoiler> : <Text size="sm" c="dimmed">{t('messages.noNote')}</Text>}
            {message.recipient_ids.map((recipient) => <ReceiptStatus key={recipient} message={message} receipts={receipts.isSuccess ? receipts.data : undefined} recipient={recipient} />)}
        </Stack></Paper>)}
        <Modal opened={dialog === 'send'} onClose={() => { if (!busy) setDialog(null) }} title={t('messages.sendTitle')} size="lg" closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
            {dialog === 'send' && <Stack gap="sm">
                <Text size="sm">{t('messages.sendText')}</Text>
                <Group gap="lg" align="flex-start" wrap="wrap">
                    <div><Text size="xs" c="dimmed">{t('messages.patient')}</Text><Text size="sm" fw={600}>{item.patient_name}</Text></div>
                    <div><Text size="xs" c="dimmed" mb={4}>{t('referring_doctor')}</Text><PersonChip id={item.referring_doctor_id} size="xs" /></div>
                </Group>
                <div><Text size="sm" fw={600}>{t('messages.sendContents')}</Text>
                    {(record.isPending || documents.isLoading) && <LoadingState rows={1} />}
                    {record.isError && <QueryError error={record.error} retry={() => { void record.refetch() }} />}
                    {documents.isError && <QueryError error={documents.error} retry={() => { void documents.refetch() }} />}
                    {documents.isSuccess && conclusion.data?.document_id && !uploaded && <EmptyState title={t('mdt.noSource')} retry={() => { void documents.refetch() }} />}
                    <List size="sm" spacing={2}>
                        {conclusion.data?.confirmed && <List.Item>{t('messages.contentConclusion', { date: formatDateTime(conclusion.data.confirmed.at, i18n.language) })}</List.Item>}
                        {record.data && <List.Item>{t('messages.contentRecord', { date: formatDate(record.data.mdt_date, i18n.language) })}</List.Item>}
                        <List.Item>{t('messages.contentPdf')}</List.Item>
                        {uploaded && <List.Item>{t('messages.contentUpload', { name: uploaded.title ?? uploaded.filename })}</List.Item>}
                        <List.Item>{t('messages.contentQuoted')}</List.Item>
                    </List>
                </div>
                <WorkflowForm fields={[{ name: 'note', label: t('messages.noteLabel'), type: 'textarea' }]} initial={{ note: '' }} submitLabel={t('messages.sendGp')} submitDisabled={!canSend} onSaved={() => done('sent')}
                    submit={async (values) => { await send.mutateAsync({ ...options, body: { note: values.note.trim() || null } }); await refreshMessages(client, item.id) }} />
            </Stack>}
        </Modal>
        <Modal opened={dialog === 'notify'} onClose={() => { if (!busy) setDialog(null) }} title={t('messages.notifyTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
            {dialog === 'notify' && <Stack gap="sm">
                <Alert color="yellow" role="note" title={t('messages.simulated')}>{t('messages.simulationNote')}</Alert>
                <WorkflowForm fields={[{ name: 'subject', label: t('messages.subject'), required: true }, { name: 'body', label: t('messages.body'), type: 'textarea', required: true }]} initial={{ subject: '', body: '' }} submitLabel={t('messages.notifySubmit')} onSaved={() => done('notified')}
                    submit={async (values) => { await notice.mutateAsync({ ...options, body: { subject: values.subject.trim(), body: values.body.trim() } }); await refreshMessages(client, item.id) }} />
            </Stack>}
        </Modal>
    </Stack>
}
