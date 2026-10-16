import { Alert, Badge, Button, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { getDocumentFileOptions, listDocumentsOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, DocumentMeta } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../DataState'
import DocumentJobs from '../documents/DocumentJobs'
import DocumentMetadataForm from '../documents/DocumentMetadataForm'
import DocumentUploader from '../documents/DocumentUploader'
import { useSession } from '../../session'
import { formatDateTime, formatDate } from '../../time'
import type { OpenSource } from '../handover/ClinicalValue'

export function DownloadOriginal({ document }: { document: DocumentMeta }) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const download = useQuery({ ...getDocumentFileOptions({ path: { document_id: document.id }, headers: actorHeaders(actorId ?? ''), parseAs: 'blob' }), enabled: false, gcTime: 0 })
  const [feedback, setFeedback] = useState<'downloaded' | 'downloadError' | null>(null)
  const link = useRef<HTMLAnchorElement | null>(null)
  const url = useRef<string | null>(null)
  const linkRef = useCallback((node: HTMLAnchorElement | null) => {
    link.current = node
    return () => {
      link.current = null
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = null
    }
  }, [])
  return <Stack gap={4}><Button variant="subtle" size="compact-sm" loading={download.isFetching} onClick={async () => {
    setFeedback(null)
    const result = await download.refetch()
    if (!link.current) return // Identity changed or detail was reset while loading.
    if (result.isError || !(result.data instanceof Blob)) { setFeedback('downloadError'); return }
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = URL.createObjectURL(result.data)
    link.current.href = url.current
    link.current.click()
    setFeedback('downloaded')
  }}>{t('caseDetail.download')}</Button>
    <a hidden ref={linkRef} download={document.filename} />
    {feedback && <Text size="sm" role={feedback === 'downloadError' ? 'alert' : 'status'} c={feedback === 'downloadError' ? 'red.9' : undefined}>{t(`caseDetail.${feedback}`)}</Text>}
  </Stack>
}

function DocumentTable({ item, documents, names, openSource, onEdit, editDisabled }: {
  item: Case; documents: DocumentMeta[]; names: Record<string, string>; openSource: OpenSource; onEdit: (id: string) => void; editDisabled: boolean;
}) {
  const { t, i18n } = useTranslation()
  const sorted = [...documents].sort((a, b) => (a.document_date ?? '9999').localeCompare(b.document_date ?? '9999') || a.filename.localeCompare(b.filename))
  return <Table.ScrollContainer minWidth={640}><Table withTableBorder verticalSpacing="sm" fz="sm"><Table.Thead><Table.Tr>
    {['caseDetail.document', 'documents.documentDate', 'documents.metadata.facility', 'caseDetail.actions'].map((label) => <Table.Th key={label} style={{ overflowWrap: 'normal' }}>{t(label)}</Table.Th>)}
  </Table.Tr></Table.Thead><Table.Tbody>
    {sorted.map((document) => <Table.Tr key={document.id} style={{ verticalAlign: 'top' }}>
      <Table.Td w="38%">
        <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{document.title ?? document.filename}</Text>
        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{document.filename}</Text>
        <Group gap={4} mt={4}><Badge size="sm" variant="light">{t(`documents.types.${document.doc_type ?? 'other'}`)}</Badge>{document.uploaded_by === item.referring_doctor_id && <Badge size="sm" color="green" c="dark.9" variant="light">{t('caseDetail.fromGp')}</Badge>}</Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{document.document_date ? formatDate(document.document_date, i18n.language) : t('unavailable')}</Text>
        <Text size="xs" c="dimmed">{t('documents.receivedAt')}: {document.received_at ? formatDateTime(document.received_at, i18n.language) : t('unavailable')}</Text>
      </Table.Td>
      <Table.Td>
        {document.facility || document.department
          ? <>{document.facility && <Text size="sm">{document.facility}</Text>}{document.department && <Text size="xs" c="dimmed">{document.department}</Text>}</>
          : <Text size="sm">{t('unavailable')}</Text>}
        {([['metadata.author', document.author], ['metadata.ordered_by', document.ordered_by], ['uploadedBy', document.uploaded_by ? names[document.uploaded_by] : null]] as const)
          .filter(([, value]) => value).map(([label, value]) => <Text size="xs" c="dimmed" key={label}>{t(`documents.${label}`)}: {value}</Text>)}
      </Table.Td>
      <Table.Td><Stack gap={4} align="flex-start">
        <Button variant="subtle" size="compact-sm" onClick={(event) => openSource({ documentId: document.id }, event.currentTarget)}>{t('caseDetail.showText')}</Button>
        <DownloadOriginal document={document} />
        <Button variant="subtle" size="compact-sm" disabled={editDisabled} onClick={() => onEdit(document.id)}>{t('documents.edit')}</Button>
      </Stack></Table.Td>
    </Table.Tr>)}
  </Table.Tbody></Table></Table.ScrollContainer>
}

export default function DocumentsTab({ item, names, openSource, readOnly = false }: { item: Case; names: Record<string, string>; openSource: OpenSource; readOnly?: boolean }) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const uploadHeading = useId()
  const listHeading = useId()
  const busy = useIsMutating() > 0
  const [editingId, setEditingId] = useState<string | null>(null)
  const actor = actorId ?? ''
  const documents = useQuery(listDocumentsOptions({ path: { case_id: item.id }, headers: actorHeaders(actor) }))
  const editing = documents.data?.find((document) => document.id === editingId)
  return <Stack gap="lg">
    {!readOnly && <Stack component="section" aria-labelledby={uploadHeading} gap="sm">
      <Title order={2} size="h4" id={uploadHeading}>{t('documents.uploadTitle')}</Title>
      <DocumentUploader caseId={item.id} actorId={actor} />
    </Stack>}
    <DocumentJobs caseId={item.id} actorId={actor} documents={documents.data ?? []} disabled={busy || readOnly} />
    <Stack component="section" aria-labelledby={listHeading} gap="sm">
      <Title order={2} size="h4" id={listHeading}>{t('documents.list')}</Title>
      {documents.isPending && <LoadingState rows={5} />}
      {documents.isError && <QueryError error={documents.error} pending={documents.isFetching} retry={() => { void documents.refetch() }} />}
      {documents.isSuccess && !documents.data.length && <EmptyState title={t('documents.empty')} description={t('documents.emptyHelp')} />}
      {documents.isSuccess && documents.data.length > 0 && <DocumentTable item={item} documents={documents.data} names={names} openSource={openSource} onEdit={setEditingId} editDisabled={busy || readOnly} />}
    </Stack>
    <Drawer opened={!!editing && !readOnly} onClose={() => { if (!busy) setEditingId(null) }} title={t('documents.edit')} position="right" size="md"
      closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {editing && !readOnly && <DocumentMetadataForm key={editing.id} document={editing} caseId={item.id} actorId={actor} onClose={() => setEditingId(null)} />}
    </Drawer>
  </Stack>
}

export function MissingDocument() {
  const { t } = useTranslation()
  return <Alert color="orange" role="status">{t('caseDetail.sourceMissing')}</Alert>
}
