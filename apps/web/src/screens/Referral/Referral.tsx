import { pendingControlProps } from '../../components/pending-control'
import Button from '../../components/ActionButton'
import WriteControls from '../../components/WriteControls'
import { Alert, Anchor, Badge, Grid, Group, Modal, Paper, Stack, Tabs, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { IconArrowLeft, IconClipboardText, IconFiles } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { getCaseOptions, getHandoverOptions, listActorsOptions, listCaseJobsOptions, listDocumentsOptions, listFindingsOptions, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { DueDate } from '../../components/CaseTime'
import PageHeading from '../../components/PageHeading'
import PersonChip from '../../components/PersonChip'
import DocumentsTab from '../../components/documents/DocumentsTab'
import { terminalJob } from '../../components/documents/document-utils'
import { StampView } from '../../components/handover/ClinicalValue'
import { handoverFields, sectionOf } from '../../components/handover/clinical'
import { useDocumentSources } from '../../components/handover/use-document-sources'
import HandoverTab from '../../components/handover/HandoverTab'
import FindingsPanel from '../../components/handover/FindingsPanel'
import SourcePanel, { SourcePlaceholder } from '../../components/handover/SourcePanel'
import { useSession } from '../../session'
import ExaminationForm from './ExaminationForm'
import HandoverFieldForm from '../../components/handover/HandoverFieldForm'
import ReturnedNote from './ReturnedNote'
import SendReferral from './SendReferral'
import ExportCaseFhir from '../../components/fhir/ExportCaseFhir'

function BackLink() {
  const { t } = useTranslation()
  return <Anchor component={Link} to="/referrer" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconArrowLeft size={16} aria-hidden />{t('referral.back')}</Anchor>
}

function ReferralContent({ caseId }: { caseId: string }) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const actor = actorId ?? ''
  const wide = useMediaQuery('(min-width: 75em)')
  const [tab, setTab] = useState<string | null>('documents')
  const [openSections, setOpenSections] = useState<string[]>(['patient', 'diagnosis', 'epicrisis'])
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ path: string; unavailable: boolean } | null>(null)
  const [addExam, setAddExam] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const options = { path: { case_id: caseId }, headers: actorHeaders(actor) }
  const item = useQuery(getCaseOptions(options))
  const allowed = !!item.data && item.data.referring_doctor_id === actor
  const handover = useQuery({ ...getHandoverOptions(options), enabled: allowed })
  const documents = useQuery({ ...listDocumentsOptions(options), enabled: allowed })
  const findings = useQuery({ ...listFindingsOptions(options), enabled: allowed })
  const jobs = useQuery({ ...listCaseJobsOptions(options), enabled: allowed })
  const actors = useQuery({ ...listActorsOptions(), enabled: allowed })
  const organizations = useQuery({ ...listOrganizationsOptions(), enabled: allowed })
  const editable = allowed && (item.data?.state === 'koncept' || item.data?.state === 'vraceno_lekari')
  const processing = jobs.data?.some((job) => job.kind === 'ingest_document' && !terminalJob(job)) ?? false
  const fields = handover.data ? handoverFields(handover.data) : {}
  const names = Object.fromEntries([...(actors.data ?? []), ...(organizations.data ?? [])].map((entry) => [entry.id, entry.name]))
  const { selection, openSource, closeSource, evidence, selectedDocument, sources } = useDocumentSources(handover.data, documents.data, findings.data)
  const showField = (path: string) => {
    const section = sectionOf(path)?.key
    if (section && !openSections.includes(section)) setOpenSections([...openSections, section])
    setTab('handover')
    setFocusPath(path)
    document.getElementById(`field-${path}`)?.focus({ preventScroll: true })
    document.getElementById(`field-${path}`)?.scrollIntoView?.({ block: 'center' })
  }
  const showFinding = (id: string) => { document.getElementById(`finding-${id}`)?.focus({ preventScroll: true }); document.getElementById(`finding-${id}`)?.scrollIntoView?.({ block: 'center' }) }
  if (item.isPending) return <Stack><BackLink /><LoadingState rows={4} /></Stack>
  if (item.isError) return <Stack><BackLink /><PageHeading>{t('referral.detail')}</PageHeading><QueryError error={item.error} pending={item.isFetching} retry={() => { void item.refetch() }} /></Stack>
  if (!allowed) return <Stack><BackLink /><PageHeading>{t('referral.detail')}</PageHeading><EmptyState title={t('referral.inaccessible')} /></Stack>
  const current = item.data
  const koc = names[current.koc_id] ?? t('unavailable')
  const source = selection && <SourcePanel key={JSON.stringify(selection)} document={selectedDocument || undefined} evidence={evidence} close={closeSource}
    fallback={documents.isPending ? <LoadingState /> : documents.isError ? <QueryError error={documents.error} retry={() => { void documents.refetch() }} pending={documents.isFetching} /> : undefined} />
  const editLabel = editing && sectionOf(editing.path)?.fields.find(([path]) => path === editing.path)?.[1]
  return <Stack gap="md">
    <BackLink />
    <Paper withBorder p="md"><Stack gap="xs">
      <Group justify="space-between" align="flex-start"><PageHeading size="h2">{current.patient_name || t('referral.unnamed')}</PageHeading><Group gap="xs" align="center"><Badge variant="light">{current.state ? t(`states.${current.state}`) : t('unavailable')}</Badge><ExportCaseFhir caseId={caseId} actorId={actor} />
        {editable && <SendReferral caseId={caseId} actorId={actor} koc={koc} disabled={!handover.isSuccess || !jobs.isSuccess || processing} sent={(returned) => setFeedback(returned ? 'referral.resend' : 'referral.sent')} />}</Group></Group>
      {current.diagnosis_label && <Text size="sm">{current.diagnosis_label}</Text>}
      <Text size="sm">{t('referral.koc')}: {koc}</Text>
      <Group gap="md"><Group gap={4}><Text size="xs" c="dimmed">{t('owner')}:</Text><PersonChip id={current.on_move} size="xs" /></Group><Text size="sm">{t('nextStep')}: {current.next_step ?? t('unavailable')}</Text><Group gap={4}><Text size="xs" c="dimmed">{t('nextDue')}:</Text><DueDate value={current.next_due} /></Group></Group>
    </Stack></Paper>
    {feedback && <Alert color="green" role="status">{t(feedback)}</Alert>}
    {editable && processing && <Alert color="blue" role="status">{t('referral.processing')}</Alert>}
    {current.state === 'vraceno_lekari' && <ReturnedNote caseId={caseId} actorId={actor} />}
    {!editable && <Alert color="blue" role="status">{t('referral.readOnly')}</Alert>}
    <Tabs value={tab} onChange={(value) => { setTab(value); setFocusPath(null); closeSource() }} keepMounted>
      <Tabs.List><Tabs.Tab value="documents" leftSection={<IconFiles size={16} aria-hidden />}>{t('caseDetail.tabs.documents')}</Tabs.Tab><Tabs.Tab value="handover" leftSection={<IconClipboardText size={16} aria-hidden />}>{t('caseDetail.tabs.handover')}</Tabs.Tab></Tabs.List>
      <Grid mt="md"><Grid.Col span={wide ? 7 : 12} miw={0}>
        <Tabs.Panel value="documents"><Stack gap="md"><Text size="sm">{t('referral.uploadHelp')}</Text><DocumentsTab item={current} names={names} openSource={openSource} readOnly={!editable} /></Stack></Tabs.Panel>
        <Tabs.Panel value="handover"><Stack gap="sm">
          <Text size="sm">{t('referral.reviewHelp')}</Text>
          {handover.isPending && <LoadingState rows={5} />}
          {handover.isError && (handover.error instanceof ApiError && handover.error.status === 404 ? <EmptyState title={t('caseDetail.noHandover')} retry={() => { void handover.refetch() }} /> : <QueryError error={handover.error} retry={() => { void handover.refetch() }} pending={handover.isFetching} />)}
          {documents.isError && <QueryError error={documents.error} retry={() => { void documents.refetch() }} pending={documents.isFetching} />}
          {actors.isError && <QueryError error={actors.error} retry={() => { void actors.refetch() }} pending={actors.isFetching} />}
          {organizations.isError && <QueryError error={organizations.error} retry={() => { void organizations.refetch() }} pending={organizations.isFetching} />}
          {handover.data && <>
            <Group gap="xs"><Text size="sm" c="dimmed">{t('caseDetail.validated')}:</Text><StampView stamp={handover.data.validated_by_referrer} names={names} /></Group>
            <HandoverTab handover={handover.data} names={names} sources={sources} findings={findings.data?.filter((finding) => !finding.resolved) ?? []} showFinding={showFinding} open={openSections} setOpen={(sections) => { setOpenSections(sections); setFocusPath(null) }} focusPath={focusPath}
              fieldActions={(path) => !editable || path === 'epicrisis' || path === 'mdt_question' ? null : <WriteControls>{(busy) => <Group gap="xs">
                <Button size="compact-sm" variant="subtle" pending={busy || processing} onClick={() => setEditing({ path, unavailable: false })}>{t(fields[path]?.status === 'found' ? 'referral.edit' : 'referral.fill')}</Button>
                <Button size="compact-sm" variant="subtle" color="gray" pending={busy || processing} onClick={() => setEditing({ path, unavailable: true })}>{t('handoverEdit.notAvailable')}</Button>
              </Group>}</WriteControls>}
              examinationAction={editable && <WriteControls>{(busy) => <Button variant="outline" size="compact-sm" pending={busy || processing} onClick={() => setAddExam(true)}>{t('referral.addExam')}</Button>}</WriteControls>} />
          </>}
          <FindingsPanel caseId={caseId} names={names} sources={sources} handover={handover.data} showField={showField} />
          {jobs.isError && <QueryError error={jobs.error} retry={() => { void jobs.refetch() }} pending={jobs.isFetching} />}
        </Stack></Tabs.Panel>
      </Grid.Col>{wide && <Grid.Col span={5}>{source || <SourcePlaceholder />}</Grid.Col>}</Grid>
      {!wide && source}
    </Tabs>
    <WriteControls>{(busy) => <Modal opened={!!editing && editable} onClose={() => { if (!busy) setEditing(null) }} title={t('referral.editField', { field: editLabel ? t(`caseDetail.${editLabel}`) : '' })} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      {editing && editable && <HandoverFieldForm key={`${editing.path}-${editing.unavailable}`} caseId={caseId} actorId={actor} path={editing.path} value={fields[editing.path]} unavailable={editing.unavailable} close={() => setEditing(null)} saved={() => { setEditing(null); setFeedback('referral.saved') }} />}
    </Modal>}</WriteControls>
    <WriteControls>{(busy) => <Modal opened={addExam && editable} onClose={() => { if (!busy) setAddExam(false) }} title={t('referral.addExam')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      {addExam && editable && <ExaminationForm caseId={caseId} actorId={actor} close={() => setAddExam(false)} saved={() => { setAddExam(false); setFeedback('referral.examSaved') }} />}
    </Modal>}</WriteControls>
  </Stack>
}

export default function Referral() {
  const { caseId } = useParams({ from: '/referrer/cases/$caseId' })
  const { actorId } = useSession()
  return <ReferralContent key={`${actorId}-${caseId}`} caseId={caseId} />
}
