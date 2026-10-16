import { Badge, Button, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useDemoClock } from '../demo-clock'
import { formatDateTime } from '../time'
import LoadingState, { QueryError } from './DataState'

export default function DemoClock({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const clock = useDemoClock()
  if (clock.isPending) return <LoadingState />
  if (clock.isError) return compact
    ? <Group gap="xs"><Text size="sm" c="red.9" role="alert">{t('clockError')}</Text><Button size="compact-sm" variant="outline" color="red" loading={clock.isFetching} onClick={() => { void clock.refetch() }}>{t('retry')}</Button></Group>
    : <QueryError error={clock.error} pending={clock.isFetching} retry={() => { void clock.refetch() }} />
  return <Stack gap={4} aria-live="off">
    <Group gap="xs"><Badge variant="light" color={clock.data.simulated ? 'blue' : 'gray'}>{t(clock.data.simulated ? 'simulated' : 'wallClock')}</Badge>
      <Text size="sm" component="time" dateTime={clock.data.now} aria-label={t('currentTime')}>{formatDateTime(clock.data.now, i18n.language)}</Text>
    </Group>
  </Stack>
}
