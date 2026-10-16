import { Anchor, Badge, Grid, Stack, Tabs, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { getCaseOptions, getHandoverOptions, listActorsOptions, listDocumentsOptions, listFindingsOptions, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import { detailTabs } from '../../case-route'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import PageHeading from '../../components/PageHeading'
import { useSession } from '../../session'
import { handoverFields, problemSections, sectionOf, type SourceSelection } from './clinical'
import DocumentsTab from './DocumentsTab'
import FindingsPanel from './FindingsPanel'
import HandoverTab from './HandoverTab'
import OverviewTab from './OverviewTab'
import SourcePanel from './SourcePanel'
import TasksTab from './TasksTab'

function DetailContent({ caseId }: { caseId: string }) {
  const { t } = useTranslation()
  const { actor, actorId } = useSession()
  const navigate = useNavigate({ from: '/coordinator/cases/$caseId' })
  const { tab } = useSearch({ from: '/coordinator/cases/$caseId' })
  const wide = useMediaQuery('(min-width: 75em)')
  const [selection, setSelection] = useState<SourceSelection | null>(null)
  const [chosenSections, setChosenSections] = useState<string[] | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const item = useQuery(getCaseOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }))
  const allowed = !!item.data && item.data.koc_id === actor?.organization_id
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }
  const handover = useQuery({ ...getHandoverOptions(options), enabled: allowed })
  const documents = useQuery({ ...listDocumentsOptions(options), enabled: allowed })
  const findings = useQuery({ ...listFindingsOptions(options), enabled: allowed })
  const actors = useQuery({ ...listActorsOptions(), enabled: allowed })
  const organizations = useQuery({ ...listOrganizationsOptions(), enabled: allowed })
  // Until the user toggles a section, open exactly those with missing or conflicting values.
  const openSections = chosenSections ?? (handover.data ? problemSections(handover.data) : [])
  const names = Object.fromEntries([...(actors.data ?? []), ...(organizations.data ?? [])].map((entry) => [entry.id, entry.name]))
  const documentNames = Object.fromEntries((documents.data ?? []).map((document) => [document.id, document.title ?? document.filename]))
  const openSource = (source: SourceSelection, element: HTMLButtonElement) => { trigger.current = element; setSelection(source) }
  const closeSource = () => { setSelection(null); if (trigger.current?.isConnected) trigger.current.focus() }
  const evidence = selection && !('documentId' in selection) ? (
    selection.kind === 'field' ? handover.data && handoverFields(handover.data)[selection.path]?.evidence?.[selection.index]
      : selection.kind === 'examination' ? handover.data?.examinations?.[selection.row]?.evidence?.[selection.index]
        : selection.kind === 'lab' ? handover.data?.labs?.[selection.row]?.evidence?.[selection.index]
          : findings.data?.find((finding) => finding.id === selection.id)?.evidence?.[selection.index]
  ) : undefined
  const selectedDocument = selection && documents.data?.find((document) => document.id === ('documentId' in selection ? selection.documentId : evidence?.document_id))
  const switchTab = (value: string | null) => {
    const next = detailTabs.find((entry) => entry === value)
    if (next) void navigate({ search: { tab: next } })
  }
  const showField = (path: string) => {
    const section = sectionOf(path)?.key
    if (section && !openSections.includes(section)) setChosenSections([...openSections, section])
    void navigate({ search: { tab: 'handover' }, hash: `field-${path}` })
  }
  const back = <Anchor component={Link} to="/coordinator">← {t('caseDetail.back')}</Anchor>
  if (item.isPending) return <Stack>{back}<LoadingState /></Stack>
  if (item.isError) return <Stack>{back}<PageHeading>{t('caseDetail.unavailableCase')}</PageHeading><QueryError error={item.error} pending={item.isFetching} retry={() => { void item.refetch() }} /></Stack>
  if (!allowed || !item.data) return <Stack>{back}<PageHeading>{t('caseDetail.unavailableCase')}</PageHeading><EmptyState title={t('caseDetail.unavailableCase')} /></Stack>
  const current = item.data
  const referrer = actors.data?.find((person) => person.id === current.referring_doctor_id)
  const unresolved = findings.data?.filter((finding) => !finding.resolved).length ?? 0
  const handoverState = <>
    {handover.isPending && <LoadingState />}
    {handover.isError && (handover.error instanceof ApiError && handover.error.status === 404 ? <EmptyState title={t('caseDetail.noHandover')} retry={() => { void handover.refetch() }} /> : <QueryError error={handover.error} pending={handover.isFetching} retry={() => { void handover.refetch() }} />)}
  </>
  const directoryState = <>
    {(actors.isPending || organizations.isPending) && <LoadingState />}
    {actors.isError && <QueryError error={actors.error} pending={actors.isFetching} retry={() => { void actors.refetch() }} />}
    {organizations.isError && <QueryError error={organizations.error} pending={organizations.isFetching} retry={() => { void organizations.refetch() }} />}
  </>
  return <Stack gap="lg">
    {back}
    <div><PageHeading>{current.patient_name}</PageHeading><Text mt="xs">{current.diagnosis_label ?? t('unavailable')}</Text></div>
    <Grid align="flex-start">
      <Grid.Col span={selection && wide ? 7 : 12}>
        <Tabs value={tab} onChange={switchTab} keepMounted={false}>
          <Tabs.List>{detailTabs.map((value) => <Tabs.Tab key={value} value={value}
            rightSection={value === 'findings' && unresolved > 0 ? <Badge size="sm" variant="filled" color="red.8">{unresolved}</Badge> : undefined}>{t(`caseDetail.tabs.${value}`)}</Tabs.Tab>)}</Tabs.List>
          <Tabs.Panel value="overview" pt="lg">
            <OverviewTab item={current} names={names} referrer={referrer} handover={handover.data} handoverState={handoverState} directoryState={directoryState} />
          </Tabs.Panel>
          <Tabs.Panel value="handover" pt="lg"><Stack gap="md">
            {handoverState}
            {documents.isError && <QueryError error={documents.error} pending={documents.isFetching} retry={() => { void documents.refetch() }} />}
            {handover.data && <HandoverTab handover={handover.data} names={names} documentNames={documentNames} openSource={openSource} open={openSections} setOpen={setChosenSections} />}
          </Stack></Tabs.Panel>
          <Tabs.Panel value="findings" pt="lg">
            <FindingsPanel caseId={caseId} handover={handover.data} names={names} documentNames={documentNames} openSource={openSource} showField={showField} />
          </Tabs.Panel>
          <Tabs.Panel value="documents" pt="lg"><DocumentsTab item={current} names={names} openSource={openSource} /></Tabs.Panel>
          <Tabs.Panel value="tasks" pt="lg"><TasksTab caseId={caseId} names={names} openSource={openSource} showFinding={(id) => { void navigate({ search: { tab: 'findings' }, hash: `finding-${id}` }) }} /></Tabs.Panel>
        </Tabs>
      </Grid.Col>
      {selection && <Grid.Col span={wide ? 5 : 12}>
        <SourcePanel key={selectedDocument?.id ?? 'unavailable'} document={selectedDocument || undefined} evidence={evidence} close={closeSource}
          fallback={documents.isPending ? <LoadingState /> : documents.isError ? <QueryError error={documents.error} pending={documents.isFetching} retry={() => { void documents.refetch() }} /> : undefined} />
      </Grid.Col>}
    </Grid>
  </Stack>
}

export default function CaseDetail() {
  const { caseId } = useParams({ from: '/coordinator/cases/$caseId' })
  return <DetailContent key={caseId} caseId={caseId} />
}
