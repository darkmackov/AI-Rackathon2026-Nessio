import { EmptyState, Paper, Stack } from '@mantine/core'
import { IconFileText } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import PageHeading from '../components/PageHeading'
import { useSession } from '../session'

export default function ReferrerHome() {
  const { t } = useTranslation()
  const { actor } = useSession()
  if (!actor) return null
  return <Stack gap="lg">
    <PageHeading size="h2">{t('referrerWelcome', { name: actor.name })}</PageHeading>
    <Paper withBorder p="xl">
      <EmptyState icon={<IconFileText size={28} aria-hidden />} title={t('referrerEmpty')} description={t('referrerEmptyHelp')} role="status" />
    </Paper>
  </Stack>
}
