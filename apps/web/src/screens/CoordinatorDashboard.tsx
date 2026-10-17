import Notifications from '../components/workflow/Notifications'
import { Anchor, Badge, Group, Paper, SimpleGrid, Stack, Switch, Text, Title, VisuallyHidden } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { IconInbox, IconPlayerPause, IconProgress, type Icon } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../api'
import { listActorsOptions, listCasesOptions, listOrganizationsOptions } from '../client/@tanstack/react-query.gen'
import type { Case, QueueColumn } from '../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../components/DataState'
import PageHeading from '../components/PageHeading'
import { useSession } from '../session'
import CaseTime, { DueDate } from '../components/CaseTime'
import PersonChip from '../components/PersonChip'
import { PriorityBadge } from '../components/Priority'

const columns: { value: QueueColumn; icon: Icon }[] = [{ value: 'novy', icon: IconInbox }, { value: 'aktivni', icon: IconProgress }, { value: 'odlozeny', icon: IconPlayerPause }]

function CaseCard({ item }: { item: Case }) {
  const { t } = useTranslation()
  return <Paper component="article" withBorder p="sm">
    <Stack gap="xs">
      <div><Anchor renderRoot={(props) => <Link {...props} to="/coordinator/cases/$caseId" params={{ caseId: item.id }} search={{ tab: 'overview' }} />} fw={650}>{item.patient_name}</Anchor><Text size="sm" c="dimmed">{item.diagnosis_label ?? t('unavailable')}</Text></div>
      <Group gap={6}>
        <Badge variant="light"><VisuallyHidden>{t('state')}: </VisuallyHidden>{item.state ? t(`states.${item.state}`) : t('unavailable')}</Badge>
        <PriorityBadge priority={item.priority} />
      </Group>
      <div><Text size="xs" c="dimmed">{t('nextStep')}</Text><Text size="sm">{item.next_step ?? t('unavailable')}</Text></div>
      <Group gap="md" align="flex-start">
        <div><Text size="xs" c="dimmed" mb={4}>{t('owner')}</Text><PersonChip id={item.on_move} size="xs" /></div>
        <div><Text size="xs" c="dimmed">{t('nextDue')}</Text><DueDate value={item.next_due} /></div>
      </Group>
      <CaseTime item={item} compact />
    </Stack>
  </Paper>
}

export default function CoordinatorDashboard() {
  const { t } = useTranslation()
  const { actor } = useSession()
  const [showClosed, setShowClosed] = useState(false)
  const cases = useQuery({
    ...listCasesOptions({ headers: actorHeaders(actor?.id ?? ''), query: { koc_id: actor?.organization_id } }),
    enabled: !!actor?.organization_id,
  })
  const actors = useQuery(listActorsOptions())
  const organizations = useQuery(listOrganizationsOptions())
  if (!actor) return null
  const shown = (cases.data ?? []).filter((item) => showClosed || item.state !== 'uzavreno')
  return <Stack>
    <Group justify="space-between" align="flex-start"><div><PageHeading>{t('dashboardTitle')}</PageHeading><Text c="dimmed" mt="xs">{t('dashboardDescription')}</Text></div><Group gap="md"><Switch label={t('messages.showClosed')} checked={showClosed} onChange={(event) => setShowClosed(event.currentTarget.checked)} /><Notifications /></Group></Group>
    {!actor.organization_id && <EmptyState title={t('missingOrganization')} />}
    {actor.organization_id && (cases.isPending || actors.isPending || organizations.isPending) && <LoadingState />}
    {cases.isError && <QueryError error={cases.error} retry={() => { void cases.refetch() }} />}
    {actors.isError && <QueryError error={actors.error} retry={() => { void actors.refetch() }} />}
    {organizations.isError && <QueryError error={organizations.error} retry={() => { void organizations.refetch() }} />}
    {cases.isSuccess && (cases.data.length === 0
      ? <EmptyState title={t('emptyCases')} description={t('emptyCasesHint')} retry={() => { void cases.refetch() }} />
      : <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        {columns.map(({ value: column, icon: ColumnIcon }) => <Stack component="section" key={column} gap={0} aria-labelledby={`queue-${column}`}
          bg={column === 'aktivni' ? 'nessie.0' : 'gray.0'} style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 'var(--mantine-radius-md)', overflow: 'hidden', minWidth: 0 }}>
          <Group gap="xs" px="sm" py="sm" bg={column === 'aktivni' ? 'nessie.2' : 'gray.2'}>
            <ColumnIcon size={18} aria-hidden />
            <Title order={2} size="h4" id={`queue-${column}`}>{t(`queue.${column}`)}</Title>
            <Badge variant="light" color={column === 'aktivni' ? 'nessie' : 'gray'} c="var(--mantine-color-text)">{shown.filter((item) => item.queue === column).length}</Badge>
          </Group>
          <Stack gap="sm" p="sm">
            {shown.filter((item) => item.queue === column).map((item) => <CaseCard key={item.id} item={item} />)}
            {!shown.some((item) => item.queue === column) && <Text size="sm" c="dimmed">{t('emptyColumn')}</Text>}
          </Stack>
        </Stack>)}
      </SimpleGrid>)}
  </Stack>
}
