import { Alert, Button, Group, NativeSelect, Stack, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { updateDocumentMutation } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta, DocumentMetaUpdate } from '../../client/types.gen'
import { QueryError } from '../DataState'
import FormErrorSummary from '../FormErrorSummary'
import { documentType, documentTypes, validDocumentDate } from './document-utils'
import { refreshCaseResults } from './use-document-ingest'

const textFields = ['title', 'facility', 'department', 'author', 'ordered_by'] satisfies Array<keyof DocumentMetaUpdate>

export default function DocumentMetadataForm({ document, caseId, actorId, onClose }: {
  document: DocumentMeta; caseId: string; actorId: string; onClose: () => void;
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  const form = useForm<DocumentMetaUpdate>({
    initialValues: {
      title: document.title ?? '', doc_type: document.doc_type ?? null, document_date: document.document_date ?? '',
      facility: document.facility ?? '', department: document.department ?? '', author: document.author ?? '', ordered_by: document.ordered_by ?? '',
    },
    validateInputOnBlur: true,
    validate: { document_date: (value) => !value || validDocumentDate(value) ? null : 'documents.invalidDate' },
  })
  const save = useMutation({
    ...updateDocumentMutation(),
    onSuccess: async () => {
      await refreshCaseResults(client, caseId)
      form.resetDirty()
    },
  })
  return <form noValidate onSubmit={(event) => {
    setSubmitted(true)
    form.onSubmit((values) => {
      const body: DocumentMetaUpdate = {}
      for (const key of textFields) if (form.isDirty(key)) body[key] = values[key]?.trim() || null
      if (form.isDirty('doc_type')) body.doc_type = values.doc_type
      if (form.isDirty('document_date')) body.document_date = values.document_date || null
      save.mutate({ headers: actorHeaders(actorId), path: { document_id: document.id }, body })
    })(event)
  }}>
    <Stack>
      {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[t('documents.invalidDate')]} />}
      <NativeSelect label={t('documents.docType')} value={form.values.doc_type ?? ''} disabled={busy}
        data={[{ value: '', label: t('unavailable'), disabled: true }, ...Object.keys(documentTypes).map((value) => ({ value, label: t(`documents.types.${value}`) }))]}
        onChange={(event) => { form.setFieldValue('doc_type', documentType(event.currentTarget.value)); save.reset() }} />
      <TextInput type="date" label={t('documents.documentDate')} disabled={busy} {...form.getInputProps('document_date')}
        error={form.errors.document_date ? t('documents.invalidDate') : undefined} />
      {textFields.map((key) => <TextInput key={key} label={t(`documents.metadata.${key}`)} disabled={busy} {...form.getInputProps(key)} />)}
      {save.isError && <QueryError error={save.error} />}
      {save.isSuccess && !form.isDirty() && <Alert color="green" role="status">{t('documents.metadataSaved')}</Alert>}
      <Group><Button type="submit" loading={save.isPending} disabled={busy || !form.isDirty()}>{t('documents.save')}</Button>
        <Button variant="default" disabled={busy} onClick={onClose}>{t('close')}</Button></Group>
    </Stack>
  </form>
}
