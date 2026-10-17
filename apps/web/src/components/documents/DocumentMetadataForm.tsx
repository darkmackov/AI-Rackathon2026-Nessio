import Button from '../ActionButton'
import { pendingControlProps } from '../pending-control'
import { Alert, Group, NativeSelect, Stack, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { updateDocumentMutation } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta, DocumentMetaUpdate } from '../../client/types.gen'
import { QueryError } from '../DataState'
import FormErrorSummary from '../FormErrorSummary'
import { documentType, documentTypes, validDocumentDate } from './document-utils'
import { refreshCaseResults } from './use-document-ingest'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../notifications/form-validation'

const textFields = ['title', 'facility', 'department', 'author', 'ordered_by'] satisfies Array<keyof DocumentMetaUpdate>

export default function DocumentMetadataForm({ document, caseId, actorId, onClose }: {
  document: DocumentMeta; caseId: string; actorId: string; onClose: () => void;
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const id = useId()
  const [failedSubmits, setFailedSubmits] = useState(0)
  const labels = { ...Object.fromEntries(textFields.map((key) => [key, t(`documents.metadata.${key}`)])), doc_type: t('documents.docType'), document_date: t('documents.documentDate') }
  const form = useForm<DocumentMetaUpdate>({
    initialValues: {
      title: document.title ?? '', doc_type: document.doc_type ?? null, document_date: document.document_date ?? '',
      facility: document.facility ?? '', department: document.department ?? '', author: document.author ?? '', ordered_by: document.ordered_by ?? '',
    },
    validateInputOnBlur: true,
    validate: { document_date: (value) => !value || validDocumentDate(value) ? null : t('documents.invalidDate') },
  })
  const save = useMutation({
    ...updateDocumentMutation(),
    onError: (error) => {
      const errors = apiFieldErrors(error, labels, t)
      if (Object.keys(errors).length) {
        form.setErrors({ ...form.errors, ...errors })
        setFailedSubmits((count) => count + 1)
      }
    },
    onSuccess: async () => {
      await refreshCaseResults(client, caseId)
      form.resetDirty()
    },
  })
  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }
    form.onSubmit((values) => {
      const body: DocumentMetaUpdate = {}
      for (const key of textFields) if (form.isDirty(key)) body[key] = values[key]?.trim() || null
      if (form.isDirty('doc_type')) body.doc_type = values.doc_type
      if (form.isDirty('document_date')) body.document_date = values.document_date || null
      save.mutate({ headers: actorHeaders(actorId), path: { document_id: document.id }, body })
    }, (errors) => {
      setFailedSubmits((count) => count + 1)
      notifyFormErrors(errors, labels, t, id)
    })(event)
  }}>
    <Stack>
      {failedSubmits > 0 && <FormErrorSummary errors={formProblems(form.errors, labels)} focusKey={failedSubmits} />}
      <NativeSelect label={t('documents.docType')} value={form.values.doc_type ?? ''} {...pendingControlProps(busy)}
        data={[{ value: '', label: t('unavailable'), disabled: true }, ...Object.keys(documentTypes).map((value) => ({ value, label: t(`documents.types.${value}`) }))]}
        onChange={(event) => { form.setFieldValue('doc_type', documentType(event.currentTarget.value)); save.reset() }}
        onBlur={() => form.validateField('doc_type')} error={form.errors.doc_type} />
      <TextInput type="date" label={t('documents.documentDate')} {...pendingControlProps(busy)} {...form.getInputProps('document_date')} />
      {textFields.map((key) => <TextInput key={key} label={t(`documents.metadata.${key}`)} {...pendingControlProps(busy)} {...form.getInputProps(key)} />)}
      {save.isError && <QueryError error={save.error} />}
      {save.isSuccess && !form.isDirty() && <Alert color="green" role="status">{t('documents.metadataSaved')}</Alert>}
      <Group><Button type="submit" pending={busy || save.isPending} disabled={!form.isDirty()}>{t('documents.save')}</Button>
        <Button variant="default" pending={busy} onClick={onClose}>{t('close')}</Button></Group>
    </Stack>
  </form>
}
