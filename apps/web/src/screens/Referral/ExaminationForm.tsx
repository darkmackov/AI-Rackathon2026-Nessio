import { Button, Group, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { addExaminationMutation, getHandoverQueryKey } from '../../client/@tanstack/react-query.gen'
import type { ExaminationCreate } from '../../client/types.gen'
import { QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'
import { validDocumentDate } from '../../components/documents/document-utils'
import { refreshCaseResults } from '../../components/documents/use-document-ingest'

export default function ExaminationForm({ caseId, actorId, close, saved }: { caseId: string; actorId: string; close: () => void; saved: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  const required = (input: string) => input.trim() ? null : 'referral.requiredExam'
  const form = useForm<ExaminationCreate>({ initialValues: { date: '', place: '', type: '', result_full_text: '' }, validateInputOnBlur: true,
    validate: { date: (value) => validDocumentDate(value) ? null : 'handoverEdit.invalidDate', place: required, type: required, result_full_text: required } })
  const save = useMutation({ ...addExaminationMutation(), onSuccess: async (handover) => {
    client.setQueryData(getHandoverQueryKey({ path: { case_id: caseId }, headers: actorHeaders(actorId) }), handover)
    await refreshCaseResults(client, caseId)
    saved()
  } })
  const error = (key: keyof ExaminationCreate) => form.errors[key] ? t(String(form.errors[key])) : undefined
  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }
    setSubmitted(true)
    form.onSubmit((body) => save.mutate({ body, path: { case_id: caseId }, headers: actorHeaders(actorId) }))(event)
  }}><Stack>
    {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[t('referral.requiredExam')]} />}
    <TextInput type="date" label={t('referral.examDate')} {...form.getInputProps('date')} error={error('date')} disabled={busy} />
    <TextInput label={t('referral.examPlace')} {...form.getInputProps('place')} error={error('place')} disabled={busy} />
    <TextInput label={t('referral.examType')} {...form.getInputProps('type')} error={error('type')} disabled={busy} />
    <Textarea rows={6} label={t('referral.examResult')} {...form.getInputProps('result_full_text')} error={error('result_full_text')} disabled={busy} />
    {save.isError && <QueryError error={save.error} />}
    <Group><Button type="submit" disabled={busy} loading={save.isPending}>{t('handoverEdit.save')}</Button><Button variant="default" disabled={busy} onClick={close}>{t('cancel')}</Button></Group>
  </Stack></form>
}
