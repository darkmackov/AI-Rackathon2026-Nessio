import { Alert, Button, Group, Modal, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../../api'
import { confirmMdtConclusionMutation, getMdtConclusionOptions, getMdtRecordOptions, listCaseJobsOptions } from '../../../client/@tanstack/react-query.gen'
import type { Case, ConclusionPrefill, DocumentMeta, Handover, MdtResultRow } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import JobProgress from '../../../components/documents/JobProgress'
import { terminalJob } from '../../../components/documents/document-utils'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import ClinicalValue, { type Sources } from '../../../components/handover/ClinicalValue'
import HandoverFieldForm from '../../../components/handover/HandoverFieldForm'
import { useSession } from '../../../session'
import ConclusionEditor from './ConclusionEditor'
import ConclusionUpload from './ConclusionUpload'
import ConclusionView from './ConclusionView'
import DraftPanel from './DraftPanel'
import PdfDownload from './PdfDownload'
import RecordEditor from './RecordEditor'
import RecordView from './RecordView'
import SnapshotForm from './SnapshotForm'

type Editor = { kind: 'field'; path: 'epicrisis' | 'mdt_question'; draft?: string } | { kind: 'record'; rows?: MdtResultRow[] } | { kind: 'conclusion'; prefill?: ConclusionPrefill } | null
const missing = (error: unknown) => error instanceof ApiError && error.status === 404
const conflict = (error: unknown) => error instanceof ApiError && error.status === 409

export default function MdtTab({ item, handover, documents, names, sources, showFindings, handoverState }: { item: Case; handover?: Handover; documents: DocumentMeta[]; names: Record<string, string>; sources: Sources; showFindings: () => void; handoverState?: ReactNode }) {
  const { t } = useTranslation(), { actorId } = useSession(), client = useQueryClient(), busy = useIsMutating() > 0
  const actor = actorId ?? '', options = { headers: actorHeaders(actor), path: { case_id: item.id } }
  const [editor, setEditor] = useState<Editor>(null), [confirm, setConfirm] = useState(false), [feedback, setFeedback] = useState<string | null>(null)
  const record = useQuery(getMdtRecordOptions(options))
  const conclusion = useQuery({ ...getMdtConclusionOptions(options), enabled: !!record.data })
  const jobs = useQuery(listCaseJobsOptions(options))
  const pre = ['v_triage', 'ceka_na_podklady', 'kompletni'].includes(item.state ?? ''), ready = item.state === 'pripraveno_k_mdt'
  // The conclusion can be corrected until the feedback is sent; a change needs a new confirmation (Q-F34).
  const conclusionOpen = ready || item.state === 'zaver_mdt'
  const ingest = jobs.data?.filter((job) => job.kind === 'ingest_document' && (!terminalJob(job) || job.status === 'failed')) ?? []
  const pending = ingest.some((job) => !terminalJob(job))
  const confirmMutation = useMutation({ ...confirmMdtConclusionMutation(), onSuccess: async () => { await refreshCaseResults(client, item.id); setConfirm(false); setFeedback('mdt.confirmed') } })
  const saved = () => { setEditor(null); setFeedback('mdt.saved') }
  const fieldActions = (path: 'epicrisis' | 'mdt_question') => <Button variant="outline" size="compact-sm" disabled={busy || pending} onClick={() => setEditor({ kind: 'field', path })}>{t('mdt.edit')}</Button>
  return <Stack component="section" aria-label={t('mdt.title')} gap="lg">
    {feedback && <Alert color="green" role="status">{t(feedback)}</Alert>}
    {pre && <Stack gap="sm"><Title order={2} size="h4">{t('mdt.preparation')}</Title>
      {handoverState}
      {!handover ? !handoverState && <EmptyState title={t('caseDetail.noHandover')} /> : <>
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
          <ClinicalValue idPrefix="mdt-field" label={t('mdt.sourceEpicrisis')} path="epicrisis_source" value={handover.epicrisis_source} names={names} sources={sources} findings={[]} showFinding={showFindings} />
          <Stack><ClinicalValue idPrefix="mdt-field" label={t('mdt.finalEpicrisis')} path="epicrisis" value={handover.epicrisis} names={names} sources={sources} findings={[]} showFinding={showFindings} actions={fieldActions('epicrisis')} />
            <DraftPanel caseId={item.id} actorId={actor} kind="epicrisis_summary" onUse={(draft) => setEditor({ kind: 'field', path: 'epicrisis', draft: draft.text ?? '' })} />
          </Stack>
        </SimpleGrid>
        <ClinicalValue idPrefix="mdt-field" label={t('mdt.question')} path="mdt_question" value={handover.mdt_question} names={names} sources={sources} findings={[]} showFinding={showFindings} actions={fieldActions('mdt_question')} />
        <DraftPanel caseId={item.id} actorId={actor} kind="mdt_question" onUse={(draft) => setEditor({ kind: 'field', path: 'mdt_question', draft: draft.text ?? '' })} />
      </>}
    </Stack>}
    <Stack gap="sm"><Title order={2} size="h4">{t('mdt.record')}</Title>
      {record.isPending && <LoadingState rows={3} />}
      {record.isError && (missing(record.error) ? <EmptyState title={t('mdt.noRecord')} description={item.state !== 'kompletni' ? t('mdt.notComplete') : undefined} /> : <QueryError error={record.error} retry={() => { void record.refetch() }} />)}
      {item.state === 'kompletni' && <SnapshotForm item={item} actorId={actor} showFindings={showFindings} />}
      {record.data && <>
        <RecordView record={record.data} />
        <Group align="flex-start"><PdfDownload caseId={item.id} actorId={actor} kind="record" />{ready && <Button variant="outline" size="compact-sm" disabled={busy} onClick={() => setEditor({ kind: 'record' })}>{t('mdt.editRecord')}</Button>}</Group>
        {ready && <><Text size="sm" c="dimmed">{t('mdt.resultsDraftHelp')}</Text><DraftPanel caseId={item.id} actorId={actor} kind="mdt_results" onUse={(draft) => setEditor({ kind: 'record', rows: draft.rows ?? [] })} /></>}
      </>}
    </Stack>
    {record.data && <Stack gap="sm"><Title order={2} size="h4">{t('mdt.conclusion')}</Title>
      {conclusion.isPending && <LoadingState rows={3} />}
      {conclusion.isError && (missing(conclusion.error) ? <EmptyState title={t('mdt.noConclusion')} /> : <QueryError error={conclusion.error} retry={() => { void conclusion.refetch() }} />)}
      {conclusion.data && <><ConclusionView conclusion={conclusion.data} /><PdfDownload caseId={item.id} actorId={actor} kind="conclusion" />
        {conclusion.data.document_id && <Button variant="outline" size="compact-sm" disabled={!documents.some((document) => document.id === conclusion.data.document_id)} onClick={(event) => { if (conclusion.data.document_id) sources.openSource({ documentId: conclusion.data.document_id }, event.currentTarget) }}>{t('mdt.source')}</Button>}
        {conclusion.data.document_id && !documents.some((document) => document.id === conclusion.data.document_id) && <Alert color="orange" role="status">{t('mdt.noSource')}</Alert>}
      </>}
      {conclusionOpen && <>
        {item.state === 'zaver_mdt' && <Text size="sm" c="dimmed">{t('mdt.correctionHelp')}</Text>}
        <Button variant="outline" disabled={busy || pending} onClick={() => setEditor({ kind: 'conclusion' })}>{t('mdt.editConclusion')}</Button>
        <DraftPanel caseId={item.id} actorId={actor} kind="mdt_conclusion" onUse={(draft) => setEditor({ kind: 'conclusion', prefill: draft.fields ?? undefined })} />
        <ConclusionUpload caseId={item.id} actorId={actor} disabled={pending} />
        {ingest.map((job) => <JobProgress key={job.id} job={job} actorId={actor} documents={documents} />)}
        {pending && <Alert color="blue" role="status">{t('mdt.pendingUpload')}</Alert>}
        {jobs.isError && <QueryError error={jobs.error} retry={() => { void jobs.refetch() }} />}
        {conclusion.data && !conclusion.data.confirmed && <Button disabled={busy || pending || !jobs.isSuccess || !conclusion.isSuccess} onClick={() => { confirmMutation.reset(); setConfirm(true) }}>{t('mdt.confirm')}</Button>}
      </>}
    </Stack>}
    <Modal opened={!!editor} onClose={() => { if (!busy) setEditor(null) }} size="lg" title={t(editor?.kind === 'record' ? 'mdt.editRecord' : editor?.kind === 'conclusion' ? 'mdt.editConclusion' : editor?.kind === 'field' && editor.path === 'mdt_question' ? 'mdt.question' : 'mdt.finalEpicrisis')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {editor?.kind === 'field' && pre && <HandoverFieldForm key={editor.path} caseId={item.id} actorId={actor} path={editor.path} value={handover?.[editor.path]} initialText={editor.draft} close={() => setEditor(null)} saved={saved} />}
      {editor?.kind === 'record' && ready && record.data && <RecordEditor record={record.data} rows={editor.rows} actorId={actor} saved={saved} />}
      {editor?.kind === 'conclusion' && conclusionOpen && record.data && <ConclusionEditor caseId={item.id} actorId={actor} conclusion={conclusion.data} prefill={editor.prefill} meetingDate={record.data.mdt_date} saved={saved} />}
    </Modal>
    <Modal opened={confirm} onClose={() => { if (!busy) setConfirm(false) }} title={t('mdt.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      <Stack><Text>{t('mdt.confirmHelp')}</Text>{confirmMutation.isError && (conflict(confirmMutation.error) ? <Alert color="orange" role="alert">{t('mdt.confirmIncomplete')}</Alert> : <QueryError error={confirmMutation.error} />)}
        <Group><Button loading={confirmMutation.isPending} disabled={busy || pending} onClick={() => confirmMutation.mutate(options)}>{t('mdt.confirm')}</Button><Button variant="default" disabled={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
  </Stack>
}
