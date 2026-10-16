import { Anchor, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import PageHeading from '../components/PageHeading'
import { actorHeaders } from '../api'
import { listCasesOptions, listOrganizationsOptions } from '../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../components/DataState'
import { DueDate } from '../components/CaseTime'
import PersonChip from '../components/PersonChip'
import CreateReferral from './Referral/CreateReferral'
import { useSession } from '../session'

export default function ReferrerHome() {
  const { t } = useTranslation()
  const { actor, actorId } = useSession()
  const cases = useQuery({ ...listCasesOptions({ headers: actorHeaders(actorId ?? ''), query: { referring_doctor_id: actorId ?? '' } }), enabled: !!actorId })
  const kocs = useQuery(listOrganizationsOptions({ query: { kind: 'koc' } }))
  if (!actor) return null
  const ownCases = cases.data?.filter((item) => item.referring_doctor_id === actor.id) ?? []
  return <Stack gap="lg">
    <PageHeading size="h2">{t('referrerWelcome', { name: actor.name })}</PageHeading>
    <Group justify="space-between"><Title order={2} size="h3">{t('referral.title')}</Title><CreateReferral actorId={actor.id} /></Group>
    {kocs.isPending && <LoadingState />}
    {kocs.isError && <QueryError error={kocs.error} pending={kocs.isFetching} retry={() => { void kocs.refetch() }} />}
    {cases.isPending && <LoadingState rows={3} />}
    {cases.isError && <QueryError error={cases.error} pending={cases.isFetching} retry={() => { void cases.refetch() }} />}
    {cases.isSuccess && !ownCases.length && <EmptyState title={t('referral.empty')} description={t('referral.emptyHelp')} />}
    {ownCases.map((item) => <Paper component="article" withBorder p="md" key={item.id}><Stack gap="xs">
      <Group justify="space-between" align="flex-start">
        <Anchor renderRoot={(props) => <Link {...props} to="/referrer/cases/$caseId" params={{ caseId: item.id }} />} fw={600} style={{ overflowWrap: 'anywhere' }}>{item.patient_name || t('referral.unnamed')}</Anchor>
        <Badge variant="light" color={item.state === 'vraceno_lekari' ? 'orange' : 'blue'} c="dark.9">{item.state ? t(`states.${item.state}`) : t('unavailable')}</Badge>
      </Group>
      <Text size="sm">{kocs.data?.find((koc) => koc.id === item.koc_id)?.name ?? t('unavailable')}</Text>
      <Text size="sm" c="dimmed">{item.diagnosis_label ?? t('unavailable')}</Text>
      <Group gap="md" align="flex-start"><Group gap={4}><Text size="xs" c="dimmed">{t('owner')}:</Text><PersonChip id={item.on_move} size="xs" /></Group>
        <Text size="sm">{t('nextStep')}: {item.next_step ?? t('unavailable')}</Text><Group gap={4}><Text size="xs" c="dimmed">{t('nextDue')}:</Text><DueDate value={item.next_due} /></Group>
      </Group>
    </Stack></Paper>)}
  </Stack>
}
