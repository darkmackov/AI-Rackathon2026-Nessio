import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import type { PropsWithChildren, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Actor, Case, Handover } from '../../client/types.gen'
import CaseTime, { DueDate } from '../../components/CaseTime'
import PersonChip from '../../components/PersonChip'
import { formatDate } from '../../time'
import { StampView } from './ClinicalValue'

function Info({ label, children }: PropsWithChildren<{ label: string }>) {
  return <div><Text size="xs" c="dimmed">{label}</Text>{children}</div>
}

export default function OverviewTab({ item, names, referrer, handover, handoverState, directoryState }: {
  item: Case; names: Record<string, string>; referrer?: Actor; handover?: Handover; handoverState: ReactNode; directoryState: ReactNode;
}) {
  const { t, i18n } = useTranslation()
  return <Stack gap="md">
    {directoryState}
    <Paper withBorder p="md" component="section" aria-labelledby="overview-case"><Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="xs">
          <Title order={2} size="h4" id="overview-case">{t('caseDetail.caseStatus')}</Title>
          <Badge variant="light">{t('state')}: {item.state ? t(`states.${item.state}`) : t('unavailable')}</Badge>
          <Badge variant="outline">{t('priority')}: {item.priority ? t(`priorities.${item.priority}`) : t('unavailable')}</Badge>
        </Group>
        <Group gap="xs"><Button size="sm" disabled>{t('caseDetail.takeOver')}</Button><Button size="sm" variant="outline" disabled>{t('caseDetail.returnCase')}</Button><Button size="sm" variant="outline" disabled>{t('caseDetail.hold')}</Button></Group>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="sm">
        <Info label={t('nextStep')}><Text size="sm">{item.next_step ?? t('unavailable')}</Text></Info>
        <Info label={t('owner')}><PersonChip id={item.on_move} /></Info>
        <Info label={t('nextDue')}><DueDate value={item.next_due} /></Info>
        <Info label={t('caseDetail.plannedMdt')}><Text size="sm">{item.mdt_date ? formatDate(item.mdt_date, i18n.language) : t('unavailable')}</Text></Info>
        <Info label={t('workplace')}><PersonChip id={item.koc_id} /></Info>
        <Info label={t('caseDetail.assigned')}><PersonChip id={item.coordinator_id} /></Info>
      </SimpleGrid>
      {item.on_hold && <Alert color="gray" title={t('caseDetail.onHold')}>
        <Text size="sm">{item.on_hold.reason}</Text>
        <Text size="sm">{t('caseDetail.resumeDate')}: {item.on_hold.until ? formatDate(item.on_hold.until, i18n.language) : t('unavailable')}</Text>
      </Alert>}
    </Stack></Paper>
    <Paper withBorder p="md"><CaseTime item={item} /></Paper>
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Paper withBorder p="md" component="section" aria-labelledby="overview-referrer"><Stack gap="xs">
        <Title order={2} size="h4" id="overview-referrer">{t('referring_doctor')}</Title>
        <PersonChip id={referrer?.id} size="md" />
      </Stack></Paper>
      <Paper withBorder p="md" component="section" aria-labelledby="overview-handover"><Stack gap="xs">
        <Title order={2} size="h4" id="overview-handover">{t('caseDetail.handoverStatus')}</Title>
        {handoverState}
        {handover && <>
          <Info label={t('caseDetail.asOf')}><Text size="sm">{formatDate(handover.as_of, i18n.language)}</Text></Info>
          <Info label={t('caseDetail.validated')}><StampView stamp={handover.validated_by_referrer} names={names} /></Info>
          <Info label={t('caseDetail.confirmed')}><StampView stamp={handover.confirmed_by_coordinator} names={names} /></Info>
        </>}
      </Stack></Paper>
    </SimpleGrid>
  </Stack>
}
