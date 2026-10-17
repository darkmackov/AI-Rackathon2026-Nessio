import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { IconArrowBackUp, IconPlayerPause, IconUserCheck } from '@tabler/icons-react'
import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { clearHoldMutation, listActorsOptions, listMdtBoardsOptions, returnCaseMutation, setHoldMutation, takeOverCaseMutation, transitionCaseMutation, updateCaseMutation, updateMilestonesMutation } from '../../client/@tanstack/react-query.gen'
import type { Case, Finding } from '../../client/types.gen'
import WorkflowForm, { WorkflowError, type WorkflowField } from '../../components/workflow/WorkflowForm'
import { priorityValue, usePriorityChoices, useWorkflowRefresh } from '../../components/workflow/use-workflow'
import LoadingState, { QueryError } from '../../components/DataState'
import { useSession } from '../../session'

type Action = 'return' | 'hold' | 'settings' | 'milestones' | 'transition'
/** `extra` adds controls (e.g. a download) to the end of the action row so they wrap with it. */
export default function CaseActions({ item, findings, settings = false, extra }: { item: Case; findings?: Finding[]; settings?: boolean; extra?: ReactNode }) {
  const { t } = useTranslation(), { actorId } = useSession()
  const [action, setAction] = useState<Action | null>(null), [saved, setSaved] = useState(false), [error, setError] = useState<unknown>(null)
  const busy = useIsMutating() > 0, refresh = useWorkflowRefresh(item.id)
  const take = useMutation(takeOverCaseMutation()), resume = useMutation(clearHoldMutation()), returning = useMutation(returnCaseMutation()), hold = useMutation(setHoldMutation())
  const update = useMutation(updateCaseMutation()), milestones = useMutation(updateMilestonesMutation()), transition = useMutation(transitionCaseMutation())
  const actors = useQuery({ ...listActorsOptions(), enabled: action === 'settings' })
  const boards = useQuery({ ...listMdtBoardsOptions(), enabled: action === 'settings' })
  const priorities = usePriorityChoices()
  const options = { path: { case_id: item.id }, headers: actorHeaders(actorId ?? '') }
  const open = (value: Action) => { setSaved(false); setError(null); setAction(value) }
  const success = () => { setAction(null); setSaved(true) }
  const direct = async (run: () => Promise<unknown>) => { setSaved(false); setError(null); try { await run(); await refresh(); success() } catch (error) { setError(error) } }
  const title = action === 'return' ? t('caseDetail.returnCase') : action === 'hold' ? t('caseDetail.hold') : action ? t(`workflow.${action === 'transition' ? 'changeState' : action}`) : ''
  let fields: WorkflowField[] = []
  let initial: Record<string, string> = {}
  if (action === 'return') {
    fields = [{ name: 'note', label: t('workflow.note'), type: 'textarea', required: true }, { name: 'finding', label: t('workflow.finding'), type: 'select', choices: (findings ?? []).filter((issue) => !issue.resolved).map((issue) => ({ value: issue.id, label: issue.message_cs })) }]
    initial = { note: '', finding: '' }
  } else if (action === 'hold') {
    fields = [{ name: 'reason', label: t('workflow.reason'), type: 'textarea', required: true }, { name: 'until', label: t('workflow.until'), type: 'date' }]
    initial = { reason: item.on_hold?.reason ?? '', until: item.on_hold?.until ?? '' }
  } else if (action === 'settings') {
    fields = [{ name: 'priority', label: t('priority'), type: 'select', required: true, choices: priorities },
      { name: 'coordinator', label: t('workflow.coordinator'), type: 'select', choices: (actors.data ?? []).filter((person) => person.role === 'coordinator' && person.organization_id === item.koc_id).map((person) => ({ value: person.id, label: person.name })) },
      { name: 'board', label: t('workflow.board'), type: 'select', choices: (boards.data ?? []).filter((board) => board.organization_id === item.koc_id).map((board) => ({ value: board.id, label: board.name })) },
      { name: 'date', label: t('workflow.mdtDate'), type: 'date' }]
    initial = { priority: item.priority ?? 'normal', coordinator: item.coordinator_id ?? '', board: item.mdt_board_id ?? '', date: item.mdt_date ?? '' }
  } else if (action === 'milestones') {
    fields = [{ name: 'onset', label: t('workflow.onset'), type: 'date' }, { name: 'start', label: t('workflow.treatment'), type: 'date' }]
    initial = { onset: item.milestones?.symptom_onset ?? '', start: item.milestones?.treatment_start ?? '' }
  } else if (action === 'transition') {
    fields = [{ name: 'to', label: t('workflow.targetState'), type: 'select', required: true, choices: ['ceka_na_podklady', 'kompletni'].map((value) => ({ value, label: t(`states.${value}`) })) }, { name: 'note', label: t('workflow.note'), type: 'textarea' }]
    initial = { to: '', note: '' }
  }
  const directoryReady = action !== 'settings' || actors.isSuccess && boards.isSuccess
  return <Stack gap={4} align={settings ? undefined : 'flex-end'}>
    <Group gap="xs" align="flex-start" justify={settings ? undefined : 'flex-end'}>
      {settings ? <>
        <Button size="compact-sm" variant="subtle" disabled={busy} onClick={() => open('settings')}>{t('workflow.settings')}</Button>
        <Button size="compact-sm" variant="subtle" disabled={busy} onClick={() => open('milestones')}>{t('workflow.milestones')}</Button>
        <Button size="compact-sm" variant="subtle" disabled={busy} onClick={() => open('transition')}>{t('workflow.changeState')}</Button>
      </> : <>
        <Button size="xs" leftSection={<IconUserCheck size={16} aria-hidden />} disabled={busy || item.state !== 'odeslano'} loading={take.isPending} onClick={() => { void direct(() => take.mutateAsync(options)) }}>{t('caseDetail.takeOver')}</Button>
        <Button size="xs" variant="outline" leftSection={<IconArrowBackUp size={16} aria-hidden />} disabled={busy} onClick={() => open('return')}>{t('caseDetail.returnCase')}</Button>
        <Button size="xs" variant="outline" leftSection={<IconPlayerPause size={16} aria-hidden />} disabled={busy} loading={resume.isPending} onClick={() => item.on_hold ? void direct(() => resume.mutateAsync(options)) : open('hold')}>{t(item.on_hold ? 'workflow.resume' : 'caseDetail.hold')}</Button>
        {extra}
      </>}
    </Group>
    {saved && <Text size="sm" role="status">{t('workflow.saved')}</Text>}
    {error != null && <WorkflowError error={error} />}
    <Modal opened={action !== null} onClose={() => { if (!busy) setAction(null) }} title={title} closeOnClickOutside={!busy} closeOnEscape={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {!directoryReady && <>
        {(actors.isPending || boards.isPending) && <LoadingState />}
        {actors.isError && <QueryError error={actors.error} retry={() => { void actors.refetch() }} />}
        {boards.isError && <QueryError error={boards.error} retry={() => { void boards.refetch() }} />}
      </>}
      {action && directoryReady && <WorkflowForm key={action} fields={fields} initial={initial} onSaved={success} help={action === 'return' ? t('workflow.returnHelp') : undefined} submitLabel={action === 'return' ? t('caseDetail.returnCase') : undefined} submit={async (values) => {
        if (action === 'return') await returning.mutateAsync({ ...options, body: { note: values.note, finding_id: values.finding || null } })
        if (action === 'hold') await hold.mutateAsync({ ...options, body: { reason: values.reason, until: values.until || null } })
        if (action === 'settings') await update.mutateAsync({ ...options, body: { priority: priorityValue(values.priority), coordinator_id: values.coordinator || null, mdt_board_id: values.board || null, mdt_date: values.date || null } })
        if (action === 'milestones') await milestones.mutateAsync({ ...options, body: { symptom_onset: values.onset || null, treatment_start: values.start || null } })
        if (action === 'transition') await transition.mutateAsync({ ...options, body: { to: values.to === 'kompletni' ? 'kompletni' : 'ceka_na_podklady', note: values.note || null } })
        await refresh()
      }} />}
    </Modal>
  </Stack>
}
