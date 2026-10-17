import { Badge, Button, Group, List, Modal, MultiSelect, NativeSelect, NumberInput, Paper, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconArrowLeft, IconListCheck, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { createTaskSetMutation, listTaskSetsOptions, startTaskSetMutation, updateTaskSetMutation } from '../../client/@tanstack/react-query.gen'
import type { TaskSet, TaskSetUpsert } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'
import WorkflowForm, { WorkflowError } from '../../components/workflow/WorkflowForm'
import { useOwnerChoices, useWorkflowRefresh } from '../../components/workflow/use-workflow'
import { useDemoClock } from '../../demo-clock'
import { useSession } from '../../session'

function SetEditor({ existing, onSaved, onCancel }: { existing?: TaskSet; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation(), { actorId } = useSession()
  const create = useMutation(createTaskSetMutation()), update = useMutation(updateTaskSetMutation()), busy = useIsMutating() > 0
  const [error, setError] = useState<unknown>(null), [submitted, setSubmitted] = useState(false)
  const form = useForm<TaskSetUpsert>({ initialValues: { name: existing?.name ?? '', diagnosis_codes: existing?.diagnosis_codes ?? [], steps: existing?.steps ?? [{ key: 'step1', title: '', kind: 'other', owner_role: 'coordinator', depends_on: [] }] }, validateInputOnBlur: true,
    validate: (value) => {
      const errors: Record<string, string> = {}
      if (!value.name.trim()) errors.name = t('workflow.required')
      if (!value.steps.length) errors.steps = t('workflow.required')
      for (const [index, step] of value.steps.entries()) if (value.steps.some((entry, other) => index !== other && entry.key === step.key)) errors[`steps.${index}.key`] = t('workflow.duplicateKey')
      for (const [index, step] of value.steps.entries()) for (const key of ['key', 'title', 'kind', 'owner_role'] as const) if (!step[key].trim()) errors[`steps.${index}.${key}`] = t('workflow.required')
      return errors
    } })
  return <form noValidate onSubmit={form.onSubmit(async (body) => {
    setSubmitted(true); setError(null)
    try {
      if (existing) await update.mutateAsync({ path: { task_set_id: existing.id }, headers: actorHeaders(actorId ?? ''), body })
      else await create.mutateAsync({ headers: actorHeaders(actorId ?? ''), body })
      await onSaved()
    } catch (error) { setError(error) }
  }, () => setSubmitted(true))}><Stack gap="sm">
    {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[...new Set(Object.values(form.errors).filter((value): value is string => typeof value === 'string'))]} />}
    <TextInput label={t('workflow.setName')} required disabled={busy} {...form.getInputProps('name')} />
    <TextInput label={t('workflow.codes')} description={t('workflow.codesHelp')} disabled={busy} value={form.values.diagnosis_codes?.join(', ') ?? ''} onChange={(event) => form.setFieldValue('diagnosis_codes', event.currentTarget.value.split(',').map((entry) => entry.trim()))} />
    <Title order={3} size="h5">{t('workflow.steps')}</Title>
    {form.values.steps.map((step, index) => <Paper key={index} withBorder p="sm"><Stack gap="xs">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{index + 1}. {step.title}</Text>
        <Button variant="subtle" color="red" size="compact-sm" leftSection={<IconTrash size={14} aria-hidden />} disabled={busy} onClick={() => form.removeListItem('steps', index)}>{t('workflow.removeStep')}</Button>
      </Group>
      <Group grow><TextInput label={t('workflow.stepKey')} required disabled={busy} {...form.getInputProps(`steps.${index}.key`)} /><TextInput label={t('workflow.title')} required disabled={busy} {...form.getInputProps(`steps.${index}.title`)} /></Group>
      <Group grow><NativeSelect label={t('workflow.kind')} required disabled={busy} data={['imaging', 'biopsy', 'histology', 'lab', 'consult', 'request_documents', 'mdt', 'other'].map((value) => ({ value, label: t(`caseDetail.taskKinds.${value}`, { defaultValue: value }) }))} {...form.getInputProps(`steps.${index}.kind`)} /><TextInput label={t('workflow.ownerRole')} required disabled={busy} {...form.getInputProps(`steps.${index}.owner_role`)} /></Group>
      <NumberInput label={t('workflow.offset')} allowDecimal={false} disabled={busy} value={step.due_offset_days ?? ''} onChange={(value) => form.setFieldValue(`steps.${index}.due_offset_days`, typeof value === 'number' ? value : null)} />
      <MultiSelect label={t('workflow.dependencies')} disabled={busy} data={[...new Map(form.values.steps.filter((entry, i) => i !== index && !!entry.key).map((entry) => [entry.key, { value: entry.key, label: entry.title || entry.key }])).values()]} {...form.getInputProps(`steps.${index}.depends_on`)} />
    </Stack></Paper>)}
    <Group><Button size="xs" variant="outline" leftSection={<IconPlus size={16} aria-hidden />} disabled={busy} onClick={() => { let index = form.values.steps.length + 1; while (form.values.steps.some((step) => step.key === `step${index}`)) index++; form.insertListItem('steps', { key: `step${index}`, title: '', kind: 'other', owner_role: 'coordinator', depends_on: [] }) }}>{t('workflow.addStep')}</Button></Group>
    {error != null && <WorkflowError error={error} />}
    <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={onCancel}>{t('cancel')}</Button><Button type="submit" loading={busy}>{t('workflow.save')}</Button></Group>
  </Stack></form>
}

function StartSet({ set, caseId, onSaved, onCancel }: { set: TaskSet; caseId: string; onSaved: () => void; onCancel: () => void }) {
  const { t } = useTranslation(), { actorId } = useSession()
  const owners = useOwnerChoices(true), clock = useDemoClock(), mutation = useMutation(startTaskSetMutation()), refresh = useWorkflowRefresh(caseId)
  if (owners.state) return owners.state
  if (clock.isPending) return <LoadingState />
  if (clock.isError) return <QueryError error={clock.error} retry={() => { void clock.refetch() }} />
  const roles = [...new Set(set.steps.map((step) => step.owner_role))]
  return <WorkflowForm help={t('workflow.setHelp')} fields={[
    { name: 'start', label: t('workflow.start'), type: 'datetime-local', required: true },
    ...roles.map((role, index) => ({ name: `role${index}`, label: t('workflow.assignment', { role }), type: 'select' as const, required: true, choices: owners.choices })),
  ]} initial={{ start: clock.data.now.slice(0, 19), ...Object.fromEntries(roles.map((_, index) => [`role${index}`, ''])) }} onSaved={onSaved} onCancel={onCancel} submitLabel={t('caseDetail.startSet')} submit={async (values) => {
    await mutation.mutateAsync({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? ''), body: { task_set_id: set.id, start: values.start, owners: Object.fromEntries(roles.map((role, index) => [role, values[`role${index}`]])) } })
    await refresh()
  }} />
}

export default function TaskSetsDialog({ caseId, opened, onClose, onSaved }: { caseId: string; opened: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [view, setView] = useState<'list' | 'new' | 'edit' | 'start'>('list'), [selectedId, setSelectedId] = useState<string | null>(null)
  const sets = useQuery({ ...listTaskSetsOptions(), enabled: opened }), busy = useIsMutating() > 0, refresh = useWorkflowRefresh(caseId)
  const selected = sets.data?.find((set) => set.id === selectedId)
  const back = () => setView('list')
  const title = { list: t('workflow.sets'), new: t('workflow.newSet'), edit: t('workflow.editSet'), start: t('caseDetail.startSet') }[view]
  return <Modal opened={opened} onClose={() => { if (!busy) onClose() }} title={title} size="lg" closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
    <Stack>
      {view !== 'list' && <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={16} aria-hidden />} style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={back}>{t('workflow.sets')}</Button>}
      {view === 'list' && <>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text size="sm" c="dimmed">{t('workflow.setHelp')}</Text>
          <Button size="xs" variant="outline" leftSection={<IconPlus size={16} aria-hidden />} style={{ flexShrink: 0 }} disabled={busy} onClick={() => { setSelectedId(null); setView('new') }}>{t('workflow.newSet')}</Button>
        </Group>
        {sets.isPending && <LoadingState />}
        {sets.isError && <QueryError error={sets.error} retry={() => { void sets.refetch() }} />}
        {sets.isSuccess && !sets.data.length && <EmptyState title={t('workflow.noSets')} />}
        {sets.data?.map((set) => <Paper key={set.id} component="article" aria-label={set.name} withBorder p="md"><Stack gap="sm">
          <Group justify="space-between" align="flex-start" gap="xs">
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{set.name}</Text>
            <Group gap={4}>{set.diagnosis_codes?.filter(Boolean).map((code) => <Badge key={code} size="sm" variant="light" color="gray" c="dark.9">{code}</Badge>)}</Group>
          </Group>
          <List type="ordered" size="sm" spacing={2}>{set.steps.map((step) => <List.Item key={step.key}>{step.title}</List.Item>)}</List>
          <Group gap="xs">
            <Button size="xs" leftSection={<IconListCheck size={16} aria-hidden />} disabled={busy} onClick={() => { setSelectedId(set.id); setView('start') }}>{t('caseDetail.startSet')}</Button>
            <Button size="xs" variant="outline" leftSection={<IconPencil size={16} aria-hidden />} disabled={busy} onClick={() => { setSelectedId(set.id); setView('edit') }}>{t('workflow.editSet')}</Button>
          </Group>
        </Stack></Paper>)}
      </>}
      {view === 'new' && <SetEditor key="new" onCancel={back} onSaved={async () => { await refresh(); back() }} />}
      {view === 'edit' && selected && <SetEditor key={selected.id} existing={selected} onCancel={back} onSaved={async () => { await refresh(); back() }} />}
      {view === 'start' && selected && <><Text fw={600}>{selected.name}</Text><StartSet set={selected} caseId={caseId} onSaved={onSaved} onCancel={back} /></>}
    </Stack>
  </Modal>
}
