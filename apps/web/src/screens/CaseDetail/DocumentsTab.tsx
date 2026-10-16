import { Alert, Badge, Button, Group, Stack, Table, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { getDocumentFileOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, DocumentMeta } from '../../client/types.gen'
import { EmptyState } from '../../components/DataState'
import { useSession } from '../../session'
import { formatDateTime, formatDate } from '../../time'
import type { OpenSource } from './ClinicalValue'

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
  }}>{t('s1.download')}</Button>
    <a hidden ref={linkRef} download={document.filename} />
    {feedback && <Text size="sm" role={feedback === 'downloadError' ? 'alert' : 'status'} c={feedback === 'downloadError' ? 'red.9' : undefined}>{t(`s1.${feedback}`)}</Text>}
  </Stack>
}

export default function DocumentsTab({ item, documents, names, openSource }: { item: Case; documents: DocumentMeta[]; names: Record<string, string>; openSource: OpenSource }) {
  const { t, i18n } = useTranslation()
  const sorted = [...documents].sort((a, b) => (a.document_date ?? '9999').localeCompare(b.document_date ?? '9999') || a.filename.localeCompare(b.filename))
  return <Stack>
    {!sorted.length && <EmptyState title={t('s1.noDocuments')} />}
    {sorted.length > 0 && <Table.ScrollContainer minWidth={760}><Table withTableBorder verticalSpacing="sm" fz="sm"><Table.Thead><Table.Tr>
      {['s1.document', 's1.documentDate', 's1.facility', 's1.actions'].map((label) => <Table.Th key={label}>{t(label)}</Table.Th>)}
    </Table.Tr></Table.Thead><Table.Tbody>
        {sorted.map((document) => <Table.Tr key={document.id} style={{ verticalAlign: 'top' }}>
          <Table.Td w="38%">
            <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{document.title ?? document.filename}</Text>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{document.filename}</Text>
            <Group gap={4} mt={4}><Badge size="sm" variant="light">{t(`s1.documentTypes.${document.doc_type ?? 'other'}`)}</Badge>{document.uploaded_by === item.referring_doctor_id && <Badge size="sm" color="green" c="dark.9" variant="light">{t('s1.fromGp')}</Badge>}</Group>
          </Table.Td>
          <Table.Td>
            <Text size="sm">{document.document_date ? formatDate(document.document_date, i18n.language) : t('unavailable')}</Text>
            <Text size="xs" c="dimmed">{t('s1.received')}: {document.received_at ? formatDateTime(document.received_at, i18n.language) : t('unavailable')}</Text>
          </Table.Td>
          <Table.Td>
            <Text size="sm">{[document.facility, document.department].filter(Boolean).join(' · ') || t('unavailable')}</Text>
            {([['author', document.author], ['orderedBy', document.ordered_by], ['uploadedBy', document.uploaded_by ? names[document.uploaded_by] : null]] as const)
              .filter(([, value]) => value).map(([label, value]) => <Text size="xs" c="dimmed" key={label}>{t(`s1.${label}`)}: {value}</Text>)}
          </Table.Td>
          <Table.Td><Stack gap={4} align="flex-start"><Button variant="subtle" size="compact-sm" onClick={(event) => openSource({ documentId: document.id }, event.currentTarget)}>{t('s1.showText')}</Button><DownloadOriginal document={document} /></Stack></Table.Td>
        </Table.Tr>)}
      </Table.Tbody></Table></Table.ScrollContainer>}
  </Stack>
}

export function MissingDocument() {
  const { t } = useTranslation()
  return <Alert color="orange" role="status">{t('s1.sourceMissing')}</Alert>
}
