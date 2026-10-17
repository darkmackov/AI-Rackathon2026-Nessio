import Button from '../../components/ActionButton'
import { pendingControlProps } from '../../components/pending-control'
import { Group, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { addExaminationMutation, getHandoverQueryKey } from '../../client/@tanstack/react-query.gen'
import type { ExaminationCreate } from '../../client/types.gen'
import { QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'
import { validDocumentDate } from '../../components/documents/document-utils'
import { refreshCaseResults } from '../../components/documents/use-document-ingest'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../notifications/form-validation'

export default function ExaminationForm({ caseId, actorId, close, saved }: { caseId: string; actorId: string; close: () => void; saved: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const id = useId()
  const [failedSubmits, setFailedSubmits] = useState(0)
  const labels = { date: t('referral.examDate'), place: t('referral.examPlace'), type: t('referral.examType'), result_full_text: t('referral.examResult') }
  const required = (input: string) => input.trim() ? null : t('workflow.required')
  const form = useForm<ExaminationCreate>({
    initialValues: { date: '', place: '', type: '', result_full_text: '' }, validateInputOnBlur: true,
    validate: { date: (value) => validDocumentDate(value) ? null : t('handoverEdit.invalidDate'), place: required, type: required, result_full_text: required }
  })
  const save = useMutation({
    ...addExaminationMutation(), onError: (error) => {
      const errors = apiFieldErrors(error, labels, t)
      if (Object.keys(errors).length) {
        form.setErrors({ ...form.errors, ...errors })
        setFailedSubmits((count) => count + 1)
      }
    }, onSuccess: async (handover) => {
      client.setQueryData(getHandoverQueryKey({ path: { case_id: caseId }, headers: actorHeaders(actorId) }), handover)
      await refreshCaseResults(client, caseId)
      saved()
    }
  })
  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }
    form.onSubmit((body) => save.mutate({ body, path: { case_id: caseId }, headers: actorHeaders(actorId) }), (errors) => {
      setFailedSubmits((count) => count + 1)
      notifyFormErrors(errors, labels, t, id)
    })(event)
  }}><Stack>
      {failedSubmits > 0 && <FormErrorSummary errors={formProblems(form.errors, labels)} focusKey={failedSubmits} />}
      <TextInput type="date" label={labels.date} {...form.getInputProps('date')} {...pendingControlProps(busy)} />
      <TextInput label={labels.place} {...form.getInputProps('place')} {...pendingControlProps(busy)} />
      <TextInput label={labels.type} {...form.getInputProps('type')} {...pendingControlProps(busy)} />
      <Textarea rows={6} label={labels.result_full_text} {...form.getInputProps('result_full_text')} {...pendingControlProps(busy)} />
      {save.isError && <QueryError error={save.error} />}
      <Group><Button type="submit" pending={busy || save.isPending} >{t('handoverEdit.save')}</Button><Button variant="default" pending={busy} onClick={close}>{t('cancel')}</Button></Group>
    </Stack></form>
}
