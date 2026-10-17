import CaseActions from './CaseActions'
import { Alert, DataList, Paper, SimpleGrid, Stack, Text, ThemeIcon, Timeline, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { IconArrowRight, IconCheck, IconHourglass } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { getMdtRecordOptions } from '../../client/@tanstack/react-query.gen'
import type { Actor, Case, Handover, Stamp } from '../../client/types.gen'
import Button from '../../components/ActionButton'
import CaseTime from '../../components/CaseTime'
import LoadingState, { QueryError } from '../../components/DataState'
import PersonChip from '../../components/PersonChip'
import { useSession } from '../../session'
import { formatDate } from '../../time'
import { StampView } from '../../components/handover/ClinicalValue'
import { loaded } from './Mdt/loaded'
import { snapshotStates } from './Mdt/mdt-progress'

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <Paper withBorder p="sm" component="section" aria-labelledby={id}><Stack gap="xs">
    <Title order={2} size="h5" id={id}>{title}</Title>
    {children}
  </Stack></Paper>
}

function Step({ stamp }: { stamp?: Stamp | null }) {
  return <ThemeIcon size={22} radius="xl" color={stamp ? 'blue' : 'gray'} variant={stamp ? 'filled' : 'light'}>
    {stamp ? <IconCheck size={14} aria-hidden /> : <IconHourglass size={14} aria-hidden />}
  </ThemeIcon>
}

export default function OverviewTab({ item, names, referrer, handover, handoverState, directoryState, showMdt }: {
  item: Case; names: Record<string, string>; referrer?: Actor; handover?: Handover; handoverState: ReactNode; directoryState: ReactNode; showMdt: () => void;
}) {
  const { t, i18n } = useTranslation(), { actorId } = useSession()
  // The coordinator confirms the handover by freezing the MDT snapshot (Q-F5, Q-F39); the record is created
  // in the same step with the same stamp, while the live handover keeps `confirmed_by_coordinator` empty.
  const record = useQuery(getMdtRecordOptions({ path: { case_id: item.id }, headers: actorHeaders(actorId ?? '') }))
  const recordState = loaded(record)
  const confirmation = handover?.confirmed_by_coordinator ?? (recordState.kind === 'ready' ? recordState.data.created : null)
  const fact = (label: string, value: ReactNode) => <DataList.Item><DataList.ItemLabel>{label}</DataList.ItemLabel><DataList.ItemValue>{value}</DataList.ItemValue></DataList.Item>
  const steps = handover ? [handover.validated_by_referrer, confirmation] : []
  const confirmationState = confirmation ? null
    : recordState.kind === 'loading' ? <LoadingState rows={1} />
    : recordState.kind === 'error' ? <QueryError error={recordState.error} pending={record.isFetching} retry={() => { void record.refetch() }} />
    : <Stack gap={4} align="flex-start">
      <Text size="xs" c="dimmed">{t('caseDetail.confirmHint')}</Text>
      {item.state && snapshotStates.includes(item.state) && <Button size="compact-sm" variant="light" rightSection={<IconArrowRight size={14} aria-hidden />} onClick={showMdt}>{t('caseDetail.goMdt')}</Button>}
    </Stack>
  return <Stack gap="sm">
    <CaseActions item={item} settings />
    {directoryState}
    {item.on_hold && <Alert color="gray" title={t('caseDetail.onHold')} p="sm">
      <Text size="sm">{item.on_hold.reason}</Text>
      <Text size="sm">{t('caseDetail.resumeDate')}: {item.on_hold.until ? formatDate(item.on_hold.until, i18n.language) : t('unavailable')}</Text>
    </Alert>}
    <Paper withBorder p="sm"><CaseTime item={item} /></Paper>
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
      <Card id="overview-facts" title={t('caseDetail.caseFacts')}>
        <DataList size="sm" gap="xs" labelWidth={150}>
          {fact(t('caseDetail.plannedMdt'), item.mdt_date ? formatDate(item.mdt_date, i18n.language) : t('unavailable'))}
          {fact(t('caseDetail.koc'), <PersonChip id={item.koc_id} size="xs" />)}
          {fact(t('caseDetail.assigned'), <PersonChip id={item.coordinator_id} size="xs" />)}
          {fact(t('caseDetail.asOf'), handover?.as_of ? formatDate(handover.as_of, i18n.language) : t('unavailable'))}
        </DataList>
      </Card>
      <Card id="overview-referrer" title={t('referring_doctor')}>
        <PersonChip id={referrer?.id} size="md" />
      </Card>
      <Card id="overview-handover" title={t('caseDetail.handoverStatus')}>
        {handoverState}
        {handover && <Timeline active={steps.findLastIndex(Boolean)} bulletSize={22} lineWidth={2}>
          {steps.map((stamp, index) => <Timeline.Item key={index} bullet={<Step stamp={stamp} />} title={<Text size="sm" fw={600}>{t(`caseDetail.${index === 0 ? 'validated' : 'confirmed'}`)}</Text>}>
            <StampView stamp={stamp} names={names} size="xs" />
            {index === 1 && confirmationState}
          </Timeline.Item>)}
        </Timeline>}
      </Card>
    </SimpleGrid>
  </Stack>
}