import { Anchor, Badge, Button, Drawer, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../api'
import { listActorsOptions, listCasesOptions, listOrganizationsOptions } from '../client/@tanstack/react-query.gen'
import type { Case, QueueColumn } from '../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../components/DataState'
import PageHeading from '../components/PageHeading'
import { useSession } from '../session'
import CaseTime, { DueDate } from '../components/CaseTime'
import DocumentIngest from '../components/documents/DocumentIngest'

const columns: QueueColumn[] = ['novy', 'aktivni', 'odlozeny']

function CaseCard({ item, owner, onDocuments }: { item: Case; owner: string; onDocuments: () => void }) {
  const { t } = useTranslation()
  return <Paper component="article" withBorder p="md">
    <Stack gap="sm">
      <div><Anchor renderRoot={(props) => <Link {...props} to="/coordinator/cases/$caseId" params={{ caseId: item.id }} search={{ tab: 'overview' }} />} fw={650}>{item.patient_name}</Anchor><Text size="sm" mt={4}>{item.diagnosis_label ?? t('unavailable')}</Text></div>
      <Group gap="xs">
        <Badge variant="light">{t('state')}: {item.state ? t(`states.${item.state}`) : t('unavailable')}</Badge>
        <Badge variant="outline" color={item.priority === 'urgent' ? 'red' : 'gray'}>{t('priority')}: {item.priority ? t(`priorities.${item.priority}`) : t('unavailable')}</Badge>
      </Group>
      <div><Text size="xs" c="dimmed">{t('nextStep')}</Text><Text size="sm">{item.next_step ?? t('unavailable')}</Text></div>
      <div><Text size="xs" c="dimmed">{t('owner')}</Text><Text size="sm">{owner}</Text></div>
      <div><Text size="xs" c="dimmed">{t('nextDue')}</Text><DueDate value={item.next_due} /></div>
      <CaseTime item={item} compact />
      <Button variant="outline" onClick={onDocuments}>{t('documents.open')}</Button>
    </Stack>
  </Paper>
}

export default function CoordinatorDashboard() {
  const { t } = useTranslation()
  const { actor } = useSession()
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const busy = useIsMutating() > 0
  const cases = useQuery({
    ...listCasesOptions({ headers: actorHeaders(actor?.id ?? ''), query: { koc_id: actor?.organization_id } }),
    enabled: !!actor?.organization_id,
  })
  const actors = useQuery(listActorsOptions())
  const organizations = useQuery(listOrganizationsOptions())
  if (!actor) return null
  return <Stack>
    <div><PageHeading>{t('dashboardTitle')}</PageHeading><Text c="dimmed" mt="xs">{t('dashboardDescription')}</Text></div>
    {!actor.organization_id && <EmptyState title={t('missingOrganization')} />}
    {actor.organization_id && (cases.isPending || actors.isPending || organizations.isPending) && <LoadingState />}
    {cases.isError && <QueryError error={cases.error} retry={() => { void cases.refetch() }} />}
    {actors.isError && <QueryError error={actors.error} retry={() => { void actors.refetch() }} />}
    {organizations.isError && <QueryError error={organizations.error} retry={() => { void organizations.refetch() }} />}
    {cases.isSuccess && (cases.data.length === 0
      ? <EmptyState title={t('emptyCases')} description={t('emptyCasesHint')} retry={() => { void cases.refetch() }} />
      : <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        {columns.map((column) => <Stack component="section" key={column} gap="sm" aria-labelledby={`queue-${column}`}>
          <Group justify="space-between"><Title order={2} size="h4" id={`queue-${column}`}>{t(`queue.${column}`)}</Title><Badge variant="light" color="gray">{cases.data.filter((item) => item.queue === column).length}</Badge></Group>
          {cases.data.filter((item) => item.queue === column).map((item) => <CaseCard key={item.id} item={item}
            onDocuments={() => setSelectedCaseId(item.id)}
            owner={actors.data?.find((person) => person.id === item.on_move)?.name ?? organizations.data?.find((org) => org.id === item.on_move)?.name ?? t('unavailable')} />)}
          {!cases.data.some((item) => item.queue === column) && <Text size="sm" c="dimmed">{t('emptyColumn')}</Text>}
        </Stack>)}
      </SimpleGrid>)}
    <Drawer.Stack><Drawer stackId="case-documents" opened={selectedCaseId !== null} onClose={() => { if (!busy) setSelectedCaseId(null) }} position="right" size="xl"
      title={cases.data?.find((item) => item.id === selectedCaseId)?.patient_name ?? t('documents.title')}
      closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {selectedCaseId && <DocumentIngest caseId={selectedCaseId} />}
    </Drawer></Drawer.Stack>
  </Stack>
}
