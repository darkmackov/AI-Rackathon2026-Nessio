import { Badge, Button, Group, Text, Tooltip } from '@mantine/core'
import { IconClock, IconClockPlay } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useDemoClock } from '../demo-clock'
import { formatDateTime } from '../time'
import LoadingState, { QueryError } from './DataState'

export default function DemoClock({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const clock = useDemoClock()
  if (clock.isPending) return compact ? null : <LoadingState />
  if (clock.isError) return compact
    ? <Group gap="xs"><Text size="sm" c="red.9" role="alert">{t('clockError')}</Text><Button size="compact-sm" variant="outline" color="red" loading={clock.isFetching} onClick={() => { void clock.refetch() }}>{t('retry')}</Button></Group>
    : <QueryError error={clock.error} pending={clock.isFetching} retry={() => { void clock.refetch() }} />
  const mode = t(clock.data.simulated ? 'simulated' : 'wallClock')
  const time = <Text size="sm" component="time" dateTime={clock.data.now} aria-label={`${t('currentTime')} (${mode})`}>{formatDateTime(clock.data.now, i18n.language)}</Text>
  if (compact) return <Tooltip label={mode}>
    <Group gap={6} wrap="nowrap" aria-live="off">
      {clock.data.simulated ? <IconClockPlay size={16} aria-hidden color="var(--mantine-primary-color-filled)" /> : <IconClock size={16} aria-hidden />}
      {time}
    </Group>
  </Tooltip>
  return <Group gap="xs" aria-live="off"><Badge variant="light" color={clock.data.simulated ? 'nessie' : 'gray'}>{mode}</Badge>{time}</Group>
}
