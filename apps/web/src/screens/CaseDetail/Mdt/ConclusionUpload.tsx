import Button from '../../../components/ActionButton'
import { FileButton, Group, Paper, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { uploadMdtConclusionMutation } from '../../../client/@tanstack/react-query.gen'
import { QueryError } from '../../../components/DataState'
import { documentAccept, supportedFile, uploadMime } from '../../../components/documents/document-utils'
import { refreshCaseResults, rememberJob } from '../../../components/documents/use-document-ingest'
import { notifyWarning } from '../../../notifications/notify'

export default function ConclusionUpload({ caseId, actorId, processing = false }: { caseId: string; actorId: string; processing?: boolean }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [file, setFile] = useState<File | null>(null)
  const reset = useRef<() => void>(null)
  const mutation = useMutation({ ...uploadMdtConclusionMutation(), onSuccess: async (value) => { rememberJob(client, actorId, value.job); await refreshCaseResults(client, caseId); setFile(null); reset.current?.() } })
  const choose = (files: File[]) => {
    if (busy || processing) return
    const valid = files.length === 1 && supportedFile(files[0])
    setFile(valid ? files[0] : null)
    mutation.reset()
    if (!valid) notifyWarning(`conclusion-file:${caseId}`, <Stack gap="xs"><Text size="sm">{t('mdt.invalidFile')}</Text>{files.map((entry, index) => <Text size="sm" key={`${entry.name}-${index}`} style={{ overflowWrap: 'anywhere' }}>{entry.name}</Text>)}</Stack>)
  }
  return <Paper withBorder p="sm" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)) }}><Stack gap="sm">
    <Text fw={600}>{t('mdt.upload')}</Text><Text size="sm">{t('mdt.uploadHelp')}</Text>
    <FileButton accept={documentAccept} disabled={busy || processing} resetRef={reset} onChange={(value) => { if (value) choose([value]) }} inputProps={{ 'aria-label': t('mdt.chooseFile') }}>
      {(props) => <Button {...props} variant="outline" pending={busy || processing} disabled={false}>{t('mdt.chooseFile')}</Button>}
    </FileButton>
    {file && <Group justify="space-between"><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{file.name}</Text><Button variant="subtle" size="compact-sm" pending={busy} onClick={() => { setFile(null); reset.current?.() }}>{t('documents.remove')}</Button></Group>}
    {mutation.isError && <QueryError error={mutation.error} />}
    <Button pending={busy || processing || mutation.isPending} disabled={!file} onClick={() => {
      if (!file || busy || processing) return
      mutation.mutate({ headers: actorHeaders(actorId), path: { case_id: caseId }, body: { file: new File([file], file.name, { type: uploadMime(file), lastModified: file.lastModified }) } })
    }}>{t('mdt.uploadAction')}</Button>
  </Stack></Paper>
}
