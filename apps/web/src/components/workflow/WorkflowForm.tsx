import { Alert, Button, Checkbox, Group, MultiSelect, NativeSelect, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api'
import { validLocalDateTime } from '../../time'
import FormErrorSummary from '../FormErrorSummary'
import { QueryError } from '../DataState'

export type WorkflowField = {
  name: string; label: string; type?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'number' | 'select' | 'multi' | 'check'
  required?: boolean; requiredUnless?: string; requiredWhen?: { name: string; value: string }; choices?: { value: string; label: string }[]; help?: string
}
export type WorkflowValues = Record<string, string>
export function WorkflowError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  if (error instanceof ApiError && error.detail && typeof error.detail === 'object' && 'detail' in error.detail) {
    const messages: Record<string, string> = { 'task set already started for this case': 'duplicateSet', 'transition is not allowed': 'invalidTransition', 'dependency cycle': 'cycle', 'duplicate dependency key': 'duplicateKey', 'dependency not found in this case or task set': 'missingDependency', 'result document must belong to this case': 'wrongDocument', 'case is not editable before MDT': 'locked', 'the feedback has already been sent': 'alreadySent', 'the MDT conclusion is not confirmed': 'notConfirmed' }
    const key = typeof error.detail.detail === 'string' ? messages[error.detail.detail] : undefined
    if (key) return <Alert color="red" role="alert">{t(`workflow.${key}`)}</Alert>
  }
  return <QueryError error={error} />
}

/** Only form drafts live here; server models remain in Query. */
export default function WorkflowForm({ fields, initial, submit, onSaved, submitLabel, submitDisabled = false, help, children }: {
  fields: WorkflowField[]; initial: WorkflowValues; submit: (values: WorkflowValues) => Promise<unknown>; onSaved: () => void;
  submitLabel?: string; submitDisabled?: boolean; help?: string; children?: ReactNode;
}) {
  const { t } = useTranslation()
  const busy = useIsMutating() > 0
  const [error, setError] = useState<unknown>(null)
  const [submitted, setSubmitted] = useState(false)
  const form = useForm({ initialValues: initial, validateInputOnBlur: true, validate: (values) => {
    const errors: Record<string, string> = {}
    for (const field of fields) {
      const value = values[field.name] ?? ''
      const required = (field.required || field.requiredWhen && values[field.requiredWhen.name] === field.requiredWhen.value) && (!field.requiredUnless || values[field.requiredUnless] !== 'yes')
      if (required && !value.trim()) errors[field.name] = t('workflow.required')
      else if (value && field.type === 'datetime-local' && !validLocalDateTime(value)) errors[field.name] = t('invalidDateTime')
      else if (value && field.type === 'number' && !Number.isFinite(Number(value))) errors[field.name] = t('workflow.invalid')
    }
    return errors
  } })
  return <form noValidate onSubmit={form.onSubmit(async (values) => {
    if (submitDisabled || busy) return
    setSubmitted(true); setError(null)
    try { await submit(values); onSaved() } catch (error) { setError(error) }
  }, () => setSubmitted(true))}>
    <Stack gap="sm">
      {help && <Text size="sm" c="dimmed">{help}</Text>}
      {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[...new Set(Object.values(form.errors).filter((value): value is string => typeof value === 'string'))]} />}
      {fields.map((field) => {
        const props = { label: field.label, description: field.help, disabled: busy, required: !!((field.required || field.requiredWhen && form.values[field.requiredWhen.name] === field.requiredWhen.value) && (!field.requiredUnless || form.values[field.requiredUnless] !== 'yes')) }
        if (field.type === 'check') return <Checkbox key={field.name} {...props} checked={form.values[field.name] === 'yes'} onChange={(event) => form.setFieldValue(field.name, event.currentTarget.checked ? 'yes' : '')} />
        if (field.type === 'multi') return <MultiSelect key={field.name} {...props} data={field.choices ?? []} value={(form.values[field.name] ?? '').split('\n').filter(Boolean)} onChange={(value) => form.setFieldValue(field.name, value.join('\n'))} error={form.errors[field.name]} searchable />
        if (field.type === 'select') return <NativeSelect key={field.name} {...props} data={[...(!field.required ? [{ value: '', label: t('unavailable') }] : [{ value: '', label: '—' }]), ...field.choices ?? []]} {...form.getInputProps(field.name)} />
        if (field.type === 'textarea') return <Textarea key={field.name} {...props} autosize minRows={3} {...form.getInputProps(field.name)} />
        return <TextInput key={field.name} {...props} type={field.type ?? 'text'} step={field.type === 'number' ? 'any' : undefined} {...form.getInputProps(field.name)} />
      })}
      {children}
      {error != null && <WorkflowError error={error} />}
      <Group justify="flex-end"><Button type="submit" loading={busy} disabled={submitDisabled}>{submitLabel ?? t('workflow.save')}</Button></Group>
    </Stack>
  </form>
}
