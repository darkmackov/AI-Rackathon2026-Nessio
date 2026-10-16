import { Alert, Button, FileButton, Group, Paper, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { uploadMdtConclusionMutation } from '../../../client/@tanstack/react-query.gen'
import { QueryError } from '../../../components/DataState'
import { documentAccept, supportedFile, uploadMime } from '../../../components/documents/document-utils'
import { refreshCaseResults, rememberJob } from '../../../components/documents/use-document-ingest'

export default function ConclusionUpload({ caseId, actorId, disabled }: { caseId: string; actorId: string; disabled: boolean }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [file, setFile] = useState<File | null>(null), [invalid, setInvalid] = useState(false)
  const reset = useRef<() => void>(null)
  const mutation = useMutation({ ...uploadMdtConclusionMutation(), onSuccess: async (value) => { rememberJob(client, actorId, value.job); await refreshCaseResults(client, caseId); setFile(null); reset.current?.() } })
  const choose = (files: File[]) => { if (busy || disabled) return; const valid = files.length === 1 && supportedFile(files[0]); setInvalid(!valid); setFile(valid ? files[0] : null); mutation.reset() }
  return <Paper withBorder p="sm" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)) }}><Stack gap="sm">
    <Text fw={600}>{t('mdt.upload')}</Text><Text size="sm">{t('mdt.uploadHelp')}</Text>
    <FileButton accept={documentAccept} resetRef={reset} onChange={(value) => { if (value) choose([value]) }} inputProps={{ 'aria-label': t('mdt.chooseFile') }}>
      {(props) => <Button {...props} variant="outline" disabled={busy || disabled}>{t('mdt.chooseFile')}</Button>}
    </FileButton>
    {file && <Group justify="space-between"><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{file.name}</Text><Button variant="subtle" size="compact-sm" disabled={busy} onClick={() => { setFile(null); reset.current?.() }}>{t('documents.remove')}</Button></Group>}
    {invalid && <Alert color="red" role="alert">{t('mdt.invalidFile')}</Alert>}
    {mutation.isError && <QueryError error={mutation.error} />}
    <Button loading={mutation.isPending} disabled={busy || disabled || !file} onClick={() => {
      if (!file || busy || disabled) return
      mutation.mutate({ headers: actorHeaders(actorId), path: { case_id: caseId }, body: { file: new File([file], file.name, { type: uploadMime(file), lastModified: file.lastModified }) } })
    }}>{t('mdt.uploadAction')}</Button>
  </Stack></Paper>
}
