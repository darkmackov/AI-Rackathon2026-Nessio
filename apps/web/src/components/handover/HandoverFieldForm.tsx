import { Button, Checkbox, Group, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { getHandoverQueryKey, updateHandoverFieldMutation } from '../../client/@tanstack/react-query.gen'
import type { HandoverFieldUpdate } from '../../client/types.gen'
import { QueryError } from '../DataState'
import FormErrorSummary from '../FormErrorSummary'
import { validDocumentDate } from '../documents/document-utils'
import { refreshCaseResults } from '../documents/use-document-ingest'
import { displayValue, type SourcedValue } from './clinical'

/** Manual entry of one Sourced handover field, shared by the referring doctor and the coordinator. */
export default function HandoverFieldForm({ caseId, actorId, path, value, unavailable = false, help, close, saved }: {
  caseId: string; actorId: string; path: string; value?: SourcedValue; unavailable?: boolean; help?: string; close: () => void; saved: () => void;
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  const list = path === 'comorbidities' || path === 'medications'
  const number = path === 'patient.age' || path === 'weight_kg' || path === 'height_cm'
  const date = path === 'patient.birth_date'
  const form = useForm({ initialValues: { value: displayValue(value?.value), notAvailable: unavailable, note: value?.note ?? '' }, validateInputOnBlur: true,
    validate: { value: (input, values) => {
      if (values.notAvailable) return null
      if (!input.trim()) return 'handoverEdit.required'
      if (date && !validDocumentDate(input)) return 'handoverEdit.invalidDate'
      if (number && (!Number.isFinite(Number(input.replace(',', '.'))) || (path === 'patient.age' && !Number.isInteger(Number(input.replace(',', '.')))))) return 'handoverEdit.invalidNumber'
      return null
    } } })
  const save = useMutation({ ...updateHandoverFieldMutation(), onSuccess: async (handover) => {
    client.setQueryData(getHandoverQueryKey({ path: { case_id: caseId }, headers: actorHeaders(actorId) }), handover)
    await refreshCaseResults(client, caseId)
    saved()
  } })
  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }
    setSubmitted(true)
    form.onSubmit((values) => {
      const body: HandoverFieldUpdate = { path, not_available: values.notAvailable, note: values.note.trim() || null,
        value: values.notAvailable ? null : list ? values.value.split('\n').map((item) => item.trim()).filter(Boolean) : number ? Number(values.value.replace(',', '.')) : values.value }
      save.mutate({ path: { case_id: caseId }, headers: actorHeaders(actorId), body })
    })(event)
  }}><Stack>
    {help && <Text size="sm" c="dimmed">{help}</Text>}
    {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={Object.values(form.errors).map((error) => t(String(error)))} />}
    <Checkbox label={t('handoverEdit.notAvailable')} {...form.getInputProps('notAvailable', { type: 'checkbox' })} disabled={busy} />
    {form.values.notAvailable ? <Text size="sm">{t('handoverEdit.unavailableHelp')}</Text> : date || number
      ? <TextInput type={date ? 'date' : 'text'} inputMode={number ? 'decimal' : undefined} label={t('handoverEdit.value')} {...form.getInputProps('value')} error={form.errors.value ? t(String(form.errors.value)) : undefined} disabled={busy} />
      : <Textarea label={t('handoverEdit.value')} description={list ? t('handoverEdit.listHelp') : undefined} rows={4} {...form.getInputProps('value')} error={form.errors.value ? t(String(form.errors.value)) : undefined} disabled={busy} />}
    <Textarea label={t('handoverEdit.note')} rows={2} {...form.getInputProps('note')} disabled={busy} />
    {save.isError && <QueryError error={save.error} />}
    <Group><Button type="submit" loading={save.isPending} disabled={busy}>{t('handoverEdit.save')}</Button><Button variant="default" onClick={close} disabled={busy}>{t('cancel')}</Button></Group>
  </Stack></form>
}
