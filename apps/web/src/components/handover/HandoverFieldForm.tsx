import Button from '../ActionButton'
import { pendingControlProps } from '../pending-control'
import { Checkbox, Group, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { getHandoverQueryKey, updateHandoverFieldMutation } from '../../client/@tanstack/react-query.gen'
import type { HandoverFieldUpdate } from '../../client/types.gen'
import { QueryError } from '../DataState'
import FormErrorSummary from '../FormErrorSummary'
import { validDocumentDate } from '../documents/document-utils'
import { refreshCaseResults } from '../documents/use-document-ingest'
import { displayValue, sectionOf, type SourcedValue } from './clinical'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../notifications/form-validation'
import { fieldLabel } from '../../notifications/field-label'

/** Manual entry of one Sourced handover field, shared by the referring doctor and the coordinator. */
export default function HandoverFieldForm({ caseId, actorId, path, value, unavailable = false, help, initialText, close, saved }: {
  caseId: string; actorId: string; path: string; value?: SourcedValue; unavailable?: boolean; help?: string; initialText?: string; close: () => void; saved: () => void;
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const busy = useIsMutating() > 0
  const id = useId()
  const [failedSubmits, setFailedSubmits] = useState(0)
  const clinicalLabel = sectionOf(path)?.fields.find(([field]) => field === path)?.[1]
  const labels = { value: clinicalLabel ? t(`caseDetail.${clinicalLabel}`) : fieldLabel(path, t), note: t('handoverEdit.note'), notAvailable: t('handoverEdit.notAvailable') }
  const list = path === 'comorbidities' || path === 'medications'
  const number = path === 'patient.age' || path === 'weight_kg' || path === 'height_cm'
  const date = path === 'patient.birth_date'
  const form = useForm({
    initialValues: { value: initialText ?? displayValue(value?.value), notAvailable: unavailable, note: value?.note ?? '' }, validateInputOnBlur: true,
    validate: {
      value: (input, values) => {
        if (values.notAvailable) return null
        if (!input.trim()) return t('handoverEdit.required')
        if (date && !validDocumentDate(input)) return t('handoverEdit.invalidDate')
        if (number && (!Number.isFinite(Number(input.replace(',', '.'))) || (path === 'patient.age' && !Number.isInteger(Number(input.replace(',', '.')))))) return t('handoverEdit.invalidNumber')
        return null
      }
    }
  })
  const save = useMutation({
    ...updateHandoverFieldMutation(), onError: (error) => {
      const errors = apiFieldErrors(error, labels, t, { not_available: 'notAvailable', [path]: 'value' })
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
    form.onSubmit((values) => {
      const body: HandoverFieldUpdate = {
        path, not_available: values.notAvailable, note: values.note.trim() || null,
        value: values.notAvailable ? null : list ? values.value.split('\n').map((item) => item.trim()).filter(Boolean) : number ? Number(values.value.replace(',', '.')) : values.value
      }
      save.mutate({ path: { case_id: caseId }, headers: actorHeaders(actorId), body })
    }, (errors) => {
      setFailedSubmits((count) => count + 1)
      notifyFormErrors(errors, labels, t, id)
    })(event)
  }}><Stack>
      {help && <Text size="sm" c="dimmed">{help}</Text>}
      {failedSubmits > 0 && <FormErrorSummary errors={formProblems(form.errors, labels)} focusKey={failedSubmits} />}
      <Checkbox label={t('handoverEdit.notAvailable')} {...form.getInputProps('notAvailable', { type: 'checkbox' })} {...pendingControlProps(busy)} />
      {form.values.notAvailable ? <Text size="sm">{t('handoverEdit.unavailableHelp')}</Text> : date || number
        ? <TextInput type={date ? 'date' : 'text'} inputMode={number ? 'decimal' : undefined} label={t('handoverEdit.value')} {...form.getInputProps('value')} {...pendingControlProps(busy)} />
        : <Textarea label={t('handoverEdit.value')} description={list ? t('handoverEdit.listHelp') : undefined} rows={4} {...form.getInputProps('value')} {...pendingControlProps(busy)} />}
      <Textarea label={t('handoverEdit.note')} rows={2} {...form.getInputProps('note')} {...pendingControlProps(busy)} />
      {save.isError && <QueryError error={save.error} />}
      <Group><Button type="submit" pending={busy || save.isPending}>{t('handoverEdit.save')}</Button><Button variant="default" onClick={close} pending={busy}>{t('cancel')}</Button></Group>
    </Stack></form>
}
