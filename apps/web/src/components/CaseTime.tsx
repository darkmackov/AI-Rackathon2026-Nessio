import { Badge, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { IconAlertTriangle, IconHourglass } from '@tabler/icons-react'
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
  return <Group gap="xs"><Text size="sm">{value ? formatDateTime(value, i18n.language) : t('unavailable')}</Text>{overdue && <Badge color="red" variant="light" c="red.9" leftSection={<IconAlertTriangle size={12} aria-hidden />}>{t('caseDetail.overdue')}</Badge>}</Group>
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
  const errors = <>
    {clock.isError && <QueryError error={clock.error} pending={clock.isFetching} retry={() => { void clock.refetch() }} />}
    {times.isError && <QueryError error={times.error} pending={times.isFetching} retry={() => { void times.refetch() }} />}
  </>
  // Kanban cards get a one-line summary: the total, then the intervals that can be counted.
  if (compact) return <Group gap={6} wrap="wrap" role="group" aria-label={t('caseDetail.treatment')}>
    <IconHourglass size={16} aria-hidden />
    <Text size="xs" c="dimmed">{t('caseDetail.treatment')}</Text>
    {(clock.isPending || (!!day && times.isPending)) && <Text size="xs" c="dimmed" role="status">{t('loading')}</Text>}
    {times.data && <>
      <Text size="sm" fw={600}>{times.data.total != null ? t('caseDetail.days', { count: times.data.total }) : t('caseDetail.unknownInterval')}</Text>
      <Text size="xs" c="dimmed">{values.flatMap((value, index) => value != null ? [t('caseDetail.intervalShort', { number: index + 1, count: value })] : []).join(', ')}</Text>
    </>}
    {errors}
  </Group>
  return <Stack gap="xs" role="group" aria-label={t('caseDetail.treatment')}>
    <Text fw={600} size="sm">{t('caseDetail.treatment')}</Text>
    {clock.isPending && <LoadingState />}
    {day && times.isPending && <LoadingState />}
    {errors}
    {times.data && <SimpleGrid cols={{ base: 2, sm: 4 }} spacing={6} verticalSpacing={6}>
      {values.map((value, index) => <Paper key={index} px="xs" py={4} bg="gray.0" withBorder>
        <Text size="xs" fw={600}>{t(`caseDetail.t${index + 1}`)}</Text>
        <Text fw={650} size="sm">{value != null ? t('caseDetail.days', { count: value }) : '—'}</Text>
        <Text size="xs" c="dimmed">{t(`caseDetail.${intervalState(index, value)}`)}</Text>
      </Paper>)}
      <Paper px="xs" py={4} bg="blue.0" withBorder><Text size="xs" fw={600}>{t('caseDetail.total')}</Text><Text fw={650} size="sm">{times.data.total != null ? t('caseDetail.days', { count: times.data.total }) : '—'}</Text><Text size="xs" c="dimmed">{t(`caseDetail.${times.data.total == null ? 'unknownInterval' : m?.treatment_start ? 'completed' : 'ongoing'}`)}</Text></Paper>
    </SimpleGrid>}
  </Stack>
}
