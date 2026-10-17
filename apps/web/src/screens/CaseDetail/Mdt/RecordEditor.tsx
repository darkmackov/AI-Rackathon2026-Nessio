import { Button, Paper, Stack, Textarea, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
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
import MembersInput from './MembersInput'

export default function RecordEditor({ record, actorId, rows, saved }: { record: MdtRecord; actorId: string; rows?: MdtResultRow[]; saved: () => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  // Rows from an `mdt_results` draft replace the results; nothing is saved until the coordinator saves.
  const form = useForm({ initialValues: { members: structuredClone(record.members), results: structuredClone(rows ?? record.results ?? []), question: record.mdt_question ?? '', diagnosis: record.diagnosis_name ?? '', code: record.diagnosis_code ?? '', comorbidities: (record.comorbidities ?? []).join('\n') },
    validate: { members: (value) => value.some((member) => !member.name.trim() || !member.specialty.trim()) ? 'mdt.required' : null,
      results: (value) => value.some((row) => !validDocumentDate(row.date) || !row.examination.trim() || !row.result.trim()) ? 'mdt.required' : null } })
  const mutation = useMutation({ ...updateMdtRecordMutation(), onSuccess: async () => { await refreshCaseResults(client, record.case_id); saved() } })
  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }; setSubmitted(true)
    form.onSubmit((value) => {
      const body: MdtRecordUpdate = { members: value.members, results: value.results, mdt_question: value.question || null, diagnosis_name: value.diagnosis || null, diagnosis_code: value.code || null, comorbidities: lines(value.comorbidities) }
      mutation.mutate({ body, path: { case_id: record.case_id }, headers: actorHeaders(actorId) })
    })(event)
  }}><Stack gap="sm">
    {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[t('mdt.required')]} />}
    <Title order={3} size="h5">{t('mdt.members')}</Title><MembersInput value={form.values.members} onChange={(value) => form.setFieldValue('members', value)} />
    <TextInput label={t('mdt.diagnosis')} {...form.getInputProps('diagnosis')} disabled={busy} /><TextInput label={t('mdt.code')} {...form.getInputProps('code')} disabled={busy} />
    <Textarea label={t('mdt.comorbidities')} description={t('mdt.lines')} rows={3} {...form.getInputProps('comorbidities')} disabled={busy} />
    <Textarea label={t('mdt.question')} rows={3} {...form.getInputProps('question')} disabled={busy} />
    <Title order={3} size="h5">{t('mdt.results')}</Title>
    {form.values.results.map((_, index) => <Paper withBorder p="sm" key={index}><Stack gap="xs">
      <TextInput type="date" label={`${t('mdt.resultDate')} (${index + 1})`} {...form.getInputProps(`results.${index}.date`)} disabled={busy} />
      <TextInput label={`${t('mdt.examination')} (${index + 1})`} {...form.getInputProps(`results.${index}.examination`)} disabled={busy} />
      <Textarea label={`${t('mdt.result')} (${index + 1})`} rows={3} {...form.getInputProps(`results.${index}.result`)} disabled={busy} />
      <Button variant="subtle" color="gray" size="compact-sm" disabled={busy} onClick={() => form.removeListItem('results', index)}>{t('mdt.removeResult', { number: index + 1 })}</Button>
    </Stack></Paper>)}
    <Button variant="outline" size="compact-sm" disabled={busy} onClick={() => form.insertListItem('results', { date: '', examination: '', result: '' })}>{t('mdt.addResult')}</Button>
    {mutation.isError && <QueryError error={mutation.error} />}
    <Button type="submit" disabled={busy} loading={mutation.isPending}>{t('mdt.save')}</Button>
  </Stack></form>
}
