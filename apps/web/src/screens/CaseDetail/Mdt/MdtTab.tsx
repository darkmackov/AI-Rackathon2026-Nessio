import { Accordion, Alert, Badge, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconCircleCheck, IconCircleDashed, IconLock } from '@tabler/icons-react'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../../api'
import { confirmMdtConclusionMutation, getMdtConclusionOptions, getMdtRecordOptions, listCaseJobsOptions } from '../../../client/@tanstack/react-query.gen'
import type { Case, DocumentMeta, Handover } from '../../../client/types.gen'
import { QueryError } from '../../../components/DataState'
import { terminalJob } from '../../../components/documents/document-utils'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import type { Sources } from '../../../components/handover/ClinicalValue'
import { useSession } from '../../../session'
import { formatDate } from '../../../time'
import ConclusionSection from './ConclusionSection'
import NextStep, { MdtProgress } from './NextStep'
import PreparationSection from './PreparationSection'
import RecordSection from './RecordSection'
import { loaded } from './loaded'
import { mdtStage, openSections, preparationStates, type MdtSection, type MdtStage } from './mdt-progress'

const conflict = (error: unknown) => error instanceof ApiError && error.status === 409

function SectionTitle({ title, status }: { title: string; status?: ReactNode }) {
  return <Group gap="sm" wrap="wrap"><Text fw={650}>{title}</Text>{status}</Group>
}

export default function MdtTab({ item, handover, documents, names, sources, showFindings, showCommunication, handoverState }: {
  item: Case; handover?: Handover; documents: DocumentMeta[]; names: Record<string, string>; sources: Sources; showFindings: () => void; showCommunication: () => void; handoverState?: ReactNode;
}) {
  const { t, i18n } = useTranslation(), { actorId } = useSession(), client = useQueryClient(), busy = useIsMutating() > 0
  const actor = actorId ?? '', options = { headers: actorHeaders(actor), path: { case_id: item.id } }
  const [confirm, setConfirm] = useState(false), [feedback, setFeedback] = useState<string | null>(null)
  // Open sections follow the stage until the coordinator opens or closes one in it.
  const [opened, setOpened] = useState<{ stage: MdtStage; value: string[] } | null>(null)
  const controls = useRef<Partial<Record<MdtSection, HTMLButtonElement | null>>>({})
  const record = useQuery(getMdtRecordOptions(options))
  const conclusion = useQuery({ ...getMdtConclusionOptions(options), enabled: !!record.data })
  const jobs = useQuery(listCaseJobsOptions(options))
  const pre = preparationStates.includes(item.state ?? 'koncept'), ready = item.state === 'pripraveno_k_mdt'
  // The conclusion can be corrected until the feedback is sent; a change needs a new confirmation (Q-F34).
  const conclusionOpen = ready || item.state === 'zaver_mdt'
  const ingest = jobs.data?.filter((job) => job.kind === 'ingest_document' && (!terminalJob(job) || job.status === 'failed')) ?? []
  const pending = ingest.some((job) => !terminalJob(job))
  const recordState = loaded(record), conclusionState = loaded(conclusion)
  const known = conclusionState.kind === 'ready' ? conclusionState.data : conclusionState.kind === 'missing' ? null : undefined
  const stage = mdtStage(item.state, known)
  const value = opened?.stage === stage ? opened.value : openSections(stage)
  const reveal = (section: MdtSection) => {
    if (!value.includes(section)) setOpened({ stage, value: [...value, section] })
    const control = controls.current[section]
    control?.focus(); control?.scrollIntoView?.({ block: 'center' })
  }
  const confirmMutation = useMutation({ ...confirmMdtConclusionMutation(), onSuccess: async () => { await refreshCaseResults(client, item.id); setConfirm(false); setFeedback('mdt.confirmed') } })
  const settled = recordState.kind !== 'loading' && !(record.data && conclusionState.kind === 'loading')

  const recordStatus = record.data
    ? <Badge variant="light" color="blue" leftSection={<IconLock size={12} aria-hidden />}>{t('mdt.recordFrozen', { date: formatDate(record.data.mdt_date, i18n.language) })}</Badge>
    : recordState.kind === 'missing' ? <Badge variant="light" color="gray" c="dark.9" leftSection={<IconCircleDashed size={12} aria-hidden />}>{t('mdt.recordNone')}</Badge> : undefined
  const conclusionStatus = conclusion.data
    ? conclusion.data.confirmed
      ? <Badge variant="light" color="green" c="green.9" leftSection={<IconCircleCheck size={12} aria-hidden />}>{t('mdt.conclusionConfirmed')}</Badge>
      : <Badge variant="light" color="orange" c="orange.9" leftSection={<IconAlertTriangle size={12} aria-hidden />}>{t('mdt.conclusionUnconfirmed')}</Badge>
    : known === null ? <Badge variant="light" color="gray" c="dark.9" leftSection={<IconCircleDashed size={12} aria-hidden />}>{t('mdt.conclusionNone')}</Badge> : undefined
  const control = (section: MdtSection) => ({ ref: (node: HTMLButtonElement | null) => { controls.current[section] = node } })

  return <Stack component="section" aria-label={t('mdt.title')} gap="md">
    <MdtProgress stage={stage} />
    {settled && <NextStep stage={stage} feedback={feedback} disabled={busy || !jobs.isSuccess || !conclusion.isSuccess} pending={pending}
      goSnapshot={() => reveal('record')} goConclusion={() => reveal('conclusion')} goSend={showCommunication} confirm={() => { confirmMutation.reset(); setConfirm(true) }} />}
    <Accordion multiple variant="separated" order={2} chevronPosition="left" value={value} onChange={(next) => setOpened({ stage, value: next })}>
      {pre && <Accordion.Item value="preparation">
        <Accordion.Control {...control('preparation')}><SectionTitle title={t('mdt.preparation')} /></Accordion.Control>
        <Accordion.Panel><PreparationSection caseId={item.id} actorId={actor} handover={handover} handoverState={handoverState} names={names} sources={sources} showFindings={showFindings} locked={pending} /></Accordion.Panel>
      </Accordion.Item>}
      <Accordion.Item value="record">
        <Accordion.Control {...control('record')}><SectionTitle title={t('mdt.record')} status={recordStatus} /></Accordion.Control>
        <Accordion.Panel><RecordSection item={item} actorId={actor} record={recordState} retry={() => { void record.refetch() }} editable={ready} showFindings={showFindings} /></Accordion.Panel>
      </Accordion.Item>
      {record.data && <Accordion.Item value="conclusion">
        <Accordion.Control {...control('conclusion')}><SectionTitle title={t('mdt.conclusion')} status={conclusionStatus} /></Accordion.Control>
        <Accordion.Panel><ConclusionSection caseId={item.id} actorId={actor} record={record.data} conclusion={conclusionState} retry={() => { void conclusion.refetch() }} jobs={jobs} ingest={ingest} pending={pending} editable={conclusionOpen} documents={documents} sources={sources} /></Accordion.Panel>
      </Accordion.Item>}
    </Accordion>
    <Modal opened={confirm} onClose={() => { if (!busy) setConfirm(false) }} title={t('mdt.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      <Stack><Text>{t('mdt.confirmHelp')}</Text>{confirmMutation.isError && (conflict(confirmMutation.error) ? <Alert color="orange" role="alert">{t('mdt.confirmIncomplete')}</Alert> : <QueryError error={confirmMutation.error} />)}
        <Group><Button loading={confirmMutation.isPending} disabled={busy || pending} onClick={() => confirmMutation.mutate(options)}>{t('mdt.confirm')}</Button><Button variant="default" disabled={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
  </Stack>
}
