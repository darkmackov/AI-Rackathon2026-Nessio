import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import type { PropsWithChildren, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Actor, Case, Handover } from '../../client/types.gen'
import CaseTime, { DueDate } from '../../components/CaseTime'
import { formatDate } from '../../time'
import { StampView } from './ClinicalValue'

function Info({ label, children }: PropsWithChildren<{ label: string }>) {
    return <div><Text size="xs" c="dimmed">{label}</Text>{children}</div>
}

export default function OverviewTab({ item, names, referrer, handover, handoverState, directoryState }: {
    item: Case; names: Record<string, string>; referrer?: Actor; handover?: Handover; handoverState: ReactNode; directoryState: ReactNode;
}) {
    const { t, i18n } = useTranslation()
    const name = (id?: string | null) => (id ? names[id] : undefined) ?? t('unavailable')
    return <Stack gap="md">
        {directoryState}
        <Paper withBorder p="md" component="section" aria-labelledby="overview-case"><Stack gap="md">
            <Group justify="space-between" align="flex-start">
                <Group gap="xs">
                    <Title order={2} size="h4" id="overview-case">{t('s1.caseStatus')}</Title>
                    <Badge variant="light">{t('state')}: {item.state ? t(`states.${item.state}`) : t('unavailable')}</Badge>
                    <Badge variant="outline">{t('priority')}: {item.priority ? t(`priorities.${item.priority}`) : t('unavailable')}</Badge>
                </Group>
                <Group gap="xs"><Button size="sm" disabled>{t('s1.takeOver')}</Button><Button size="sm" variant="outline" disabled>{t('s1.returnCase')}</Button><Button size="sm" variant="outline" disabled>{t('s1.hold')}</Button></Group>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="sm">
                <Info label={t('nextStep')}><Text size="sm">{item.next_step ?? t('unavailable')}</Text></Info>
                <Info label={t('owner')}><Text size="sm">{name(item.on_move)}</Text></Info>
                <Info label={t('nextDue')}><DueDate value={item.next_due} /></Info>
                <Info label={t('s1.plannedMdt')}><Text size="sm">{item.mdt_date ? formatDate(item.mdt_date, i18n.language) : t('unavailable')}</Text></Info>
                <Info label={t('workplace')}><Text size="sm">{name(item.koc_id)}</Text></Info>
                <Info label={t('s1.assigned')}><Text size="sm">{name(item.coordinator_id)}</Text></Info>
            </SimpleGrid>
            {item.on_hold && <Alert color="gray" title={t('s1.onHold')}>
                <Text size="sm">{item.on_hold.reason}</Text>
                <Text size="sm">{t('s1.resumeDate')}: {item.on_hold.until ? formatDate(item.on_hold.until, i18n.language) : t('unavailable')}</Text>
            </Alert>}
        </Stack></Paper>
        <Paper withBorder p="md"><CaseTime item={item} /></Paper>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Paper withBorder p="md" component="section" aria-labelledby="overview-referrer"><Stack gap="xs">
                <Title order={2} size="h4" id="overview-referrer">{t('referring_doctor')}</Title>
                <Text size="sm" fw={600}>{referrer?.name ?? t('unavailable')}</Text>
                <Text size="sm">{t('phone')}: {referrer?.phone ?? t('unavailable')}</Text>
                <Text size="sm">{t('email')}: {referrer?.email ?? t('unavailable')}</Text>
            </Stack></Paper>
            <Paper withBorder p="md" component="section" aria-labelledby="overview-handover"><Stack gap="xs">
                <Title order={2} size="h4" id="overview-handover">{t('s1.handoverStatus')}</Title>
                {handoverState}
                {handover && <>
                    <Info label={t('s1.asOf')}><Text size="sm">{formatDate(handover.as_of, i18n.language)}</Text></Info>
                    <Info label={t('s1.validated')}><StampView stamp={handover.validated_by_referrer} names={names} /></Info>
                    <Info label={t('s1.confirmed')}><StampView stamp={handover.confirmed_by_coordinator} names={names} /></Info>
                </>}
            </Stack></Paper>
        </SimpleGrid>
    </Stack>
}
