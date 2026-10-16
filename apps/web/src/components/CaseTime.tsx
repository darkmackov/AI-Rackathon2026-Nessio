import { Badge, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../api'
import { getTimeToTreatmentOptions } from '../client/@tanstack/react-query.gen'
import type { Case } from '../client/types.gen'
import { useDemoClock } from '../demo-clock'
import { useSession } from '../session'
import { formatDateTime, localDateTime } from '../time'
import LoadingState, { QueryError } from './DataState'

export function DueDate({ value, active = true }: { value?: string | null; active?: boolean }) {
  const { t, i18n } = useTranslation()
  const clock = useDemoClock()
  const overdue = active && value && clock.data && new Date(value).getTime() < new Date(clock.data.now).getTime()
  return <Group gap="xs"><Text size="sm">{value ? formatDateTime(value, i18n.language) : t('unavailable')}</Text>{overdue && <Badge color="red" variant="light">{t('s1.overdue')}</Badge>}</Group>
}

export default function CaseTime({ item, compact = false }: { item: Case; compact?: boolean }) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const clock = useDemoClock()
  const day = clock.data?.now.slice(0, 10) ?? ''
  const options = getTimeToTreatmentOptions({ path: { case_id: item.id }, headers: actorHeaders(actorId ?? '') })
  const times = useQuery({ ...options,
    // Generated keys support tags: this cache-only tag changes at demo midnight.
    queryKey: [{ ...options.queryKey[0], tags: ['demo-day', day] }],
    enabled: !!day, staleTime: Infinity,
  })
  const m = item.milestones
  const points = [m?.symptom_onset, m?.referred_at ? localDateTime(new Date(m.referred_at)).slice(0, 10) : null, m?.mdt_held, m?.treatment_start]
  const values = [times.data?.t1, times.data?.t2, times.data?.t3]
  const intervalState = (index: number, value: number | null | undefined) => {
    if (value != null) return points[index + 1] ? 'completed' : 'ongoing'
    if (points[index] && day < points[index]!.slice(0, 10)) return 'beforeStart'
    return !points[index] && !points.slice(index + 1).some(Boolean) ? 'notStarted' : 'unknownInterval'
  }
  return <Stack gap="xs" aria-label={t('s1.treatment')}>
    <Text fw={600} size="sm">{t('s1.treatment')}</Text>
    {clock.isPending && <LoadingState />}
    {clock.isError && <QueryError error={clock.error} pending={clock.isFetching} retry={() => { void clock.refetch() }} />}
    {day && times.isPending && <LoadingState />}
    {times.isError && <QueryError error={times.error} pending={times.isFetching} retry={() => { void times.refetch() }} />}
    {times.data && <SimpleGrid cols={compact ? 2 : { base: 2, md: 4 }} spacing="xs">
      {values.map((value, index) => <Paper key={index} p="xs" bg="gray.0" withBorder>
        <Text size="xs" fw={600}>{t(`s1.t${index + 1}`)}</Text>
        <Text fw={650} size="sm">{value != null ? t('s1.days', { count: value }) : '—'}</Text>
        <Text size="xs" c="dimmed">{t(`s1.${intervalState(index, value)}`)}</Text>
      </Paper>)}
      <Paper p="xs" bg="blue.0" withBorder><Text size="xs" fw={600}>{t('s1.total')}</Text><Text fw={650} size="sm">{times.data.total != null ? t('s1.days', { count: times.data.total }) : '—'}</Text><Text size="xs" c="dimmed">{t(`s1.${times.data.total == null ? 'unknownInterval' : m?.treatment_start ? 'completed' : 'ongoing'}`)}</Text></Paper>
    </SimpleGrid>}
  </Stack>
}
