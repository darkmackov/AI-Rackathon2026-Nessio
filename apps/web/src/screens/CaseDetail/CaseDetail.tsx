import { Badge, Grid, Stack, Tabs } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { IconHistory, IconChecklist, IconClipboardText, IconFiles, IconLayoutDashboard, IconListSearch, IconMessages, IconUsersGroup, type Icon } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { getCaseOptions, getHandoverOptions, listActorsOptions, listDocumentsOptions, listFindingsOptions, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import { detailTabs, type DetailTab } from '../../case-route'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import PageHeading from '../../components/PageHeading'
import { useSession } from '../../session'
import AuditTab from './AuditTab'
import CaseHeader, { BackLink } from './CaseHeader'
import FindingActions from './FindingActions'
import HandoverActions, { FieldActions } from './HandoverActions'
import { handoverFields, problemSections, sectionOf } from '../../components/handover/clinical'
import { useDocumentSources } from '../../components/handover/use-document-sources'
import DocumentsTab from '../../components/documents/DocumentsTab'
import FindingsPanel from '../../components/handover/FindingsPanel'
import HandoverTab from '../../components/handover/HandoverTab'
import OverviewTab from './OverviewTab'
import SourcePanel, { SourcePlaceholder } from '../../components/handover/SourcePanel'
import TasksTab from './TasksTab'
import MdtTab from './Mdt/MdtTab'
import CommunicationTab from './CommunicationTab'
import CodeCandidates from './S8/CodeCandidates'

const tabIcons: Record<DetailTab, Icon> = { overview: IconLayoutDashboard, handover: IconClipboardText, findings: IconListSearch, tasks: IconChecklist, documents: IconFiles, audit: IconHistory, mdt: IconUsersGroup, communication: IconMessages }
// Tabs without clinical values have no source column.
const noSources: DetailTab[] = ['overview', 'audit', 'communication']

function DetailContent({ caseId }: { caseId: string }) {
  const { t } = useTranslation()
  const { actor, actorId } = useSession()
  const navigate = useNavigate({ from: '/coordinator/cases/$caseId' })
  const { tab } = useSearch({ from: '/coordinator/cases/$caseId' })
  const wide = useMediaQuery('(min-width: 75em)')
  const [chosenSections, setChosenSections] = useState<string[] | null>(null)
  // A tab renders on its first visit and then stays mounted, so its state survives switching without rendering unseen tabs up front.
  const [visited, setVisited] = useState<DetailTab[]>([tab])
  if (!visited.includes(tab)) setVisited([...visited, tab])
  const seen = (value: DetailTab) => visited.includes(value)
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
  const { selection, setSelection, openSource, closeSource, evidence, selectedDocument, sources } = useDocumentSources(handover.data, documents.data, findings.data)
  const switchTab = (value: string | null) => {
    const next = detailTabs.find((entry) => entry === value)
    if (next && noSources.includes(next)) setSelection(null)
    if (next) void navigate({ search: { tab: next } })
  }
  const showField = (path: string) => {
    const section = sectionOf(path)?.key
    if (section && !openSections.includes(section)) setChosenSections([...openSections, section])
    void navigate({ search: { tab: 'handover' }, hash: `field-${path}` })
  }
  const showFinding = (id: string) => { void navigate({ search: { tab: 'findings' }, hash: `finding-${id}` }) }
  if (item.isPending) return <Stack><BackLink /><LoadingState rows={4} /></Stack>
  if (item.isError) return <Stack><BackLink /><PageHeading>{t('caseDetail.unavailableCase')}</PageHeading><QueryError error={item.error} pending={item.isFetching} retry={() => { void item.refetch() }} /></Stack>
  if (!allowed || !item.data) return <Stack><BackLink /><PageHeading>{t('caseDetail.unavailableCase')}</PageHeading><EmptyState title={t('caseDetail.unavailableCase')} /></Stack>
  const current = item.data
  const referrer = actors.data?.find((person) => person.id === current.referring_doctor_id)
  const openFindings = findings.data?.filter((finding) => !finding.resolved) ?? []
  const unresolved = openFindings.length
  const fields = handover.data ? handoverFields(handover.data) : {}
  // Clinical tabs keep the existing fixed source column on wide screens.
  const split = !!wide && !noSources.includes(tab)
  const source = selection && <SourcePanel key={JSON.stringify(selection)} document={selectedDocument || undefined} evidence={evidence} close={closeSource}
    fallback={documents.isPending ? <LoadingState rows={3} /> : documents.isError ? <QueryError error={documents.error} pending={documents.isFetching} retry={() => { void documents.refetch() }} /> : undefined} />
  const handoverError = handover.isError && (handover.error instanceof ApiError && handover.error.status === 404
    ? <EmptyState title={t('caseDetail.noHandover')} retry={() => { void handover.refetch() }} />
    : <QueryError error={handover.error} pending={handover.isFetching} retry={() => { void handover.refetch() }} />)
  const directoryState = <>
    {(actors.isPending || organizations.isPending) && <LoadingState />}
    {actors.isError && <QueryError error={actors.error} pending={actors.isFetching} retry={() => { void actors.refetch() }} />}
    {organizations.isError && <QueryError error={organizations.error} pending={organizations.isFetching} retry={() => { void organizations.refetch() }} />}
  </>
  return <Stack gap="md">
    <CaseHeader item={current} findings={findings.data} handover={handover.data} />
    <Tabs value={tab} onChange={switchTab}>
      <Tabs.List>{detailTabs.map((value) => {
        const TabIcon = tabIcons[value]
        return <Tabs.Tab key={value} value={value} leftSection={<TabIcon size={16} aria-hidden />}
          rightSection={value === 'findings' && unresolved > 0 ? <Badge size="sm" variant="filled" color="nessie">{unresolved}</Badge> : undefined}>{t(`caseDetail.tabs.${value}`)}</Tabs.Tab>
      })}</Tabs.List>
      <Grid mt="md">
        <Grid.Col span={split ? 7 : 12} miw={0}>
          <Tabs.Panel value="overview">
            {seen('overview') && <OverviewTab item={current} names={names} referrer={referrer} handover={handover.data} handoverState={handover.isPending ? <LoadingState rows={2} /> : handoverError} directoryState={directoryState} />}
          </Tabs.Panel>
          <Tabs.Panel value="handover">{seen('handover') && <Stack gap="sm">
            {handover.isPending && <LoadingState rows={6} />}
            {handoverError}
            {documents.isError && <QueryError error={documents.error} pending={documents.isFetching} retry={() => { void documents.refetch() }} />}
            {handover.data && <HandoverActions caseId={caseId} handover={handover.data}><HandoverTab handover={handover.data} names={names} sources={sources} findings={openFindings} showFinding={showFinding} open={openSections} setOpen={setChosenSections}
              fieldActions={(path, label) => <>
                {fields[path]?.status !== 'found' && <FieldActions path={path} label={label} findings={openFindings.filter((finding) => finding.fields?.includes(path))} showFinding={showFinding} />}
                {path === 'diagnosis_code' && <CodeCandidates handover={handover.data} onSaved={() => setChosenSections(openSections.includes('diagnosis') ? openSections : [...openSections, 'diagnosis'])} />}
              </>} /></HandoverActions>}
          </Stack>}</Tabs.Panel>
          <Tabs.Panel value="findings">
            {seen('findings') && <FindingsPanel caseId={caseId} handover={handover.data} names={names} sources={sources} showField={showField}
              findingActions={(finding) => <FindingActions caseId={caseId} finding={finding} handover={handover.data} />} />}
          </Tabs.Panel>
          <Tabs.Panel value="tasks">{seen('tasks') && <TasksTab caseId={caseId} openSource={openSource} showFinding={showFinding} />}</Tabs.Panel>
          <Tabs.Panel value="mdt">{seen('mdt') && <MdtTab item={current} handover={handover.data} handoverState={handover.isPending ? <LoadingState rows={2} /> : handoverError} documents={documents.data ?? []} names={names} sources={sources} showFindings={() => { void navigate({ search: { tab: 'findings' } }) }} showCommunication={() => { void navigate({ search: { tab: 'communication' } }) }} />}</Tabs.Panel>
          <Tabs.Panel value="communication">{seen('communication') && <CommunicationTab item={current} />}</Tabs.Panel>
          <Tabs.Panel value="audit">{seen('audit') && <AuditTab caseId={caseId} />}</Tabs.Panel>
          <Tabs.Panel value="documents">{seen('documents') && <DocumentsTab item={current} names={names} openSource={openSource} />}</Tabs.Panel>
        </Grid.Col>
        {split && <Grid.Col span={5}>{source || <SourcePlaceholder />}</Grid.Col>}
      </Grid>
      {!wide && source}
    </Tabs>
  </Stack>
}

export default function CaseDetail() {
  const { caseId } = useParams({ from: '/coordinator/cases/$caseId' })
  return <DetailContent key={caseId} caseId={caseId} />
}
