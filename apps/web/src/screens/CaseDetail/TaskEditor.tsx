import { Stack } from '@mantine/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { createTaskMutation, listDocumentsOptions, listTasksOptions, updateTaskMutation } from '../../client/@tanstack/react-query.gen'
import type { Task } from '../../client/types.gen'
import WorkflowForm, { type WorkflowField } from '../../components/workflow/WorkflowForm'
import { lines, priorityValue, statusValue, useOwnerChoices, usePriorityChoices, useWorkflowRefresh } from '../../components/workflow/use-workflow'
import LoadingState, { QueryError } from '../../components/DataState'
import { useSession } from '../../session'

export default function TaskEditor({ caseId, task, initialTitle = '', initialKind = 'other', onSaved }: { caseId: string; task?: Task; initialTitle?: string; initialKind?: string; onSaved: () => void }) {
  const { t } = useTranslation(), { actorId } = useSession()
  const owners = useOwnerChoices(), priorities = usePriorityChoices(), refresh = useWorkflowRefresh(caseId)
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }
  const tasks = useQuery(listTasksOptions(options)), documents = useQuery(listDocumentsOptions(options))
  const create = useMutation(createTaskMutation()), update = useMutation(updateTaskMutation())
  if (owners.state) return owners.state
  if (tasks.isPending || documents.isPending) return <LoadingState />
  if (tasks.isError) return <QueryError error={tasks.error} retry={() => { void tasks.refetch() }} />
  if (documents.isError) return <QueryError error={documents.error} retry={() => { void documents.refetch() }} />
  const kinds = [...new Set(['imaging', 'biopsy', 'histology', 'lab', 'consult', 'request_documents', 'mdt', 'other', ...(task ? [task.kind] : [])])]
  const fields: WorkflowField[] = [
    { name: 'title', label: t('workflow.title'), required: true },
    ...(!task ? [{ name: 'kind', label: t('workflow.kind'), type: 'select' as const, required: true, choices: kinds.map((value) => ({ value, label: t(`caseDetail.taskKinds.${value}`, { defaultValue: value }) })) }] : []),
    { name: 'owner', label: t('workflow.owner'), type: 'select', required: true, choices: owners.choices },
    { name: 'location', label: t('workflow.location') }, { name: 'due', label: t('workflow.due'), type: 'datetime-local' },
    { name: 'priority', label: t('priority'), type: 'select', required: true, choices: priorities },
    { name: 'dependencies', label: t('workflow.dependencies'), type: 'multi', help: t('workflow.dependenciesHelp'), choices: tasks.data.filter((entry) => entry.id !== task?.id).map((entry) => ({ value: entry.id, label: entry.title })) },
    { name: 'external', label: t('workflow.external'), type: 'check' },
    ...(task ? [
      { name: 'status', label: t('workflow.status'), type: 'select' as const, required: true, choices: ['planned', 'booked', 'done', 'cancelled'].map((value) => ({ value, label: t(`caseDetail.taskStatus.${value}`) })) },
      { name: 'document', label: t('workflow.resultDocument'), type: 'select' as const, choices: documents.data.map((entry) => ({ value: entry.id, label: entry.title ?? entry.filename })) },
    ] : []),
  ]
  return <Stack><WorkflowForm fields={fields} initial={{ title: task?.title ?? initialTitle, kind: task?.kind ?? initialKind, owner: task?.owner ?? actorId ?? '', location: task?.location ?? '', due: task?.due?.slice(0, 19) ?? '', priority: task?.priority ?? 'normal', dependencies: task?.depends_on?.join('\n') ?? '', external: task?.external ? 'yes' : '', status: task?.status ?? 'planned', document: task?.result_document_id ?? '' }} onSaved={onSaved} submit={async (values) => {
    const body = { title: values.title, owner_id: values.owner, location: values.location || null, due: values.due || null, priority: priorityValue(values.priority), depends_on: lines(values.dependencies), external: values.external === 'yes' }
    if (task) await update.mutateAsync({ path: { task_id: task.id }, headers: options.headers, body: { ...body, status: statusValue(values.status), result_document_id: values.document || null } })
    else await create.mutateAsync({ ...options, body: { ...body, kind: values.kind } })
    await refresh()
  }} /></Stack>
}
