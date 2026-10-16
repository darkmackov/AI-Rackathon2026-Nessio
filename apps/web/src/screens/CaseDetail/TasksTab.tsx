import TaskEditor from './TaskEditor'
import TaskSetsDialog from './TaskSetsDialog'
import { useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { Anchor, Badge, Button, Group, Modal, Stack, Table, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listTasksOptions } from '../../client/@tanstack/react-query.gen'
import { DueDate } from '../../components/CaseTime'
import PersonChip from '../../components/PersonChip'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { useSession } from '../../session'
import type { OpenSource } from '../../components/handover/ClinicalValue'

export default function TasksTab({ caseId, openSource, showFinding }: { caseId: string; openSource: OpenSource; showFinding: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const { actorId } = useSession()
  const [editing, setEditing] = useState<string | null>(null), [setsOpen, setSetsOpen] = useState(false), [saved, setSaved] = useState(false)
  const busy = useIsMutating() > 0
  const tasks = useQuery(listTasksOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }))
  const sorted = [...tasks.data ?? []].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id.localeCompare(b.id))
  return <Stack>
    <Group><Button size="sm" disabled={busy} onClick={() => { setSaved(false); setSetsOpen(true) }}>{t('caseDetail.startSet')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { setSaved(false); setEditing('new') }}>{t('caseDetail.addTask')}</Button></Group>
    {saved && <Text role="status" size="sm">{t('workflow.saved')}</Text>}
    {tasks.isPending && <LoadingState rows={5} />}
    {tasks.isError && <QueryError error={tasks.error} pending={tasks.isFetching} retry={() => { void tasks.refetch() }} />}
    {tasks.isSuccess && !sorted.length && <EmptyState title={t('caseDetail.noTasks')} />}
    {sorted.length > 0 && <Table.ScrollContainer minWidth={680}><Table withTableBorder verticalSpacing="sm" fz="sm">
      <Table.Thead><Table.Tr>
        {['caseDetail.task', 'caseDetail.taskState', 'owner', 'nextDue', 'caseDetail.dependencies', 'caseDetail.links'].map((label) => <Table.Th key={label} style={{ overflowWrap: 'normal' }}>{t(label)}</Table.Th>)}
      </Table.Tr></Table.Thead>
      <Table.Tbody>{sorted.map((task) => <Table.Tr key={task.id} id={`task-${task.id}`} style={{ verticalAlign: 'top' }}>
        <Table.Td>
          <Text size="sm" fw={600}>{task.title}</Text>
          <Text size="xs" c="dimmed">{i18n.exists(`caseDetail.taskKinds.${task.kind}`) ? t(`caseDetail.taskKinds.${task.kind}`) : task.kind}</Text>
          <Text size="xs" c="dimmed">{task.location ?? t('unavailable')}</Text>
          {task.external && <Badge mt={4} size="sm" color="gray" variant="light" c="dark.9">{t('caseDetail.external')}</Badge>}
        </Table.Td>
        <Table.Td miw={112}><Stack gap={4} align="flex-start">
          <Badge size="sm" variant="light">{t(`caseDetail.taskStatus.${task.status ?? 'planned'}`)}</Badge>
          <Badge size="sm" variant="outline">{t(`priorities.${task.priority ?? 'normal'}`)}</Badge>
        </Stack></Table.Td>
        <Table.Td><PersonChip id={task.owner} size="xs" /></Table.Td>
        <Table.Td><DueDate value={task.due} active={task.status !== 'done' && task.status !== 'cancelled'} /></Table.Td>
        <Table.Td><Stack gap={2}>
          {!task.depends_on?.length && <Text size="sm" c="dimmed">{t('caseDetail.noDependencies')}</Text>}
          {task.depends_on?.map((id) => {
            const dependency = tasks.data?.find((item) => item.id === id)
            return dependency ? <Group key={id} gap={6}><Anchor href={`#task-${id}`} size="sm">{dependency.title}</Anchor><Badge size="xs" variant="light" color="gray" c="dark.9">{t(`caseDetail.taskStatus.${dependency.status ?? 'planned'}`)}</Badge></Group> : <Text key={id} size="sm">{t('caseDetail.missingTask')}</Text>
          })}
        </Stack></Table.Td>
        <Table.Td><Stack gap={4} align="flex-start">
          <Button size="compact-sm" variant="subtle" disabled={busy} onClick={() => { setSaved(false); setEditing(task.id) }}>{t('workflow.editTask')}</Button>
          {task.finding_id && <Button variant="subtle" size="compact-sm" onClick={() => showFinding(task.finding_id!)}>{t('caseDetail.relatedFinding')}</Button>}
          {task.result_document_id && <Button variant="subtle" size="compact-sm" onClick={(event) => openSource({ documentId: task.result_document_id! }, event.currentTarget)}>{t('caseDetail.resultDocument')}</Button>}
        </Stack></Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table></Table.ScrollContainer>}
    <Modal opened={!!editing} onClose={() => { if (!busy) setEditing(null) }} title={t(editing === 'new' ? 'caseDetail.addTask' : 'workflow.editTask')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {editing && <TaskEditor key={editing} caseId={caseId} task={tasks.data?.find((task) => task.id === editing)} onSaved={() => { setEditing(null); setSaved(true) }} />}
    </Modal>
    {setsOpen && <TaskSetsDialog caseId={caseId} opened onClose={() => setSetsOpen(false)} onSaved={() => { setSetsOpen(false); setSaved(true) }} />}
  </Stack>
}
