import Button from '../ActionButton'
import { pendingControlProps } from '../pending-control'
import { Checkbox, Group, MultiSelect, NativeSelect, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../notifications/form-validation'
import { validLocalDateTime } from '../../time'
import FormErrorSummary from '../FormErrorSummary'
import { QueryError } from '../DataState'
import { validDocumentDate } from '../documents/document-utils'

export type WorkflowField = {
  name: string; label: string; type?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'number' | 'select' | 'multi' | 'check'
  required?: boolean; requiredUnless?: string; requiredWhen?: { name: string; value: string }; choices?: { value: string; label: string }[]; help?: string
}
export type WorkflowValues = Record<string, string>
export function WorkflowError({ error }: { error: unknown }) {
  return <QueryError error={error} />
}

/** Only form drafts live here; server models remain in Query. */
export default function WorkflowForm({ fields, initial, submit, onSaved, onCancel, submitLabel, submitDisabled = false, help, children, errorAliases = {} }: {
  fields: WorkflowField[]; initial: WorkflowValues; submit: (values: WorkflowValues) => Promise<unknown>; onSaved: () => void; onCancel?: () => void;
  submitLabel?: string; submitDisabled?: boolean; help?: string; children?: ReactNode; errorAliases?: Record<string, string>;
}) {
  const { t } = useTranslation()
  const id = useId()
  const busy = useIsMutating() > 0
  const [error, setError] = useState<unknown>(null)
  const [failedSubmits, setFailedSubmits] = useState(0)
  const labels = Object.fromEntries(fields.map((field) => [field.name, field.label]))
  const aliases = Object.fromEntries(Object.entries({ owner_id: 'owner', coordinator_id: 'coordinator', mdt_board_id: 'board', mdt_date: 'date', result_document_id: 'document', depends_on: 'dependencies' }).filter(([source, target]) => !labels[source] && labels[target]))
  const form = useForm({
    initialValues: initial, validateInputOnBlur: true, validate: (values) => {
      const errors: Record<string, string> = {}
      for (const field of fields) {
        const value = values[field.name] ?? ''
        const required = (field.required || field.requiredWhen && values[field.requiredWhen.name] === field.requiredWhen.value) && (!field.requiredUnless || values[field.requiredUnless] !== 'yes')
        if (required && !value.trim()) errors[field.name] = t('workflow.required')
        else if (value && field.type === 'date' && !validDocumentDate(value)) errors[field.name] = t('documents.invalidDate')
        else if (value && field.type === 'datetime-local' && !validLocalDateTime(value)) errors[field.name] = t('invalidDateTime')
        else if (value && field.type === 'number' && !Number.isFinite(Number(value))) errors[field.name] = t('workflow.invalid')
      }
      return errors
    }
  })
  return <form noValidate onSubmit={form.onSubmit(async (values) => {
    if (submitDisabled || busy) return
    setError(null)
    try { await submit(values); onSaved() } catch (error) {
      const errors = apiFieldErrors(error, labels, t, { ...aliases, ...errorAliases })
      if (Object.keys(errors).length) {
        form.setErrors({ ...form.errors, ...errors })
        setFailedSubmits((count) => count + 1)
      }
      setError(error)
    }
  }, (errors) => {
    setFailedSubmits((count) => count + 1)
    notifyFormErrors(errors, labels, t, id)
  })}>
    <Stack gap="sm">
      {help && <Text size="sm" c="dimmed">{help}</Text>}
      {failedSubmits > 0 && <FormErrorSummary errors={formProblems(form.errors, labels)} focusKey={failedSubmits} />}
      {fields.map((field) => {
        const props = { label: field.label, description: field.help, ...pendingControlProps(busy), required: !!((field.required || field.requiredWhen && form.values[field.requiredWhen.name] === field.requiredWhen.value) && (!field.requiredUnless || form.values[field.requiredUnless] !== 'yes')) }
        if (field.type === 'check') return <Checkbox key={field.name} {...props} checked={form.values[field.name] === 'yes'} onChange={(event) => form.setFieldValue(field.name, event.currentTarget.checked ? 'yes' : '')} onBlur={() => form.validateField(field.name)} error={form.errors[field.name]} />
        if (field.type === 'multi') return <MultiSelect key={field.name} {...props} data={field.choices ?? []} value={(form.values[field.name] ?? '').split('\n').filter(Boolean)} onChange={(value) => form.setFieldValue(field.name, value.join('\n'))} onBlur={() => form.validateField(field.name)} error={form.errors[field.name]} searchable />
        if (field.type === 'select') return <NativeSelect key={field.name} {...props} data={[...(!field.required ? [{ value: '', label: t('unavailable') }] : [{ value: '', label: '—' }]), ...field.choices ?? []]} {...form.getInputProps(field.name)} />
        if (field.type === 'textarea') return <Textarea key={field.name} {...props} autosize minRows={3} {...form.getInputProps(field.name)} />
        return <TextInput key={field.name} {...props} type={field.type ?? 'text'} step={field.type === 'number' ? 'any' : undefined} {...form.getInputProps(field.name)} />
      })}
      {children}
      {error != null && <WorkflowError error={error} />}
      <Group justify="flex-end">{onCancel && <Button variant="default" pending={busy} onClick={onCancel}>{t('cancel')}</Button>}<Button type="submit" pending={busy} disabled={submitDisabled}>{submitLabel ?? t('workflow.save')}</Button></Group>
    </Stack>
  </form>
}
