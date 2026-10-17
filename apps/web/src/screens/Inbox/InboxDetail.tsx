import { Alert, Anchor, Button, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconCircleCheck } from '@tabler/icons-react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { confirmReceiptMutation, getMdtConclusionOptions, getMdtRecordOptions, listDocumentsOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, Message, Receipt } from '../../client/types.gen'
import LoadingState, { QueryError } from '../../components/DataState'
import { DownloadOriginal } from '../../components/documents/DocumentsTab'
import { refreshMessages } from '../../components/messages/refresh'
import { usePeople } from '../../components/people'
import { formatDate, formatDateTime } from '../../time'
import PdfDownload from '../CaseDetail/Mdt/PdfDownload'
import RecordView from '../CaseDetail/Mdt/RecordView'

const text = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

function Note({ message }: { message: Message }) {
    const { t } = useTranslation()
    return <div><Text size="sm" fw={600}>{t(message.kind === 'case_returned' ? 'messages.returnedNote' : 'messages.note')}</Text>
        <Text size="sm" c={message.body ? undefined : 'dimmed'} style={text}>{message.body || t('messages.noNote')}</Text></div>
}

function MdtResult({ message, item, actorId, receipt, receiptsReady }: { message: Message; item?: Case; actorId: string; receipt?: Receipt; receiptsReady: boolean }) {
    const { t, i18n } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0, { names } = usePeople()
    const [confirming, setConfirming] = useState(false), [showRecord, setShowRecord] = useState(false), [confirmed, setConfirmed] = useState(false)
    const options = { path: { case_id: message.case_id }, headers: actorHeaders(actorId) }
    const conclusion = useQuery(getMdtConclusionOptions(options))
    const record = useQuery({ ...getMdtRecordOptions(options), enabled: showRecord })
    const attachments = message.attachment_document_ids ?? []
    const documents = useQuery({ ...listDocumentsOptions(options), enabled: attachments.length > 0 })
    const confirm = useMutation({ ...confirmReceiptMutation(), onSuccess: async () => { await refreshMessages(client, message.case_id); setConfirming(false); setConfirmed(true) } })
    const value = conclusion.data
    return <Stack gap="sm">
        {conclusion.isPending && <LoadingState rows={2} />}
        {conclusion.isError && <QueryError error={conclusion.error} retry={() => { void conclusion.refetch() }} />}
        {value && <Paper withBorder p="sm"><Stack gap="xs">
            <Title order={3} size="h5">{t('mdt.conclusion')}</Title>
            {(value.diagnosis_name || value.diagnosis_code) && <Text size="sm"><Text span inherit fw={600}>{t('mdt.diagnosis')}: </Text>{[value.diagnosis_name, value.diagnosis_code].filter(Boolean).join(' · ')}</Text>}
            {value.date && <Text size="sm"><Text span inherit fw={600}>{t('mdt.date')}: </Text>{formatDate(value.date, i18n.language)}</Text>}
            <Text size="sm" style={text}>{value.conclusion || t('unavailable')}</Text>
            <Text size="sm" fw={600}>{t('mdt.recommendations')}</Text>
            <Text size="sm" style={text}>{value.recommendations?.join('\n') || t('unavailable')}</Text>
        </Stack></Paper>}
        <Note message={message} />
        {attachments.length > 0 && <div><Text size="sm" fw={600}>{t('messages.attachments')}</Text>
            {documents.isPending && <LoadingState rows={1} />}
            {documents.isError && <QueryError error={documents.error} retry={() => { void documents.refetch() }} />}
            {documents.data?.filter((document) => attachments.includes(document.id)).map((document) => <Group key={document.id} gap="xs"><Text size="sm">{document.title ?? document.filename}</Text><DownloadOriginal document={document} /></Group>)}
        </div>}
        <Group align="flex-start" gap="md"><PdfDownload caseId={message.case_id} actorId={actorId} kind="conclusion" /><PdfDownload caseId={message.case_id} actorId={actorId} kind="record" /></Group>
        <div>
            <Button variant="subtle" size="compact-sm" aria-expanded={showRecord} rightSection={showRecord ? <IconChevronUp size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />} onClick={() => setShowRecord(!showRecord)}>{t(showRecord ? 'messages.hideInput' : 'messages.showInput')}</Button>
            {showRecord && <Stack mt="xs">
                {record.isPending && <LoadingState rows={2} />}
                {record.isError && <QueryError error={record.error} retry={() => { void record.refetch() }} />}
                {record.data && <RecordView record={record.data} />}
            </Stack>}
        </div>
        {receipt
            ? <Alert color="green" role="status" icon={<IconCircleCheck aria-hidden />} title={t('messages.receipt')}>
                {confirmed && <Text size="sm">{t('messages.confirmed')}</Text>}
                <Text size="sm">{t('messages.receiptText', { name: names[receipt.recipient_id] ?? t('unavailable'), date: formatDateTime(receipt.confirmed_at, i18n.language) })}</Text>
            </Alert>
            : <Group><Button disabled={busy || !receiptsReady || !item || !conclusion.isSuccess} onClick={() => { confirm.reset(); setConfirming(true) }}>{t('messages.confirm')}</Button></Group>}
        <Modal opened={confirming} onClose={() => { if (!busy) setConfirming(false) }} title={t('messages.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
            <Stack>
                <Text size="sm">{t('messages.confirmText', { patient: item?.patient_name || t('referral.unnamed') })}</Text>
                {confirm.isError && <QueryError error={confirm.error} />}
                <Group justify="flex-end">
                    <Button variant="default" disabled={busy} onClick={() => setConfirming(false)}>{t('cancel')}</Button>
                    <Button loading={confirm.isPending} disabled={busy || !receiptsReady || !item || !conclusion.isSuccess} onClick={() => confirm.mutate({ headers: actorHeaders(actorId), path: { message_id: message.id } })}>{t('messages.confirm')}</Button>
                </Group>
            </Stack>
        </Modal>
    </Stack>
}

export default function InboxDetail({ message, item, actorId, receipts }: { message: Message; item?: Case; actorId: string; receipts?: Receipt[] }) {
    const { t } = useTranslation()
    if (message.kind === 'mdt_result') return <MdtResult message={message} item={item} actorId={actorId} receiptsReady={receipts !== undefined} receipt={receipts?.find((entry) => entry.message_id === message.id && entry.recipient_id === actorId)} />
    return <Stack gap="sm">
        <Note message={message} />
        {message.kind === 'case_returned' && <Anchor renderRoot={(props) => <Link {...props} to="/referrer/cases/$caseId" params={{ caseId: message.case_id }} />} size="sm">
            {t(item?.state === 'vraceno_lekari' ? 'messages.openReferral' : 'messages.showReferral')}
        </Anchor>}
    </Stack>
}
