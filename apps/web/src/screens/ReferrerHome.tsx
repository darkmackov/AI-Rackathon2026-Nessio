import { Paper, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listOrganizationsOptions } from '../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../components/DataState'
import PageHeading from '../components/PageHeading'
import { useSession } from '../session'

export default function ReferrerHome() {
  const { t } = useTranslation()
  const { actor } = useSession()
  const organizations = useQuery(listOrganizationsOptions())
  if (!actor) return null
  const organization = organizations.data?.find((item) => item.id === actor.organization_id)
  return <Stack>
    <div><PageHeading>{t('identityTitle')}</PageHeading><Text c="dimmed" mt="xs">{t('identityDescription')}</Text></div>
    {organizations.isPending && <LoadingState />}
    {organizations.isError && <QueryError error={organizations.error} pending={organizations.isFetching} retry={() => { void organizations.refetch() }} />}
    {organizations.isSuccess && <Paper withBorder p="lg">
      <Stack gap="md">
        <div><Text fw={650}>{actor.name}</Text><Text c="dimmed">{t('referring_doctor')}</Text></div>
        <div><Text size="sm" c="dimmed">{t('workplace')}</Text><Text>{organization?.name ?? t('unavailable')}</Text>{organization?.address && <Text size="sm">{organization.address}</Text>}</div>
        <div><Text size="sm" c="dimmed">{t('phone')}</Text><Text>{actor.phone ?? t('unavailable')}</Text></div>
        <div><Text size="sm" c="dimmed">{t('email')}</Text><Text>{actor.email ?? t('unavailable')}</Text></div>
        {!organization && <EmptyState title={t('missingOrganization')} retry={() => { void organizations.refetch() }} />}
      </Stack>
    </Paper>}
  </Stack>
}
