import { pendingControlProps } from '../../components/pending-control'
import Button from '../../components/ActionButton'
import { Alert, Anchor, Group, List, Modal, Paper, Stack, Text, Title } from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconCircleCheck, IconPaperclip } from '@tabler/icons-react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { confirmReceiptMutation, getDocumentFileOptions, getMdtConclusionOptions, getMdtRecordOptions, listDocumentsOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, DocumentMeta, Message, Receipt } from '../../client/types.gen'
import LoadingState, { QueryError } from '../../components/DataState'
import DownloadFile from '../../components/documents/DownloadFile'
import { refreshMessages } from '../../components/messages/refresh'
import { usePeople } from '../../components/people'
import { formatDate, formatDateTime } from '../../time'
import PdfDownload from '../CaseDetail/Mdt/PdfDownload'
import RecordView from '../CaseDetail/Mdt/RecordView'

const text = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

function Note({ message }: { message: Message }) {
    const { t } = useTranslation()
    return <div><Text size="sm" fw={600}>{t(message.kind === 'case_returned' ? 'messages.returnedNote' : message.kind === 'mdt_result' ? 'messages.body' : 'messages.note')}</Text>
        <Text size="sm" c={message.body ? undefined : 'dimmed'} style={text}>{message.body || t('messages.noNote')}</Text></div>
}

/** An attached document as one compact download named after the document. */
function Attachment({ document, actorId }: { document: DocumentMeta; actorId: string }) {
    const download = useQuery({ ...getDocumentFileOptions({ path: { document_id: document.id }, headers: actorHeaders(actorId), parseAs: 'blob' }), enabled: false, gcTime: 0 })
    return <DownloadFile label={document.title || document.filename} leftSection={<IconPaperclip size={14} aria-hidden />} filename={document.filename} pending={download.isFetching} load={async () => {
        const result = await download.refetch()
        if (result.isError) throw result.error
        return result.data
    }} />
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
    const diagnosis = [value?.diagnosis_name, value?.diagnosis_code].filter(Boolean).join(' · ')
    return <Stack gap="md">
        {conclusion.isPending && <LoadingState rows={2} />}
        {conclusion.isError && <QueryError error={conclusion.error} retry={() => { void conclusion.refetch() }} />}
        {value && <Paper withBorder p="md"><Stack gap="xs">
            {diagnosis && <Text size="xs" c="dimmed" fw={600}>{t('mdt.conclusion')}</Text>}
            <Group justify="space-between" align="baseline" gap="xs" wrap="wrap">
                <Title order={4} size="h4" style={{ overflowWrap: 'anywhere' }}>{diagnosis || t('mdt.conclusion')}</Title>
                {value.date && <Text size="sm" c="dimmed"><Text span inherit fw={600}>{t('mdt.date')}: </Text>{formatDate(value.date, i18n.language)}</Text>}
            </Group>
            <Text size="sm" style={text}>{value.conclusion || t('unavailable')}</Text>
            <Text size="sm" fw={600} mt="xs">{t('mdt.recommendations')}</Text>
            {value.recommendations?.length
                ? <List size="sm" spacing={4}>{value.recommendations.map((entry, index) => <List.Item key={index} style={text}>{entry}</List.Item>)}</List>
                : <Text size="sm" c="dimmed">{t('unavailable')}</Text>}
        </Stack></Paper>}
        {receipt
            ? <Alert color="green" role="status" icon={<IconCircleCheck aria-hidden />} title={t('messages.receipt')}>
                {confirmed && <Text size="sm">{t('messages.confirmed')}</Text>}
                <Text size="sm">{t('messages.receiptText', { name: names[receipt.recipient_id] ?? t('unavailable'), date: formatDateTime(receipt.confirmed_at, i18n.language) })}</Text>
            </Alert>
            : <Group><Button pending={busy} disabled={!receiptsReady || !item || !conclusion.isSuccess} onClick={() => { confirm.reset(); setConfirming(true) }}>{t('messages.confirm')}</Button></Group>}
        <Note message={message} />
        <Stack gap={4}>
            <Title order={5} size="h6">{t('messages.materials')}</Title>
            <Group align="flex-start" gap="xs" wrap="wrap">
                <PdfDownload caseId={message.case_id} actorId={actorId} kind="conclusion" />
                {documents.data?.filter((document) => attachments.includes(document.id)).map((document) => <Attachment key={document.id} document={document} actorId={actorId} />)}
                <Button variant="subtle" size="compact-sm" aria-expanded={showRecord} rightSection={showRecord ? <IconChevronUp size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />} onClick={() => setShowRecord(!showRecord)}>{t(showRecord ? 'messages.hideInput' : 'messages.showInput')}</Button>
            </Group>
            {attachments.length > 0 && documents.isPending && <LoadingState rows={1} />}
            {attachments.length > 0 && documents.isError && <QueryError error={documents.error} retry={() => { void documents.refetch() }} />}
            {showRecord && <Stack mt="xs">
                {record.isPending && <LoadingState rows={2} />}
                {record.isError && <QueryError error={record.error} retry={() => { void record.refetch() }} />}
                {record.data && <RecordView record={record.data} />}
            </Stack>}
        </Stack>
        <Modal opened={confirming} onClose={() => { if (!busy) setConfirming(false) }} title={t('messages.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
            <Stack>
                <Text size="sm">{t('messages.confirmText', { patient: item?.patient_name || t('referral.unnamed') })}</Text>
                {confirm.isError && <QueryError error={confirm.error} />}
                <Group justify="flex-end">
                    <Button variant="default" pending={busy} onClick={() => setConfirming(false)}>{t('cancel')}</Button>
                    <Button pending={busy || confirm.isPending} disabled={!receiptsReady || !item || !conclusion.isSuccess} onClick={() => confirm.mutate({ headers: actorHeaders(actorId), path: { message_id: message.id } })}>{t('messages.confirm')}</Button>
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
