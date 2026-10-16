import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { upsertMdtConclusionMutation } from '../../../client/@tanstack/react-query.gen'
import type { MdtConclusion, MdtConclusionUpsert } from '../../../client/types.gen'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import WorkflowForm, { type WorkflowField } from '../../../components/workflow/WorkflowForm'
import { lines } from '../../../components/workflow/use-workflow'

export default function ConclusionEditor({ caseId, actorId, conclusion, draft, meetingDate, saved }: { caseId: string; actorId: string; conclusion?: MdtConclusion; draft?: string; meetingDate: string; saved: () => void }) {
  const { t } = useTranslation(), client = useQueryClient()
  const mutation = useMutation({ ...upsertMdtConclusionMutation(), onSuccess: () => refreshCaseResults(client, caseId) })
  const fields: WorkflowField[] = [
    { name: 'presented_by', label: t('mdt.presentedBy') }, { name: 'diagnosis_name', label: t('mdt.diagnosis') }, { name: 'diagnosis_code', label: t('mdt.definitiveCode') },
    { name: 'clinical_assessment', label: t('mdt.assessment'), type: 'textarea' }, { name: 'conclusion', label: t('mdt.conclusion'), type: 'textarea' },
    { name: 'recommendations', label: t('mdt.recommendations'), type: 'textarea', help: t('mdt.lines') }, { name: 'place', label: t('mdt.place') }, { name: 'date', label: t('mdt.date'), type: 'date' },
    { name: 'chair', label: t('mdt.chair') }, { name: 'copy_to', label: t('mdt.copyTo'), type: 'textarea', help: t('mdt.lines') },
  ]
  return <WorkflowForm fields={fields} help={t('mdt.conclusionHelp')} initial={{ presented_by: conclusion?.presented_by ?? '', diagnosis_name: conclusion?.diagnosis_name ?? '', diagnosis_code: conclusion?.diagnosis_code ?? '', clinical_assessment: conclusion?.clinical_assessment ?? '',
    conclusion: draft ?? conclusion?.conclusion ?? '', recommendations: conclusion?.recommendations?.join('\n') ?? '', place: conclusion?.place ?? '', date: conclusion?.date ?? meetingDate, chair: conclusion?.chair ?? '', copy_to: conclusion?.copy_to?.join('\n') ?? '' }}
    onSaved={saved} submit={async (values) => {
      const body: MdtConclusionUpsert = { presented_by: values.presented_by || null, diagnosis_name: values.diagnosis_name || null, diagnosis_code: values.diagnosis_code || null, clinical_assessment: values.clinical_assessment || null,
        conclusion: values.conclusion || null, recommendations: lines(values.recommendations), place: values.place || null, date: values.date || null, chair: values.chair || null, copy_to: lines(values.copy_to), ai_draft_used: draft !== undefined || conclusion?.ai_draft_used === true }
      await mutation.mutateAsync({ body, headers: actorHeaders(actorId), path: { case_id: caseId } })
    }} />
}
