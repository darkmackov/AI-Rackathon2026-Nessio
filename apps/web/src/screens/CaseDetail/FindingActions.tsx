import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { requestFromFindingMutation, resolveFindingMutation } from '../../client/@tanstack/react-query.gen'
import type { Finding, Handover } from '../../client/types.gen'
import { handoverFields, sectionOf } from '../../components/handover/clinical'
import HandoverFieldForm from '../../components/handover/HandoverFieldForm'
import WorkflowForm, { type WorkflowField } from '../../components/workflow/WorkflowForm'
import { priorityValue, useOwnerChoices, usePriorityChoices, useWorkflowRefresh } from '../../components/workflow/use-workflow'
import { useSession } from '../../session'

export function FieldEditor({ caseId, handover, paths, onSaved, onClose }: { caseId: string; handover: Handover; paths: string[]; onSaved: () => void; onClose: () => void }) {
  const { t } = useTranslation(), { actorId } = useSession()
  const [path, setPath] = useState(paths[0] ?? '')
  const label = (value: string) => t(`caseDetail.${sectionOf(value)?.fields.find(([key]) => key === value)?.[1] ?? value}`)
  return <Stack>
    {paths.length > 1 && <Group>{paths.map((entry) => <Button key={entry} size="compact-sm" variant={entry === path ? 'filled' : 'light'} onClick={() => setPath(entry)}>{label(entry)}</Button>)}</Group>}
    <Text size="sm" fw={500}>{label(path)}</Text>
    <HandoverFieldForm key={path} caseId={caseId} actorId={actorId ?? ''} path={path} value={handoverFields(handover)[path]} help={t('workflow.manualHelp')} close={onClose} saved={onSaved} />
  </Stack>
}

export default function FindingActions({ caseId, finding, handover }: { caseId: string; finding: Finding; handover?: Handover }) {
  const { t } = useTranslation(), { actorId } = useSession()
  const [action, setAction] = useState<'request' | 'fill' | 'resolve' | null>(null), [saved, setSaved] = useState(false)
  const busy = useIsMutating() > 0, owners = useOwnerChoices(), priorities = usePriorityChoices(), refresh = useWorkflowRefresh(caseId)
  const request = useMutation(requestFromFindingMutation()), resolve = useMutation(resolveFindingMutation())
  const options = { path: { case_id: caseId, finding_id: finding.id }, headers: actorHeaders(actorId ?? '') }
  const fields: WorkflowField[] = action === 'request' ? [
    { name: 'owner', label: t('workflow.owner'), type: 'select', required: true, choices: owners.choices },
    { name: 'title', label: t('workflow.title'), required: true }, { name: 'due', label: t('workflow.due'), type: 'datetime-local' },
    { name: 'priority', label: t('priority'), type: 'select', required: true, choices: priorities }, { name: 'note', label: t('workflow.note'), type: 'textarea' },
  ] : [
    { name: 'kind', label: t('workflow.resolution'), type: 'select', required: true, choices: [
      { value: 'resolved', label: t('workflow.resolve') }, { value: 'dismissed', label: t('workflow.dismiss') },
      ...(finding.overridable !== false ? [{ value: 'overridden', label: t('workflow.override') }] : []),
    ] }, { name: 'note', label: t('workflow.note'), type: 'textarea', requiredWhen: { name: 'kind', value: 'overridden' }, help: t('workflow.override') },
  ]
  const success = () => { setAction(null); setSaved(true) }
  return <Stack gap={4}>
    <Group gap="xs">
      <Button size="compact-sm" variant={finding.suggested_action === 'request' ? 'filled' : 'light'} disabled={busy} onClick={() => { setSaved(false); setAction('request') }}>{t('caseDetail.request')}</Button>
      {!!finding.fields?.length && handover && <Button size="compact-sm" variant={finding.suggested_action === 'fill_in' ? 'filled' : 'light'} disabled={busy} onClick={() => { setSaved(false); setAction('fill') }}>{t('caseDetail.fill')}</Button>}
      <Button size="compact-sm" variant="subtle" disabled={busy} onClick={() => { setSaved(false); setAction('resolve') }}>{t('workflow.resolve')}</Button>
    </Group>
    {saved && <Text size="sm" role="status">{t('workflow.saved')}</Text>}
    <Modal opened={!!action} onClose={() => { if (!busy) setAction(null) }} title={t(action === 'request' ? 'caseDetail.request' : action === 'fill' ? 'caseDetail.fill' : 'workflow.resolve')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {action === 'fill' && handover && <FieldEditor caseId={caseId} handover={handover} paths={finding.fields ?? []} onSaved={success} onClose={() => setAction(null)} />}
      {action === 'request' && owners.state}
      {(action === 'request' && !owners.state || action === 'resolve') && <WorkflowForm key={action} fields={fields} initial={action === 'request' ? { owner: '', title: finding.message_cs, due: '', priority: 'normal', note: '' } : { kind: 'resolved', note: '' }} onSaved={success} help={action === 'request' ? t('workflow.requestHelp') : undefined} submit={async (values) => {
        if (action === 'request') await request.mutateAsync({ ...options, body: { owner_id: values.owner, title: values.title, due: values.due || null, priority: priorityValue(values.priority), note: values.note || null } })
        else await resolve.mutateAsync({ ...options, body: { kind: values.kind === 'overridden' ? 'overridden' : values.kind === 'dismissed' ? 'dismissed' : 'resolved', note: values.note || null } })
        await refresh()
      }} />}
    </Modal>
  </Stack>
}
