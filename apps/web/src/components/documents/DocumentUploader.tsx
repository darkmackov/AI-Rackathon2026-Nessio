import Button from '../ActionButton'
import { Alert, Badge, FileButton, Group, Paper, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { uploadDocumentMutation } from '../../client/@tanstack/react-query.gen'
import type { DuplicateMatch } from '../../client/types.gen'
import { notifyWarning } from '../../notifications/notify'
import { QueryError } from '../DataState'
import { documentAccept, supportedFile, uploadMime } from './document-utils'
import { refreshCaseResults, rememberJob } from './use-document-ingest'

type SelectedFile = { id: number; file: File; status: 'waiting' | 'uploading' | 'uploaded' | 'failed'; error?: unknown; duplicates?: DuplicateMatch[] }

export type DocumentUploaderProps = { caseId: string; actorId: string; receivedAt?: string; disabled?: boolean }

function DocumentUploaderForm({ caseId, actorId, receivedAt, disabled = false }: DocumentUploaderProps) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const [files, setFiles] = useState<SelectedFile[]>([])
  const [sending, setSending] = useState(false)
  const nextId = useRef(0)
  const resetInput = useRef<() => void>(null)
  const upload = useMutation({
    ...uploadDocumentMutation(),
    onSuccess: async (result) => {
      rememberJob(client, actorId, result.job)
      await refreshCaseResults(client, caseId)
    },
  })
  const pending = busy || sending
  const unavailable = disabled || !actorId || !caseId
  const blocked = unavailable || pending

  function select(selected: File[]) {
    if (blocked) return
    const invalid = selected.filter((file) => !supportedFile(file)).map((file) => file.name)
    if (invalid.length > 0) notifyWarning(`document-files:${caseId}`, <Stack gap="xs"><Text size="sm">{t('documents.invalidFileHelp')}</Text>{invalid.map((name, index) => <Text size="sm" key={`${name}-${index}`} style={{ overflowWrap: 'anywhere' }}>{name}</Text>)}</Stack>)
    setFiles((current) => [...current, ...selected.filter(supportedFile).map((file): SelectedFile => ({ id: ++nextId.current, file, status: 'waiting' }))])
  }

  async function send() {
    if (blocked) return
    setSending(true)
    try {
      for (const entry of files.filter((item) => item.status === 'waiting' || item.status === 'failed')) {
        setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'uploading', error: undefined } : item))
        try {
          // Preserve the original bytes, supplying the parser MIME if the browser omitted it.
          const file = new File([entry.file], entry.file.name, { type: uploadMime(entry.file), lastModified: entry.file.lastModified })
          const result = await upload.mutateAsync({ headers: actorHeaders(actorId), path: { case_id: caseId }, body: { file, ...(receivedAt ? { received_at: receivedAt } : {}) } })
          setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'uploaded', duplicates: result.duplicates ?? [] } : item))
        } catch (error) {
          setFiles((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'failed', error } : item))
        }
      }
    } finally { setSending(false) }
  }

  return <Stack gap="sm">
    <Paper withBorder p="sm" style={{ borderStyle: 'dashed' }} onDragOver={(event) => { event.preventDefault() }} onDrop={(event) => {
      event.preventDefault()
      select(Array.from(event.dataTransfer.files))
    }}>
      <Group gap="sm" justify="space-between" wrap="wrap">
        <div><Text size="sm" fw={600}>{t('documents.drop')}</Text>
          <Text size="xs" c="dimmed">{t('documents.formats')}</Text></div>
        <FileButton multiple accept={documentAccept} disabled={blocked} resetRef={resetInput} onChange={(selected) => { select(selected); resetInput.current?.() }} inputProps={{ 'aria-label': t('documents.choose') }}>
          {(props) => <Button {...props} variant="outline" size="xs" pending={pending} disabled={unavailable}>{t('documents.choose')}</Button>}
        </FileButton>
      </Group>
    </Paper>
    {files.length > 0 && <Stack component="ul" gap="sm" m={0} pl={0} style={{ listStyle: 'none' }} aria-label={t('documents.selected')}>
      {files.map((entry) => <Paper component="li" withBorder px="sm" py="xs" key={entry.id}>
        <Stack gap="xs"><Group justify="space-between" align="flex-start">
          <div><Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{entry.file.name}</Text><Text size="xs" c="dimmed">{new Intl.NumberFormat(i18n.language).format(entry.file.size)} {t('documents.bytes')}</Text></div>
          <Button variant="subtle" size="compact-sm" pending={sending || busy} aria-label={t('documents.removeNamed', { name: entry.file.name })}
            onClick={() => setFiles((current) => current.filter((item) => item.id !== entry.id))}>{t('documents.remove')}</Button>
        </Group>
          <Group role="status"><Badge color={entry.status === 'failed' ? 'red' : entry.status === 'uploaded' ? 'green' : 'blue'} variant="light">{t(`documents.uploadStatus.${entry.status}`)}</Badge></Group>
          {entry.error != null && <QueryError error={entry.error} />}
          {entry.duplicates && entry.duplicates.length > 0 && <Alert color="yellow" title={t('documents.duplicateTitle')}>
            <Text size="sm">{t('documents.duplicateHelp')}</Text>
            <Stack component="ul" gap={2} mt="xs" pl="md">
              {entry.duplicates.map((match) => <Text component="li" size="sm" key={match.document_id}>
                {match.kind === 'exact' ? t('documents.duplicateExact', { name: match.filename })
                  : t('documents.duplicateNear', { name: match.filename, percent: new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(match.similarity) })}
              </Text>)}
            </Stack>
          </Alert>}
        </Stack>
      </Paper>)}
    </Stack>}
    {files.length > 0 && <Button onClick={() => { void send() }} pending={pending} disabled={unavailable || !sending && !files.some((file) => file.status === 'waiting' || file.status === 'failed')}>
      {t('documents.upload')}
    </Button>}
  </Stack>
}

export default function DocumentUploader(props: DocumentUploaderProps) {
  return <DocumentUploaderForm key={`${props.caseId}-${props.actorId}`} {...props} />
}
