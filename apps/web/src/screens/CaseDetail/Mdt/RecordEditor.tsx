import DateInput from '../../../components/DateInput'
import Button from '../../../components/ActionButton'
import ActionIcon from '../../../components/ActionIconButton'
import { pendingControlProps } from '../../../components/pending-control'
import { Group, Paper, Stack, Textarea, TextInput, Title } from '@mantine/core'
import { useForm, type FormErrors } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { updateMdtRecordMutation } from '../../../client/@tanstack/react-query.gen'
import type { MdtRecord, MdtRecordUpdate, MdtResultRow } from '../../../client/types.gen'
import { QueryError } from '../../../components/DataState'
import FormErrorSummary from '../../../components/FormErrorSummary'
import { validDocumentDate } from '../../../components/documents/document-utils'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import { lines } from '../../../components/workflow/use-workflow'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../../notifications/form-validation'
import MembersInput from './MembersInput'

export default function RecordEditor({ record, actorId, rows, close, saved }: { record: MdtRecord; actorId: string; rows?: MdtResultRow[]; close: () => void; saved: () => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  // Rows from an `mdt_results` draft replace the results; nothing is saved until the coordinator saves.
  const form = useForm({
    initialValues: { members: structuredClone(record.members), results: structuredClone(rows ?? record.results ?? []), question: record.mdt_question ?? '', diagnosis: record.diagnosis_name ?? '', code: record.diagnosis_code ?? '', comorbidities: (record.comorbidities ?? []).join('\n') },
    validateInputOnBlur: true, validateInputOnChange: false,
    validate: (value) => {
      const errors: FormErrors = {}
      value.members.forEach((member, index) => {
        if (!member.name.trim()) errors[`members.${index}.name`] = t('mdt.required')
        if (!member.specialty.trim()) errors[`members.${index}.specialty`] = t('mdt.required')
      })
      value.results.forEach((row, index) => {
        if (!validDocumentDate(row.date)) errors[`results.${index}.date`] = t('mdt.invalidDate')
        if (!row.examination.trim()) errors[`results.${index}.examination`] = t('mdt.required')
        if (!row.result.trim()) errors[`results.${index}.result`] = t('mdt.required')
      })
      return errors
    }
  })
  const labels: Record<string, string> = { question: t('mdt.question'), diagnosis: t('mdt.diagnosis'), code: t('mdt.code'), comorbidities: t('mdt.comorbidities') }
  form.values.members.forEach((_, index) => {
    labels[`members.${index}.name`] = `${t('mdt.name')} (${index + 1})`
    labels[`members.${index}.specialty`] = `${t('mdt.specialty')} (${index + 1})`
  })
  form.values.results.forEach((_, index) => {
    labels[`results.${index}.date`] = `${t('mdt.resultDate')} (${index + 1})`
    labels[`results.${index}.examination`] = `${t('mdt.examination')} (${index + 1})`
    labels[`results.${index}.result`] = `${t('mdt.result')} (${index + 1})`
  })
  const mutation = useMutation({ ...updateMdtRecordMutation(), onError: (error) => form.setErrors(apiFieldErrors(error, labels, t, { mdt_question: 'question', diagnosis_name: 'diagnosis', diagnosis_code: 'code' })), onSuccess: async () => { await refreshCaseResults(client, record.case_id); saved() } })
  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }; setSubmitted(true)
    form.onSubmit((value) => {
      const body: MdtRecordUpdate = { members: value.members, results: value.results, mdt_question: value.question || null, diagnosis_name: value.diagnosis || null, diagnosis_code: value.code || null, comorbidities: lines(value.comorbidities) }
      mutation.mutate({ body, path: { case_id: record.case_id }, headers: actorHeaders(actorId) })
    }, (errors) => notifyFormErrors(errors, labels, t, `mdt-record:${record.case_id}`))(event)
  }}><Stack gap="sm">
      {submitted && <FormErrorSummary errors={formProblems(form.errors, labels)} />}
      <Title order={4} size="h6">{t('mdt.members')}</Title><MembersInput value={form.values.members} onChange={(value) => form.setFieldValue('members', value)} errors={form.errors} onBlur={(path) => form.validateField(path)} />
      <Group gap="xs" align="flex-start" grow><TextInput label={t('mdt.diagnosis')} {...form.getInputProps('diagnosis')} {...pendingControlProps(busy)} /><TextInput label={t('mdt.code')} {...form.getInputProps('code')} {...pendingControlProps(busy)} /></Group>
      <Textarea label={t('mdt.comorbidities')} description={t('mdt.lines')} autosize minRows={2} {...form.getInputProps('comorbidities')} {...pendingControlProps(busy)} />
      <Textarea label={t('mdt.question')} autosize minRows={2} {...form.getInputProps('question')} {...pendingControlProps(busy)} />
      <Title order={4} size="h6">{t('mdt.results')}</Title>
      {form.values.results.map((_, index) => <Paper withBorder p="sm" key={index}><Stack gap="xs">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <DateInput w={170} label={`${t('mdt.resultDate')} (${index + 1})`} {...form.getInputProps(`results.${index}.date`)} {...pendingControlProps(busy)} />
          <TextInput flex={1} label={`${t('mdt.examination')} (${index + 1})`} {...form.getInputProps(`results.${index}.examination`)} {...pendingControlProps(busy)} />
          <ActionIcon variant="subtle" color="gray" size={36} pending={busy} aria-label={t('mdt.removeResult', { number: index + 1 })} onClick={() => form.removeListItem('results', index)}><IconTrash size={18} aria-hidden /></ActionIcon>
        </Group>
        <Textarea label={`${t('mdt.result')} (${index + 1})`} autosize minRows={2} {...form.getInputProps(`results.${index}.result`)} {...pendingControlProps(busy)} />
      </Stack></Paper>)}
      <Group><Button variant="outline" size="compact-sm" pending={busy} onClick={() => form.insertListItem('results', { date: '', examination: '', result: '' })}>{t('mdt.addResult')}</Button></Group>
      {mutation.isError && <QueryError error={mutation.error} />}
      <Group><Button type="submit" pending={busy || mutation.isPending} >{t('mdt.save')}</Button><Button variant="default" pending={busy} onClick={close}>{t('cancel')}</Button></Group>
    </Stack></form>
}
