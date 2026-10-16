import CaseActions from './CaseActions'
import { Alert, DataList, Paper, SimpleGrid, Stack, Text, ThemeIcon, Timeline, Title } from '@mantine/core'
import { IconCheck, IconHourglass } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Actor, Case, Handover, Stamp } from '../../client/types.gen'
import CaseTime from '../../components/CaseTime'
import PersonChip from '../../components/PersonChip'
import { formatDate } from '../../time'
import { StampView } from '../../components/handover/ClinicalValue'

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

export default function OverviewTab({ item, names, referrer, handover, handoverState, directoryState }: {
  item: Case; names: Record<string, string>; referrer?: Actor; handover?: Handover; handoverState: ReactNode; directoryState: ReactNode;
}) {
  const { t, i18n } = useTranslation()
  const fact = (label: string, value: ReactNode) => <DataList.Item><DataList.ItemLabel>{label}</DataList.ItemLabel><DataList.ItemValue>{value}</DataList.ItemValue></DataList.Item>
  const steps = handover ? [handover.validated_by_referrer, handover.confirmed_by_coordinator] : []
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
          </Timeline.Item>)}
        </Timeline>}
      </Card>
    </SimpleGrid>
  </Stack>
}